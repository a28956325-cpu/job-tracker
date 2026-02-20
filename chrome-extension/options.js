document.addEventListener("DOMContentLoaded", () => {
  const appsScriptUrlInput = document.getElementById("appsScriptUrl");
  const sheetUrlInput = document.getElementById("sheetUrl");
  const jobSearchStartDateInput = document.getElementById("jobSearchStartDate");
  const pauseToggleBtn = document.getElementById("pauseToggleBtn");
  const saveBtn = document.getElementById("saveBtn");
  const testBtn = document.getElementById("testBtn");
  const message = document.getElementById("message");

  let currentlyPaused = false;

  // Load saved values
  chrome.storage.sync.get(["appsScriptUrl", "sheetUrl", "jobSearchStartDate", "trackingPaused"], data => {
    if (data.appsScriptUrl) appsScriptUrlInput.value = data.appsScriptUrl;
    if (data.sheetUrl) sheetUrlInput.value = data.sheetUrl;
    if (data.jobSearchStartDate) jobSearchStartDateInput.value = data.jobSearchStartDate;
    currentlyPaused = !!data.trackingPaused;
    updatePauseButton();
  });

  function updatePauseButton() {
    pauseToggleBtn.textContent = currentlyPaused ? "▶️ Resume Tracking" : "⏸️ Pause Tracking";
  }

  function showMessage(text, type) {
    message.textContent = text;
    message.className = `message message-${type}`;
    message.style.display = "";
    setTimeout(() => { message.style.display = "none"; }, 4000);
  }

  pauseToggleBtn.addEventListener("click", () => {
    currentlyPaused = !currentlyPaused;
    updatePauseButton();
    chrome.storage.sync.set({ trackingPaused: currentlyPaused }, () => {
      if (currentlyPaused) {
        showMessage("⏸️ Tracking paused.", "success");
      } else {
        showMessage("▶️ Tracking resumed.", "success");
      }
    });
    // Also sync tracking_active to Apps Script if URL is configured
    const url = appsScriptUrlInput.value.trim();
    if (url) {
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "saveSettings", tracking_active: !currentlyPaused }),
      }).catch(err => console.warn("Failed to sync tracking_active to Apps Script:", err));
    }
  });

  saveBtn.addEventListener("click", () => {
    const url = appsScriptUrlInput.value.trim();
    const sheet = sheetUrlInput.value.trim();
    const startDate = jobSearchStartDateInput.value.trim();
    if (url && !url.startsWith("https://script.google.com/macros/s/")) {
      showMessage("Please enter a valid Google Apps Script Web App URL (should start with https://script.google.com/macros/s/).", "error");
      return;
    }
    chrome.storage.sync.set({ appsScriptUrl: url, sheetUrl: sheet, jobSearchStartDate: startDate }, () => {
      showMessage("Settings saved!", "success");
    });
    // Sync gmail_cutoff_date to Apps Script if URL and date are configured
    if (url && startDate) {
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "saveSettings", gmail_cutoff_date: startDate }),
      }).catch(err => console.warn("Failed to sync gmail_cutoff_date to Apps Script:", err));
    }
  });

  testBtn.addEventListener("click", async () => {
    const url = appsScriptUrlInput.value.trim();
    if (!url) {
      showMessage("Please enter an Apps Script URL first.", "error");
      return;
    }
    testBtn.disabled = true;
    testBtn.textContent = "Testing…";
    try {
      const resp = await fetch(`${url}?test=1`, { method: "GET" });
      if (resp.ok) {
        showMessage("✅ Connection successful!", "success");
      } else {
        showMessage(`⚠️ Server responded with status ${resp.status}.`, "error");
      }
    } catch (err) {
      showMessage(`❌ Connection failed: ${err.message}`, "error");
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = "Test Connection";
    }
  });
});
