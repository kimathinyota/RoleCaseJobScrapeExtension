document.getElementById("extract").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["scrape.js"]
  });
});

chrome.runtime.onMessage.addListener((data) => {
  const output = document.getElementById("output");
  const container = document.getElementById("outputContainer");

  container.classList.remove("hidden");
  output.textContent = JSON.stringify(data, null, 2);

  // Save to local storage
  chrome.storage.local.get(["jobs"], (res) => {
    const jobs = res.jobs || [];
    jobs.push(data);
    chrome.storage.local.set({ jobs });
  });
});

document.getElementById("copy").addEventListener("click", () => {
  const text = document.getElementById("output").textContent;
  navigator.clipboard.writeText(text);
  alert("Copied to clipboard!");
});
