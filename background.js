// background.js

// CONFIGURATION
const API_BASE = "http://localhost:8000/api"; // Adjust to your running server
const PARSE_ENDPOINT = `${API_BASE}/job/parse`; // Adjust if your route prefix differs

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
    status: "parsing", // parsing | review | error
    original_text: scrapedData.description, // For the parser
    scraped_meta: scrapedData, // Title, URL, etc. from the scraper
    parsed_result: null,
    created_at: timestamp,
    error_msg: null
  };

  // A. Save to storage immediately
  await saveJobToStorage(newJob);

  // B. Trigger the API call (Fire & Forget logic handled here)
  parseJob(newJob);
}

// 3. The API Worker
async function parseJob(job) {
  try {
    // Prepare payload for your Pydantic model: JobTextRequest(text=...)
    const response = await fetch(PARSE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: job.original_text })
    });

    if (!response.ok) {
      throw new Error(`Server Error: ${response.status}`);
    }

    const jsonResult = await response.json();

    console.log("API Parse Result:", jsonResult);

    // Merge API result with our job
    // We trust Llama's extracted fields, but fallback to scraper meta if null
    job.parsed_result = {
      title: jsonResult.title || job.scraped_meta.title,
      company: jsonResult.company || job.scraped_meta.company,
      location: jsonResult.location || job.scraped_meta.location,
      salary_range: jsonResult.salary_range,
      features: jsonResult.features || [],
      job_url: job.scraped_meta.url
    };
    
    job.status = "review";
    await saveJobToStorage(job);

  } catch (error) {
    console.error("Parsing failed:", error);
    job.status = "error";
    job.error_msg = error.message;
    await saveJobToStorage(job);
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