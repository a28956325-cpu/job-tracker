document.addEventListener("DOMContentLoaded", async () => {
  const statusDot = document.getElementById("statusDot");
  const todayCount = document.getElementById("todayCount");
  const lastJobBlock = document.getElementById("lastJobBlock");
  const lastJobCompany = document.getElementById("lastJobCompany");
  const lastJobRole = document.getElementById("lastJobRole");
  const lastResumeBlock = document.getElementById("lastResumeBlock");
  const lastResumeFileName = document.getElementById("lastResumeFileName");
  const lastResumeDriveLink = document.getElementById("lastResumeDriveLink");
  const noUrl = document.getElementById("noUrl");
  const sheetLink = document.getElementById("sheetLink");
  const settingsLink = document.getElementById("settingsLink");
  const openSettings = document.getElementById("openSettings");

  // Load stored data
  chrome.storage.sync.get(["appsScriptUrl", "sheetUrl"], syncData => {
    chrome.storage.local.get(["todayCount", "todayDate", "lastJob", "lastResume"], localData => {
      const today = new Date().toDateString();

      // Connection status
      if (syncData.appsScriptUrl) {
        statusDot.className = "dot dot-green";
        statusDot.title = "Connected";
      } else {
        statusDot.className = "dot dot-red";
        statusDot.title = "Not configured";
        noUrl.style.display = "";
      }

      // Today count
      if (localData.todayDate === today) {
        todayCount.textContent = localData.todayCount || 0;
      } else {
        todayCount.textContent = 0;
      }

      // Last job
      if (localData.lastJob) {
        lastJobBlock.style.display = "";
        lastJobCompany.textContent = localData.lastJob.company || "";
        lastJobRole.textContent = localData.lastJob.role_title || "";
      }

      // Last resume
      if (localData.lastResume && localData.lastResume.fileName) {
        lastResumeBlock.style.display = "";
        lastResumeFileName.textContent = localData.lastResume.fileName;
        if (localData.lastResume.driveUrl) {
          lastResumeDriveLink.href = localData.lastResume.driveUrl;
          lastResumeDriveLink.style.display = "";
        }
      }

      // Sheet link
      if (syncData.sheetUrl) {
        sheetLink.href = syncData.sheetUrl;
        sheetLink.style.display = "";
      }
    });
  });

  // Settings link
  settingsLink.addEventListener("click", e => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  if (openSettings) {
    openSettings.addEventListener("click", e => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }
});
