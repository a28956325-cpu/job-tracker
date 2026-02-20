document.addEventListener("DOMContentLoaded", () => {
  const appsScriptUrlInput = document.getElementById("appsScriptUrl");
  const sheetUrlInput = document.getElementById("sheetUrl");
  const driveFolderNameInput = document.getElementById("driveFolderName");
  const jobSearchStartDateInput = document.getElementById("jobSearchStartDate");
  const trackingPausedInput = document.getElementById("trackingPaused");
  const saveBtn = document.getElementById("saveBtn");
  const testBtn = document.getElementById("testBtn");
  const message = document.getElementById("message");

  // Load saved values
  chrome.storage.sync.get(["appsScriptUrl", "sheetUrl", "driveFolderName", "jobSearchStartDate", "trackingPaused"], data => {
    if (data.appsScriptUrl) appsScriptUrlInput.value = data.appsScriptUrl;
    if (data.sheetUrl) sheetUrlInput.value = data.sheetUrl;
    driveFolderNameInput.value = data.driveFolderName || "Job Tracker Resumes";
    if (data.jobSearchStartDate) jobSearchStartDateInput.value = data.jobSearchStartDate;
    trackingPausedInput.checked = !!data.trackingPaused;
  });

  function showMessage(text, type) {
    message.textContent = text;
    message.className = `message message-${type}`;
    message.style.display = "";
    setTimeout(() => { message.style.display = "none"; }, 4000);
  }

  saveBtn.addEventListener("click", () => {
    const url = appsScriptUrlInput.value.trim();
    const sheet = sheetUrlInput.value.trim();
    if (url && !url.startsWith("https://script.google.com/macros/s/")) {
      showMessage("Please enter a valid Google Apps Script Web App URL (should start with https://script.google.com/macros/s/).", "error");
      return;
    }
    const jobSearchStartDate = jobSearchStartDateInput.value.trim();
    const trackingPaused = trackingPausedInput.checked;
    chrome.storage.sync.set({
      appsScriptUrl: url,
      sheetUrl: sheet,
      driveFolderName: driveFolderNameInput.value.trim() || "Job Tracker Resumes",
      jobSearchStartDate,
      trackingPaused,
    }, () => {
      // Sync settings to Apps Script if URL is configured
      if (url) {
        const settingsPayload = {
          action: "saveSettings",
          gmail_cutoff_date: jobSearchStartDate,
          tracking_active: trackingPaused ? "FALSE" : "TRUE",
        };
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(settingsPayload),
        }).catch(err => {
          showMessage("Settings saved locally, but failed to sync to Apps Script: " + err.message, "error");
        });
      }
      showMessage("Settings saved!", "success");
    });
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
