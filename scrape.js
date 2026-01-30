/* ------------------------------------------------
   HELPER FUNCTIONS (Scraping Logic)
------------------------------------------------ */
function pick(selectors, root = document) {
  for (const s of selectors) {
    const el = root.querySelector(s);
    if (el) return el.innerText.trim();
  }
  return "";
}

function detectSite() {
  const host = location.hostname;
  if (host.includes("indeed")) return "indeed";
  if (host.includes("linkedin")) return "linkedin";
  if (host.includes("lever")) return "lever";
  if (host.includes("greenhouse")) return "greenhouse";
  return "generic";
}

/* ------------------------------------------------
   SITE SPECIFIC SCRAPERS
------------------------------------------------ */
function scrapeIndeed() {
  const pane = document.querySelector("#jobsearch-ViewjobPaneWrapper") || 
               document.querySelector("#viewJobBody") || 
               document;

  const title = pick(["h1", "h1.jobsearch-JobInfoHeader-title"], pane);
  const company = pick([".jobsearch-CompanyInfoWithoutHeaderImage div:first-child", "div[data-company-name]"], pane);
  const location = pick([".companyLocation", "div[data-testid='inlineHeader-companyLocation']"], pane);
  const description = pick(["#jobDescriptionText", ".jobsearch-jobDescriptionText"], pane);

  let url = location.href;
  const activeCard = document.querySelector(".job_seen_beacon a[data-jk]");
  if (activeCard?.href) url = activeCard.href;

  return { title, company, location, description, url };
}

function scrapeLinkedIn() {
  return {
    url: location.href,
    title: pick(["h1.top-card-layout__title", "h1"]),
    company: pick(["a.topcard__org-name-link", "span.topcard__flavor:nth-child(2)"]),
    description: pick(["div.show-more-less-html__markup", ".description__text"]),
    location: pick(["span.topcard__flavor--bullet"])
  };
}

function scrapeGeneric() {
  return {
    url: location.href,
    title: pick(["h1"]),
    company: pick([".company"]),
    description: pick(["article", "main", "body"]),
    location: ""
  };
}

// ... (You can keep scrapeLever/Greenhouse here if you wish) ...

/* ------------------------------------------------
   MAIN SENDER LOGIC
------------------------------------------------ */
function scrapeAndSend() {
  const site = detectSite();
  let scraped = {};

  try {
    if (site === "indeed") scraped = scrapeIndeed();
    else if (site === "linkedin") scraped = scrapeLinkedIn();
    else scraped = scrapeGeneric();
  } catch (e) {
    console.error("Scraping error:", e);
    alert("Could not scrape this page structure.");
    return;
  }

  if (!scraped.description && !scraped.title) {
    alert("Scraper found no data. Make sure a job is open!");
    return;
  }

  // Send to Background Script
  try {
    console.log("Sending scraped data to background:", scraped);
    chrome.runtime.sendMessage({ type: "JOB_SCRAPED", data: scraped });
    showOverlay();
  } catch (error) {
    console.error("Extension connection lost:", error);
    alert("Please refresh the page to reconnect the extension.");
  }
}

/* ------------------------------------------------
   OVERLAY FUNCTION (The Missing Piece)
------------------------------------------------ */
function showOverlay() {
  const existing = document.getElementById("jobScraperOverlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "jobScraperOverlay";
  overlay.textContent = "Job Queued for Parsing!";
  
  // Styles for the toast notification
  Object.assign(overlay.style, {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    background: "#27ae60",
    color: "white",
    padding: "12px 20px",
    borderRadius: "8px",
    zIndex: "999999",
    boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
    fontFamily: "sans-serif",
    fontSize: "14px",
    fontWeight: "bold",
    animation: "fadeIn 0.3s ease-out"
  });

  document.body.appendChild(overlay);

  setTimeout(() => {
    overlay.style.opacity = "0";
    overlay.style.transition = "opacity 0.5s";
    setTimeout(() => overlay.remove(), 500);
  }, 2500);
}

/* ------------------------------------------------
   LISTENERS
------------------------------------------------ */
// Allow manual triggering from console or other scripts
window.scrapeAndSend = scrapeAndSend;

// Auto-detect Indeed pane changes (optional)
if (location.hostname.includes("indeed.com")) {
  const observer = new MutationObserver(() => {
    // Logic to auto-button injection could go here
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// 2. ADD this listener:
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "TRIGGER_SCRAPE") {
    console.log("Scrape triggered via popup button");
    scrapeAndSend();
  }
});