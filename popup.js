const API_UPSERT = "http://localhost:8000/api/job/upsert"; // Adjust to your backend URL

document.addEventListener("DOMContentLoaded", () => {
  renderQueue();
  
  // 1. LISTEN FOR STORAGE UPDATES
  // This automatically refreshes the UI when the background script
  // receives the parsed data from your API.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.job_queue) {
      renderQueue();
    }
  });

  // 2. SCRAPE BUTTON ACTION (The "Trigger")
// 2. SCRAPE BUTTON ACTION (Updated)
  document.getElementById("scrapeBtn").addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (tab) {
      try {
        // Try sending a message first (cleanest way)
        await chrome.tabs.sendMessage(tab.id, { action: "TRIGGER_SCRAPE" });
      } catch (e) {
        // If message fails, the script might not be injected yet. Inject it now.
        console.log("Script not ready, injecting...", e);
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["scrape.js"]
        });
        
        // Wait 100ms for script to load, then trigger
        setTimeout(() => {
          chrome.tabs.sendMessage(tab.id, { action: "TRIGGER_SCRAPE" });
        }, 100);
      }
    }
  });

  // Clear Queue Action
  document.getElementById("clearBtn").addEventListener("click", () => {
    if(confirm("Clear all jobs from queue?")) {
      chrome.storage.local.set({ job_queue: {} });
    }
  });
  
  // Add new feature row manually
  document.getElementById("addFeatureBtn").addEventListener("click", () => {
    addFeatureRow({ type: 'responsibility', description: '' });
  });
});

/* ---------------------------------------------------------
   RENDER LOGIC (INBOX VIEW)
--------------------------------------------------------- */
function renderQueue() {
  const container = document.getElementById("queueContainer");
  
  chrome.storage.local.get(["job_queue"], (result) => {
    const queue = result.job_queue || {};
    // Sort by newest first
    const jobs = Object.values(queue).sort((a, b) => b.created_at - a.created_at);

    container.innerHTML = "";
    
    if (jobs.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          No jobs in queue.<br>Open a job description and click Scrape!
        </div>`;
      return;
    }

    jobs.forEach(job => {
      const card = document.createElement("div");
      
      // Determine styling based on status
      let statusClass = job.status; 
      // Simplify status for CSS
      if(job.status === 'parsing') statusClass = 'parsing';
      if(job.status === 'review') statusClass = 'review';
      
      card.className = `job-card ${statusClass}`;
      
      let statusLabel = "";
      if (job.status === "parsing") statusLabel = "⚡ Parsing...";
      if (job.status === "review") statusLabel = "✅ Ready to Review";
      if (job.status === "error") statusLabel = "❌ Error";
      if (job.status === "saved") statusLabel = "💾 Saved";

      const company = job.parsed_result?.company || job.scraped_meta?.company || "Unknown Company";
      const title = job.parsed_result?.title || job.scraped_meta?.title || "No Title";

      card.innerHTML = `
        <div class="card-header">
          <span>${company}</span>
          <span style="font-size:10px; opacity:0.8">${statusLabel}</span>
        </div>
        <div class="card-title">${title}</div>
        <div class="card-time">${new Date(job.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
      `;

      // Click handler: Only open editor if ready
      if (job.status === "review") {
        card.addEventListener("click", () => openEditor(job));
      } else if (job.status === "error") {
        card.addEventListener("click", () => alert("Error: " + job.error_msg));
      }

      container.appendChild(card);
    });
  });
}

/* ---------------------------------------------------------
   EDITOR LOGIC (FORM VIEW)
--------------------------------------------------------- */
function openEditor(job) {
  document.getElementById("queueContainer").classList.add("hidden");
  document.getElementById("editorContainer").classList.remove("hidden");
  // Hide main header buttons in edit mode
  document.querySelector(".header-top").classList.add("hidden");
  document.getElementById("scrapeBtn").classList.add("hidden");
  
  const data = job.parsed_result;
  
  // Populate Fields
  document.getElementById("editTitle").value = data.title || "";
  document.getElementById("editCompany").value = data.company || "";
  document.getElementById("editLocation").value = data.location || "";
  document.getElementById("editSalary").value = data.salary_range || "";
  document.getElementById("editUrl").value = data.job_url || "";
  
  // Render Features
  const featureList = document.getElementById("featureList");
  featureList.innerHTML = "";
  
  if (data.features && data.features.length > 0) {
    data.features.forEach(feat => addFeatureRow(feat));
  }

  // --- SAVE HANDLER ---
  const saveBtn = document.getElementById("saveJobBtn");
  // Clone to remove old event listeners
  const newSaveBtn = saveBtn.cloneNode(true);
  saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
  
  newSaveBtn.onclick = async () => {
    newSaveBtn.textContent = "Saving...";
    newSaveBtn.disabled = true;
    try {
      await sendToBackend(job.id);
      newSaveBtn.textContent = "Saved!";
      setTimeout(closeEditor, 1000);
    } catch (e) {
      alert("Error saving: " + e.message);
      newSaveBtn.textContent = "Save to Platform";
      newSaveBtn.disabled = false;
    }
  };

  // --- BACK HANDLER ---
  document.getElementById("backBtn").onclick = closeEditor;
}

function closeEditor() {
  document.getElementById("editorContainer").classList.add("hidden");
  document.getElementById("queueContainer").classList.remove("hidden");
  document.querySelector(".header-top").classList.remove("hidden");
  document.getElementById("scrapeBtn").classList.remove("hidden");
}

/* ---------------------------------------------------------
   HELPER: FEATURE ROW GENERATOR (Updated with all types)
--------------------------------------------------------- */
function addFeatureRow(feat) {
  const featureList = document.getElementById("featureList");
  const row = document.createElement("div");
  row.className = "feature-row";
  
  // Map your Python types to readable labels
  const options = [
    { val: "responsibility", label: "Responsibility" },
    { val: "hard_skill", label: "Hard Skill" },
    { val: "soft_skill", label: "Soft Skill" },
    { val: "experience", label: "Experience" },
    { val: "qualification", label: "Qualification" },
    { val: "requirement", label: "Requirement" },
    { val: "nice_to_have", label: "Nice to Have" },
    { val: "employer_mission", label: "Mission" },
    { val: "employer_culture", label: "Culture" },
    { val: "role_value", label: "Role Value" },
    { val: "benefit", label: "Benefit" },
    { val: "other", label: "Other" }
  ];

  // Generate the <option> tags dynamically
  // If the feature type isn't in our list (e.g. legacy data), default to 'requirement'
  const currentType = feat.type || "requirement";
  
  const optionsHtml = options.map(opt => {
    const isSelected = opt.val === currentType ? "selected" : "";
    return `<option value="${opt.val}" ${isSelected}>${opt.label}</option>`;
  }).join("");

  row.innerHTML = `
    <select class="feat-type">
      ${optionsHtml}
    </select>
    <input type="text" class="feat-desc" value="${(feat.description || '').replace(/"/g, '&quot;')}" />
    <button class="remove-feat">×</button>
  `;
  
  row.querySelector(".remove-feat").addEventListener("click", () => row.remove());
  featureList.appendChild(row);
}

/* ---------------------------------------------------------
   API COMMUNICATION
--------------------------------------------------------- */
async function sendToBackend(jobId) {
  // 1. Construct Payload matching JobUpsertPayload in models.py
  const payload = {
    title: document.getElementById("editTitle").value,
    company: document.getElementById("editCompany").value,
    location: document.getElementById("editLocation").value,
    salary_range: document.getElementById("editSalary").value,
    job_url: document.getElementById("editUrl").value,
    features: []
  };

  document.querySelectorAll(".feature-row").forEach(row => {
    const desc = row.querySelector(".feat-desc").value.trim();
    if (desc) {
      payload.features.push({
        type: row.querySelector(".feat-type").value,
        description: desc
      });
    }
  });

  // 2. Send to /upsert
  const res = await fetch(API_UPSERT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!res.ok) throw new Error("Failed to save to platform");

  // 3. Mark as saved locally
  chrome.storage.local.get(["job_queue"], (result) => {
    const queue = result.job_queue;
    if (queue[jobId]) {
      queue[jobId].status = "saved";
      chrome.storage.local.set({ job_queue: queue });
    }
  });
}