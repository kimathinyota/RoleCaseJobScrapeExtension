// background.js

// CONFIGURATION
const API_BASE = "http://localhost:8000/api"; 
const PARSE_ENDPOINT = `${API_BASE}/job/parse`; 

// --- KEEPALIVE MECHANISM ---
let lifelines = {};

function keepAliveForJob(jobId) {
  if (!lifelines[jobId]) {
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

function pick(apiVal, scrapeVal) {
  if (apiVal && String(apiVal).trim().length > 0) return apiVal;
  return scrapeVal;
}

// 1. Listen for "SCRAPE" messages from scrape.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "JOB_SCRAPED") {
    handleNewScrape(message.data);
  }
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

  await saveJobToStorage(newJob);
  keepAliveForJob(jobId);
  parseJob(newJob);
}

// 3. The API Worker (AUTHENTICATED)
async function parseJob(job) {
  try {
    console.log(`[API] Sending Job ${job.id} to ${PARSE_ENDPOINT}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 Mins

    const response = await fetch(PARSE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include", // <--- CRITICAL: Sends Auth Cookie
      body: JSON.stringify({ text: job.original_text }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 401) throw new Error("Not logged in (Extension)");
      throw new Error(`Server Error: ${response.status}`);
    }

    const jsonResult = await response.json();
    console.log("API Parse Result:", jsonResult);

    job.parsed_result = {
      title: pick(jsonResult.title, job.scraped_meta.title),
      company: pick(jsonResult.company, job.scraped_meta.company),
      location: pick(jsonResult.location, job.scraped_meta.location),
      salary_range: pick(jsonResult.salary_range, job.scraped_meta.salary),
      date_posted: pick(jsonResult.date_posted, job.scraped_meta.date_posted),
      date_closing: pick(jsonResult.date_closing, job.scraped_meta.date_closing),
      date_extracted: pick(jsonResult.date_extracted, job.scraped_meta.date_extracted),
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