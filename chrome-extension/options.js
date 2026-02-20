document.addEventListener("DOMContentLoaded", () => {
  const appsScriptUrlInput = document.getElementById("appsScriptUrl");
  const sheetUrlInput = document.getElementById("sheetUrl");
  const saveBtn = document.getElementById("saveBtn");
  const testBtn = document.getElementById("testBtn");
  const message = document.getElementById("message");

  // Load saved values
  chrome.storage.sync.get(["appsScriptUrl", "sheetUrl"], data => {
    if (data.appsScriptUrl) appsScriptUrlInput.value = data.appsScriptUrl;
    if (data.sheetUrl) sheetUrlInput.value = data.sheetUrl;
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
    chrome.storage.sync.set({ appsScriptUrl: url, sheetUrl: sheet }, () => {
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
