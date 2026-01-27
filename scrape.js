function pick(selectors, root = document) {
  for (const s of selectors) {
    const el = root.querySelector(s);
    if (el) return el.innerText.trim();
  }
  return "";
}

function pickHTML(selectors, root = document) {
  for (const s of selectors) {
    const el = root.querySelector(s);
    if (el) return el.innerHTML.trim();
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

function scrapeIndeed() {
  // Always anchor to the RIGHT JOB PANE
  const pane =
    document.querySelector("#jobsearch-ViewjobPaneWrapper") ||
    document.querySelector("#viewJobBody") ||
    document;

  /* -----------------------------
      1. TITLE
  ----------------------------- */
  const title = pick(
    [
      "h1",
      "h1.jobsearch-JobInfoHeader-title",
      "h1.jobsearch-JobTitle",
      "h1.css-1b4cr5z" // new style A/B tests
    ],
    pane
  );

  /* -----------------------------
      2. COMPANY
  ----------------------------- */
  const company = pick(
    [
      ".jobsearch-CompanyInfoWithoutHeaderImage div:first-child",
      ".jobsearch-InlineCompanyRating div:first-child",
      ".css-1c2ahsm.e1wnkr790",
      "div[data-company-name]",
      ".companyName",
      "a[data-testid='company-name']"
    ],
    pane
  );

  /* -----------------------------
      3. LOCATION
  ----------------------------- */
  const location = pick(
    [
      ".companyLocation",
      "div[data-testid='inlineHeader-companyLocation']",
      "div[data-testid='text-location']",
      ".jobsearch-CompanyInfoWithoutHeaderImage span:last-child",
      ".css-6z8o9s.eu4oa1w0"
    ],
    pane
  );

  /* -----------------------------
      4. JOB DESCRIPTION
  ----------------------------- */
  const description = pick(
    [
      "#jobDescriptionText",
      ".jobsearch-jobDescriptionText",
      "div#jobDescription",
      "div[data-testid='jobDetailsSection']"
    ],
    pane
  );

  /* -----------------------------
      5. JOB DETAILS (Pay, Job type, etc.)
  ----------------------------- */

  // Object to fill
  const details = {};

  // Job details section appears in many formats
  const detailSections = pane.querySelectorAll(
    "div[data-testid='job-details'], " +
      "div[id='jobDetailsSection'], " +
      "section.job-details, " +
      "div.css-1p0sjhy.e1wnkr790"
  );

  detailSections.forEach((section) => {
    // Labels like: Pay, Job Type, Shift & Schedule, Benefits, etc.
    const rows = section.querySelectorAll("div");

    rows.forEach((row) => {
      const label = row.querySelector("h3, h2, span[role='heading']");
      const value = row.querySelector("ul, span, div:not(:has(h3)):not(:has(h2))");

      if (label && value) {
        const key = label.innerText.trim();
        const val = value.innerText.trim();
        if (key && val) details[key] = val;
      }
    });
  });

  /* -----------------------------
      6. URL (use active job card ID if possible)
  ----------------------------- */
  let url = location.href;

  const activeCard =
    document.querySelector(".job_seen_beacon a[data-jk]") ||
    document.querySelector("a.tapItem--job");

  if (activeCard?.href) url = activeCard.href;

  /* -----------------------------
      FINAL RETURN
  ----------------------------- */
  return {
    url,
    title,
    company,
    location,
    description,
    details // { Pay: “…”, Job type: “…”, Shift & schedule: “…”, Benefits: “…” }
  };
}

function scrapeLinkedIn() {
  return {
    url: location.href,
    title: pick(["h1.top-card-layout__title", "h1"]),
    company: pick([
      "a.topcard__org-name-link",
      "span.topcard__flavor:nth-child(2)",
    ]),
    description: pick(["div.show-more-less-html__markup"]),
  };
}

function scrapeLever() {
  return {
    url: location.href,
    title: pick(["h2.posting-headline"]),
    company: pick(["div.posting-categories span"]),
    description: pick(["div.posting-description"]),
  };
}

function scrapeGreenhouse() {
  return {
    url: location.href,
    title: pick(["h1.app-title"]),
    company: pick(["div.company-name", ".employer"]),
    description: pick(["div#content", "div.job-description"]),
  };
}

function scrapeGeneric() {
  return {
    url: location.href,
    title: pick(["h1", "header h1"]),
    company: pick([".company", "[class*=company]"]),
    description: pick([".description", "section", "article"]),
  };
}

/* ------------------------------
   SCRAPE WRAPPER (AUTO + MANUAL)
--------------------------------*/
function scrapeAndSend() {
  const site = detectSite();

  const scraped =
    site === "indeed"
      ? scrapeIndeed()
      : site === "linkedin"
      ? scrapeLinkedIn()
      : site === "lever"
      ? scrapeLever()
      : site === "greenhouse"
      ? scrapeGreenhouse()
      : scrapeGeneric();

  chrome.runtime.sendMessage(scraped);

  // Show overlay UI
  const overlay = document.getElementById("jobScraperOverlay") || document.createElement("div");
  overlay.id = "jobScraperOverlay";
  overlay.textContent = "Job Scraped!";
  overlay.style.position = "fixed";
  overlay.style.bottom = "20px";
  overlay.style.right = "20px";
  overlay.style.background = "#111";
  overlay.style.color = "white";
  overlay.style.padding = "8px 14px";
  overlay.style.borderRadius = "8px";
  overlay.style.zIndex = "99999";
  document.body.appendChild(overlay);

  setTimeout(() => overlay.remove(), 2000); // fadeout
}

/* ------------------------------
   MUTATION OBSERVER FOR INDEED
--------------------------------*/
if (location.hostname.includes("indeed.com")) {
  const observer = new MutationObserver(() => {
    // Detect if right pane job content changed
    const paneTitle = document.querySelector(
      "#jobsearch-ViewjobPaneWrapper h1, #viewJobBody h1"
    );

    if (paneTitle) {
      scrapeAndSend();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

// Allow manual popup trigger also
scrapeAndSend();
