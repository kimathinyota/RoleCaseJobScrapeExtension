// background.js

// CONFIGURATION
const API_BASE = "http://localhost:8000/api/job"; 
const START_ENDPOINT = `${API_BASE}/parse_external`; 
const STATUS_ENDPOINT = `${API_BASE}/status`; // We append /{jobId} dynamically

// --- KEEPALIVE MECHANISM ---
let lifelines = {};

function keepAliveForJob(jobId) {
  if (!lifelines[jobId]) {
    // Ping platform info every 20s to keep Service Worker alive
    lifelines[jobId] = setInterval(() => {
      chrome.runtime.getPlatformInfo(() => {
        console.log(`[KeepAlive] Pinging for job ${jobId}`);
      });
    }, 20000); 
  }
}

function releaseKeepAlive(jobId) {
  if (lifelines[jobId]) {
    clearInterval(lifelines[jobId]);
    delete lifelines[jobId];
    console.log(`[KeepAlive] Released for job ${jobId}`);
  }
}

// Helper to prioritize API data over scraped data
function pick(apiVal, scrapeVal) {
  if (apiVal && String(apiVal).trim().length > 0) return apiVal;
  return scrapeVal;
}

// Helper for polling delay
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 1. Listen for "SCRAPE" messages from scrape.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "JOB_SCRAPED") {
    handleNewScrape(message.data);
    // Return true if you needed to send an async response, 
    // but here we handle it via storage updates so it's not strictly necessary.
  }
});

// 2. Core Logic: Add to Queue & Start Processing
async function handleNewScrape(scrapedData) {
  // Generate a local ID for the extension storage
  const localJobId = crypto.randomUUID();
  const timestamp = Date.now();

  const newJob = {
    id: localJobId,
    status: "parsing", 
    original_text: scrapedData.description, 
    scraped_meta: scrapedData, 
    parsed_result: null,
    created_at: timestamp,
    error_msg: null
  };

  await saveJobToStorage(newJob);
  
  // Start the KeepAlive to prevent the browser from killing the worker during polling
  keepAliveForJob(localJobId);
  
  // Kick off the Async Flow
  processJobWithPolling(newJob);
}

// 3. The New Async Worker (Start -> Poll -> Finish)
async function processJobWithPolling(job) {
  try {
    console.log(`[API] Starting Background Task for Job ${job.id}`);

    // --- STEP A: START THE TASK ---
    const startResponse = await fetch(START_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Credentials included in case you add auth to this endpoint later
      credentials: "include", 
      body: JSON.stringify({ text: job.original_text })
    });

    if (!startResponse.ok) {
      if (startResponse.status === 401) throw new Error("Not logged in (Extension)");
      throw new Error(`Failed to start task: ${startResponse.status}`);
    }

    const startData = await startResponse.json();
    const redisTaskId = startData.job_id;
    console.log(`[API] Task Started. Redis ID: ${redisTaskId}`);

    // --- STEP B: POLL FOR COMPLETION ---
    let jsonResult = null;
    const maxRetries = 150; // 150 * 2s = ~5 minutes max wait
    let attempts = 0;

    while (attempts < maxRetries) {
      attempts++;
      
      // Wait 2 seconds before checking
      await delay(2000);

      // Check Status
      const statusResponse = await fetch(`${STATUS_ENDPOINT}/${redisTaskId}`, {
         credentials: "include"
      });
      
      if (!statusResponse.ok) {
         console.warn(`[API] Status check failed (${statusResponse.status}), retrying...`);
         continue; 
      }

      const statusData = await statusResponse.json();

      if (statusData.status === "finished") {
        console.log("[API] Task Finished!", statusData);
        jsonResult = statusData.data; // This is the structured CV/Job JSON
        break; // Exit loop
      } 
      else if (statusData.status === "failed") {
        throw new Error(statusData.error || "Server parsing failed");
      } 
      else if (statusData.status === "not_found") {
        throw new Error("Task ID lost on server");
      }
      
      // If status is 'queued' or 'processing', the loop continues...
    }

    if (!jsonResult) {
      throw new Error("Parsing timed out after 5 minutes");
    }

    // --- STEP C: PROCESS & MERGE RESULT ---
    console.log("Merging API Result with Scraped Data...");

    job.parsed_result = {
      title: pick(jsonResult.title, job.scraped_meta.title),
      company: pick(jsonResult.company, job.scraped_meta.company),
      location: pick(jsonResult.location, job.scraped_meta.location),
      salary_range: pick(jsonResult.salary_range, job.scraped_meta.salary),
      date_posted: pick(jsonResult.date_posted, job.scraped_meta.date_posted),
      date_closing: pick(jsonResult.date_closing, job.scraped_meta.date_closing),
      date_extracted: pick(jsonResult.date_extracted, job.scraped_meta.date_extracted),
      // Keep descriptions from scrape to ensure HTML formatting is preserved if needed
      description: job.scraped_meta.description, 
      displayed_description: job.scraped_meta.displayed_description,
      // AI Enriched data
      features: jsonResult.features || [],
      job_url: job.scraped_meta.url,
      _meta: jsonResult._meta || {}
    };
    
    job.status = "review";
    await saveJobToStorage(job);
    console.log(`[Job ${job.id}] Saved to storage (Success)`);

  } catch (error) {
    console.error(`[Job ${job.id}] Failed:`, error);
    job.status = "error";
    job.error_msg = error.message;
    await saveJobToStorage(job);
  } finally {
    // Always release the keepalive when done (success or fail)
    releaseKeepAlive(job.id);
  }
}

function saveJobToStorage(updatedJob) {
  return new Promise((resolve) => {
    chrome.storage.local.get(["job_queue"], (result) => {
      const queue = result.job_queue || {};
      queue[updatedJob.id] = updatedJob;
      chrome.storage.local.set({ job_queue: queue }, resolve);
    });
  });
}