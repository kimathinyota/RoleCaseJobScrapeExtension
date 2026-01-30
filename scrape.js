/* ------------------------------------------------
   1. FLATTENER (Schema Invariant)
------------------------------------------------ */
function flattenToText(obj) {
  if (obj === null || obj === undefined) return "";
  if (typeof obj === 'string' || typeof obj === 'number') return String(obj).trim();
  if (Array.isArray(obj)) return obj.map(flattenToText).filter(s => s.length > 0).join(", ");
  if (typeof obj === 'object') {
    const parts = [];
    for (const key in obj) {
      if (key.startsWith("@") || ["url", "sameAs", "logo"].includes(key)) continue;
      const val = flattenToText(obj[key]);
      if (val) parts.push(val);
    }
    return parts.join(" ");
  }
  return "";
}

/* ------------------------------------------------
   2. ATTRIBUTE EXTRACTORS
------------------------------------------------ */
function extractTitle(json) { return flattenToText(json.title); }
function extractCompany(json) { return flattenToText(json.hiringOrganization); }
function extractLocation(json) { return flattenToText(json.jobLocation); }
function extractDatePosted(json) { return flattenToText(json.datePosted)?.split('T')[0] || null; }
function extractDateClosing(json) { return flattenToText(json.validThrough)?.split('T')[0] || null; }

function extractDescription(json) {
  const raw = flattenToText(json.description);
  if (raw.includes("<")) {
    const tmp = document.createElement("DIV");
    tmp.innerHTML = raw;
    return tmp.innerText || tmp.textContent || "";
  }
  return raw;
}

function extractSalary(json) {
  if (!json.baseSalary) return null;
  if (typeof json.baseSalary !== 'object') return flattenToText(json.baseSalary);
  
  const root = json.baseSalary;
  const val = root.value || {};
  const flat = { ...root, ...val };
  const min = flat.minValue || flat.value;
  const max = flat.maxValue;
  const currency = flat.currency || "GBP"; 
  const unit = flat.unitText || "";
  const sym = { "GBP": "£", "USD": "$", "EUR": "€" }[currency] || currency;

  if (min && max) return `${sym}${min} - ${sym}${max} ${unit}`;
  if (min) return `${sym}${min} ${unit}`;
  return flattenToText(json.baseSalary); 
}

/* ------------------------------------------------
   3. DOM SCRAPERS (The Tiers)
------------------------------------------------ */
function pick(selectors, root = document) {
  for (const s of selectors) {
    const el = root.querySelector(s);
    if (el && el.innerText.trim().length > 0) return el.innerText.trim();
  }
  return "";
}

// TIER 1: High Precision (Curated)
function scrapeIndeedDOM() {
  const p = document.querySelector("#jobsearch-ViewjobPaneWrapper") || document;
  return {
    desc: pick(["#jobDescriptionText", ".jobsearch-jobDescriptionText"], p),
    title: pick(["h1", ".jobsearch-JobInfoHeader-title"], p),
    company: pick(["div[data-company-name]"], p),
    location: pick([".companyLocation"], p)
  };
}

function scrapeLinkedInDOM() {
  return {
    desc: pick([".description__text", ".jobs-description__content", "#job-details"]),
    title: pick(["h1.top-card-layout__title", "h1"]),
    company: pick(["a.topcard__org-name-link"]),
    location: pick(["span.topcard__flavor--bullet"])
  };
}

// TIER 3: Generic Best Effort (Article/Main) WITH NOISE FILTER
function scrapeGenericDOM() {
  let desc = pick(["article", "main", ".job-description", ".description"]) || document.body.innerText;
  
  // THE FOOTER SLICER: Remove "Related jobs" to reduce noise
  const stopWords = ["Related jobs", "Similar jobs", "People also viewed", "You might also like"];
  const lower = desc.toLowerCase();
  
  for (const word of stopWords) {
    const idx = lower.lastIndexOf(word.toLowerCase());
    // Only chop if it's in the bottom 30% of text (so we don't accidentally chop a sentence)
    if (idx > -1 && idx > desc.length * 0.7) {
      console.log(`[RoleCase] Trimming noise: "${word}" found at index ${idx}`);
      desc = desc.substring(0, idx).trim();
    }
  }

  return {
    desc: desc,
    title: pick(["h1"]),
    company: pick([".company", ".org"]), 
    location: pick([".location"])
  };
}

/* ------------------------------------------------
   4. HELPERS
------------------------------------------------ */
function getJsonLd() {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const s of scripts) {
    try {
      const d = JSON.parse(s.textContent);
      if (d["@type"] === "JobPosting") return d;
      if (d["@graph"]) {
        const j = d["@graph"].find(i => i["@type"] === "JobPosting");
        if (j) return j;
      }
    } catch (e) { continue; }
  }
  return null;
}

function getMeta(name) {
  const el = document.querySelector(`meta[property='${name}']`) || document.querySelector(`meta[name='${name}']`);
  return el ? el.getAttribute("content") : "";
}

/* ------------------------------------------------
   5. MAIN ENGINE
------------------------------------------------ */
function scrapePage() {
  console.log("[RoleCase] Starting Smart Scrape...");
  const jsonLd = getJsonLd() || {};
  
  // 1. Baseline: JSON-LD
  let data = {
    title: extractTitle(jsonLd) || getMeta("og:title") || document.title,
    company: extractCompany(jsonLd) || getMeta("og:site_name"),
    location: extractLocation(jsonLd),
    salary: extractSalary(jsonLd),
    description: extractDescription(jsonLd),
    date_posted: extractDatePosted(jsonLd),
    date_closing: extractDateClosing(jsonLd),
    url: window.location.href,
    date_extracted: new Date().toISOString().split('T')[0]
  };
  console.log("[RoleCase] Baseline Data:", data);

  // 2. DOM Enhancement Logic
  const host = window.location.hostname;
  let domData = {};

  if (host.includes("indeed")) {
    console.log("[RoleCase] Using Indeed Strategy...");
    domData = scrapeIndeedDOM();
    // Indeed Rule: Always compare JSON vs DOM, pick longest.
    if (domData.desc && domData.desc.length > (data.description || "").length) {
       data.description = domData.desc;
    }
  } 
  else if (host.includes("linkedin")) {
    console.log("[RoleCase] Using LinkedIn Strategy...");
    domData = scrapeLinkedInDOM();
    if (domData.desc && domData.desc.length > (data.description || "").length) {
       data.description = domData.desc;
    }
  } 
  else {
    console.log("[RoleCase] Using Generic Strategy...");
    domData = scrapeGenericDOM();

    // GENERIC RULE: Prefer DOM formatting over JSON-LD text purity
    // If we found a DOM description and it's substantial (>500 chars), we take it 
    // because JSON-LD often lacks spaces/newlines (as you saw).
    if (domData.desc && domData.desc.length > 500) {
        console.log("[RoleCase] Preferring DOM Description (Better Formatting)");
        data.description = domData.desc;
    }
  }

  // 4. Fill gaps in metadata
  if (!data.title && domData.title) data.title = domData.title;
  if (!data.company && domData.company) data.company = domData.company;
  if (!data.location && domData.location) data.location = domData.location;

  // 5. Trim for API limits
  if (data.description.length > 25000) data.description = data.description.substring(0, 25000);

  return data;
}

/* ------------------------------------------------
   6. EXECUTION
------------------------------------------------ */
function scrapeAndSend() {
  try {
    const result = scrapePage();
    console.log("[RoleCase] Payload:", result);
    
    if (!result.description || result.description.length < 50) {
      alert("RoleCase: Could not detect job description.");
      return;
    }

    chrome.runtime.sendMessage({ type: "JOB_SCRAPED", data: result });
    showOverlay();
  } catch (e) {
    console.error(e);
    alert("RoleCase Error: " + e.message);
  }
}

function showOverlay() {
  const existing = document.getElementById("jobScraperOverlay");
  if (existing) existing.remove();
  const d = document.createElement("div");
  d.id = "jobScraperOverlay";
  d.textContent = "Job Queued!";
  Object.assign(d.style, {
    position: "fixed", bottom: "20px", right: "20px", 
    background: "#10B981", color: "white", padding: "12px 20px", 
    borderRadius: "8px", zIndex: "999999", fontWeight: "bold",
    boxShadow: "0 4px 12px rgba(0,0,0,0.2)"
  });
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 2500);
}

window.scrapeAndSend = scrapeAndSend;
chrome.runtime.onMessage.addListener((req) => {
  if (req.action === "TRIGGER_SCRAPE") scrapeAndSend();
});