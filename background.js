// background.js

// CONFIGURATION
// FIX 1: Use 127.0.0.1 instead of localhost to bypass Windows IPv6 issues
const API_BASE = "http://127.0.0.1:8000/api"; 
const PARSE_ENDPOINT = `${API_BASE}/job/parse`; 

// --- KEEPALIVE MECHANISM ---
// FIX 2: Prevent Chrome from killing the worker during long parsing (300s+)
let lifelines = {};

function keepAliveForJob(jobId) {
  if (!lifelines[jobId]) {
    // Connect a port to maintain activity
    lifelines[jobId] = setInterval(() => {
      chrome.runtime.getPlatformInfo(() => {
        // Dummy call to reset the 30s timer
        console.log(`[KeepAlive] Pinging for job ${jobId}`);
      });
    }, 20000); // Ping every 20 seconds
  }
}

function releaseKeepAlive(jobId) {
  if (lifelines[jobId]) {
    clearInterval(lifelines[jobId]);
    delete lifelines[jobId];
    console.log(`[KeepAlive] Released for job ${jobId}`);
  }
}

// --- HELPER: Merge Logic (Model vs Scraper) ---
// Returns apiVal if it exists, otherwise falls back to scrapeVal
function pick(apiVal, scrapeVal) {
  if (apiVal && String(apiVal).trim().length > 0) return apiVal;
  return scrapeVal;
}

// 1. Listen for "SCRAPE" messages from scrape.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "JOB_SCRAPED") {
    handleNewScrape(message.data);
  }
  // Important: Return true if you were asynchronous, though here we aren't sending a response back immediately
});

// 2. Core Logic: Add to Queue & Start Processing
async function handleNewScrape(scrapedData) {
  const jobId = crypto.randomUUID();
  const timestamp = Date.now();

  const newJob = {
    id: jobId,
    status: "parsing", 
    original_text: scrapedData.description, 
    scraped_meta: scrapedData, 
    parsed_result: null,
    created_at: timestamp,
    error_msg: null
  };

  // A. Save to storage immediately
  await saveJobToStorage(newJob);

  // B. Start the heartbeat BEFORE the long fetch
  keepAliveForJob(jobId);

  // C. Trigger the API call
  parseJob(newJob);
}

// 3. The API Worker
async function parseJob(job) {
  try {
    console.log(`[API] Sending Job ${job.id} to ${PARSE_ENDPOINT}`);

    // Set a long timeout signal so the fetch doesn't default-fail (Chrome default is often too short)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 Minute Timeout

    const response = await fetch(PARSE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: job.original_text }),
      signal: controller.signal
    });

    clearTimeout(timeoutId); // Clear the safety timeout

    if (!response.ok) {
      throw new Error(`Server Error: ${response.status}`);
    }

    const jsonResult = await response.json();
    console.log("API Parse Result:", jsonResult);

    // Merge API result with our job using the 'pick' helper
    job.parsed_result = {
      title: pick(jsonResult.title, job.scraped_meta.title),
      company: pick(jsonResult.company, job.scraped_meta.company),
      location: pick(jsonResult.location, job.scraped_meta.location),
      salary_range: pick(jsonResult.salary_range, job.scraped_meta.salary),
      
      // DATES: Ensure these are copied over from scraper
      date_posted: pick(jsonResult.date_posted, job.scraped_meta.date_posted),
      date_closing: pick(jsonResult.date_closing, job.scraped_meta.date_closing),
      date_extracted: pick(jsonResult.date_extracted, job.scraped_meta.date_extracted),

      // DESCRIPTIONS: Pass these through for the platform
      description: job.scraped_meta.description,
      displayed_description: job.scraped_meta.displayed_description,

      features: jsonResult.features || [],
      job_url: job.scraped_meta.url,
      _meta: jsonResult._meta
    };
    
    job.status = "review";
    await saveJobToStorage(job);

  } catch (error) {
    console.error("Parsing failed:", error);
    job.status = "error";
    job.error_msg = error.message;
    await saveJobToStorage(job);
  } finally {
    // STOP the heartbeat once the fetch finishes (success or fail)
    releaseKeepAlive(job.id);
  }
}

// Helper to update chrome.storage.local
function saveJobToStorage(updatedJob) {
  return new Promise((resolve) => {
    chrome.storage.local.get(["job_queue"], (result) => {
      const queue = result.job_queue || {};
      queue[updatedJob.id] = updatedJob;
      chrome.storage.local.set({ job_queue: queue }, resolve);
    });
  });
}