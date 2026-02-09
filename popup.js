const API_BASE = "http://localhost:8000/api";
const API_UPSERT = `${API_BASE}/job/upsert`; 

// --- ROLLING AVERAGE CONFIG ---
const DEFAULT_AVG_TIME_MS = 60000; // Default 60 seconds
let intervalId = null;

document.addEventListener("DOMContentLoaded", () => {
  // 1. First, check if user is logged in
  checkSession();

  // Buttons
  document.getElementById("loginBtn").addEventListener("click", handleLogin);
  document.getElementById("logoutBtn").addEventListener("click", handleLogout);
  
  // App Buttons (Your original ones)
  document.getElementById("scrapeBtn").addEventListener("click", triggerScrape);
  document.getElementById("clearBtn").addEventListener("click", clearQueue);
  document.getElementById("addFeatureBtn").addEventListener("click", () => addFeatureRow({}));
  document.getElementById("backBtn").addEventListener("click", closeEditor);
  
  // Storage listener for realtime updates
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.job_queue) {
      renderQueue();
    }
  });
});

/* ------------------------------------------------
   0. AUTHENTICATION LOGIC
------------------------------------------------ */
async function checkSession() {
  try {
    const res = await fetch(`${API_BASE}/auth/me`, { credentials: 'include' });
    if (res.ok) {
      showAppView();
      renderQueue(); // Load data only when authed
    } else {
      showAuthView();
    }
  } catch (e) {
    showAuthView();
  }
}

function showAppView() {
  document.getElementById("auth-view").style.display = "none";
  document.getElementById("app-view").classList.remove("hidden");
}

function showAuthView() {
  document.getElementById("auth-view").style.display = "flex";
  document.getElementById("app-view").classList.add("hidden");
}

function handleLogin() {
  // Open Backend Google Login
  chrome.windows.create({
    url: `${API_BASE}/auth/login/google`,
    type: 'popup', width: 500, height: 600
  });
  
  // Poll until cookie is set
  const poll = setInterval(() => {
    fetch(`${API_BASE}/auth/me`, { credentials: 'include' })
      .then(res => {
        if (res.ok) {
          clearInterval(poll);
          showAppView();
          renderQueue();
        }
      }).catch(() => {});
  }, 1000);
}

function handleLogout() {
  fetch(`${API_BASE}/auth/logout`, { method: "POST", credentials: 'include' })
    .then(() => showAuthView());
}

/* ------------------------------------------------
   1. QUEUE RENDERING & PROGRESS LOGIC (Unchanged)
------------------------------------------------ */
function renderQueue() {
  const list = document.getElementById("queueList");
  
  chrome.storage.local.get(["job_queue", "stats"], (result) => {
    const queue = result.job_queue || {};
    const stats = result.stats || { avg_time_sec: 60 }; 
    const jobs = Object.values(queue).sort((a, b) => b.created_at - a.created_at);

    list.innerHTML = "";
    
    if (intervalId) clearInterval(intervalId);
    let parsingJobsExist = false;

    if (jobs.length === 0) {
      list.innerHTML = `<div class="empty-state">No jobs yet.<br>Click 'Import Job' to start.</div>`;
      return;
    }

    jobs.forEach(job => {
      const card = document.createElement("div");
      card.className = "job-card";
      
      const company = job.parsed_result?.company || job.scraped_meta?.company || "Parsing Company...";
      const title = job.parsed_result?.title || job.scraped_meta?.title || "Parsing Title...";
      const timeStr = new Date(job.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

      let statusHtml = "";
      
      if (job.status === "parsing") {
        parsingJobsExist = true;
        const now = Date.now();
        const elapsed = now - job.created_at;
        const estimatedTotal = stats.avg_time_sec * 1000;
        let percent = Math.min((elapsed / estimatedTotal) * 100, 95); 
        
        statusHtml = `
          <div class="progress-track">
            <div class="progress-fill" style="width: ${percent}%"></div>
          </div>
          <div class="status-text">
            <span>Analyzing...</span>
            <span>~${Math.ceil(Math.max(0, (estimatedTotal - elapsed)/1000))}s left</span>
          </div>
        `;
        card.classList.add("parsing");
      } 
      else if (job.status === "review") {
        statusHtml = `<div class="status-text" style="color:var(--primary)">✅ Ready to Review</div>`;
        card.addEventListener("click", () => openEditor(job));
      }
      else if (job.status === "saved") {
        statusHtml = `<div class="status-text" style="color:var(--success)">💾 Saved to RoleCase</div>`;
        card.classList.add("status-saved");
      }
      else if (job.status === "error") {
        statusHtml = `<div class="status-text" style="color:var(--error)">❌ Error: ${job.error_msg || "Failed"}</div>`;
      }

      card.innerHTML = `
        <div class="card-top">
          <span class="card-company">${company}</span>
          <span class="card-time">${timeStr}</span>
        </div>
        <div class="card-title">${title}</div>
        ${statusHtml}
      `;
      list.appendChild(card);
    });

    if (parsingJobsExist) {
      intervalId = setInterval(() => {
        renderQueue();
      }, 1000);
    }
  });
}

/* ------------------------------------------------
   2. EDITOR & SAVING (Slight Mod for Auth)
------------------------------------------------ */
function openEditor(job) {
  document.getElementById("queueView").classList.add("hidden");
  document.getElementById("editorView").classList.remove("hidden");
  document.getElementById("scrapeBtn").classList.add("hidden"); 
  document.querySelector(".header-actions").classList.add("hidden"); 
  
  const data = job.parsed_result;
  const safeVal = (v) => v || "";
  const safeDate = (d) => d ? d.split('T')[0] : ""; 

  document.getElementById("editTitle").value = safeVal(data.title);
  document.getElementById("editCompany").value = safeVal(data.company);
  document.getElementById("editLocation").value = safeVal(data.location);
  document.getElementById("editSalary").value = safeVal(data.salary_range);
  
  const urlField = document.getElementById("editUrl");
  const visitBtn = document.getElementById("visitUrlBtn");
  urlField.value = safeVal(data.job_url);
  if(visitBtn) visitBtn.href = safeVal(data.job_url);

  document.getElementById("editDatePosted").value = safeDate(data.date_posted);
  document.getElementById("editDateClosing").value = safeDate(data.date_closing);
  document.getElementById("editDateExtracted").value = safeDate(data.date_extracted);
  
  const list = document.getElementById("featureList");
  list.innerHTML = "";
  if (data.features) data.features.forEach(addFeatureRow);

  const saveBtn = document.getElementById("saveJobBtn");
  const newBtn = saveBtn.cloneNode(true);
  saveBtn.parentNode.replaceChild(newBtn, saveBtn);
  
  newBtn.onclick = async () => {
    newBtn.textContent = "Saving...";
    newBtn.disabled = true;
    try {
      await sendToBackend(job);
      newBtn.textContent = "Saved!";
      setTimeout(closeEditor, 800);
    } catch (e) {
      alert("Error saving: " + e.message);
      newBtn.textContent = "Save to RoleCase";
      newBtn.disabled = false;
    }
  };
}

function closeEditor() {
  document.getElementById("editorView").classList.add("hidden");
  document.getElementById("queueView").classList.remove("hidden");
  document.getElementById("scrapeBtn").classList.remove("hidden");
  document.querySelector(".header-actions").classList.remove("hidden");
}

/* ------------------------------------------------
   3. HELPERS (Unchanged)
------------------------------------------------ */
function addFeatureRow(feat) {
  const row = document.createElement("div");
  row.className = "feature-row";
  
  const typeOptions = `
    <option value="responsibility">Responsibility</option>
    <option value="hard_skill">Hard Skill</option>
    <option value="soft_skill">Soft Skill</option>
    <option value="qualification">Qualification</option>
    <option value="requirement">Requirement</option>
    <option value="benefit">Benefit</option>
    <option value="employer_mission">Mission</option>
    <option value="employer_culture">Culture</option>
    <option value="other">Other</option>
  `;

  row.innerHTML = `
    <select class="feat-type">${typeOptions}</select>
    <input type="text" class="feat-desc" value="${(feat.description || '').replace(/"/g, '&quot;')}" />
    <button class="remove-feat">×</button>
  `;

  const select = row.querySelector("select");
  if (feat.type) select.value = feat.type;
  
  row.querySelector(".remove-feat").onclick = () => row.remove();
  document.getElementById("featureList").appendChild(row);
}

async function triggerScrape() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  try {
    await chrome.tabs.sendMessage(tab.id, { action: "TRIGGER_SCRAPE" });
  } catch (e) {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["scrape.js"] });
    setTimeout(() => {
      chrome.tabs.sendMessage(tab.id, { action: "TRIGGER_SCRAPE" });
    }, 100);
  }
}

function clearQueue() {
  if(confirm("Clear history?")) chrome.storage.local.set({ job_queue: {} });
}

/* ------------------------------------------------
   4. API COMMUNICATION (UPDATED)
------------------------------------------------ */
async function sendToBackend(job) {
  const originalData = job.parsed_result;

  const payload = {
    title: document.getElementById("editTitle").value,
    company: document.getElementById("editCompany").value,
    location: document.getElementById("editLocation").value,
    salary_range: document.getElementById("editSalary").value,
    job_url: document.getElementById("editUrl").value,
    
    date_posted: document.getElementById("editDatePosted").value || null,
    date_closing: document.getElementById("editDateClosing").value || null,
    date_extracted: document.getElementById("editDateExtracted").value,
    
    description: originalData.description,
    displayed_description: originalData.displayed_description,

    features: []
  };

  document.querySelectorAll(".feature-row").forEach(row => {
    const val = row.querySelector(".feat-desc").value.trim();
    if(val) payload.features.push({ 
      type: row.querySelector("select").value, 
      description: val 
    });
  });

  // Post to API (Updated to include Cookie)
  const res = await fetch(API_UPSERT, {
    method: "POST", 
    headers: {"Content-Type": "application/json"},
    credentials: "include", // <--- CRITICAL FOR AUTH
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    if (res.status === 401) throw new Error("Session expired. Please re-login.");
    throw new Error("Backend Error " + res.status);
  }

  // Update Status in Local Storage
  chrome.storage.local.get(["job_queue", "stats"], (result) => {
    const queue = result.job_queue;
    const stats = result.stats || { count: 0, avg_time_sec: 60 };

    if (queue[job.id]) {
      queue[job.id].status = "saved";
      
      const meta = queue[job.id].parsed_result?._meta;
      if (meta && meta.generation_time_sec) {
        const n = stats.count;
        const newAvg = ((stats.avg_time_sec * n) + meta.generation_time_sec) / (n + 1);
        stats.count++;
        stats.avg_time_sec = newAvg;
      }
      
      chrome.storage.local.set({ job_queue: queue, stats: stats });
    }
  });
}