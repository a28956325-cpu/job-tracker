// ============================================================
// Job Application Tracker — content_script.js
// Monitors resume file uploads on job apply pages
// ============================================================

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const RESUME_MIME_TYPES = ["application/pdf", "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
const RESUME_KEYWORDS = /resume|cv|curriculum\s*vitae|upload/i;

// ----------------------------------------------------------
// 1. Heuristic: does this file input look like a resume field?
// ----------------------------------------------------------
function looksLikeResumeInput(input) {
  // Check accept attribute
  const accept = (input.accept || "").toLowerCase();
  if (accept.includes("pdf") || accept.includes(".doc") || accept.includes("word")) return true;

  // Check nearby text (label, placeholder, aria-label, name, id)
  const attrs = ["name", "id", "placeholder", "aria-label", "title"].map(a => input.getAttribute(a) || "").join(" ");
  if (RESUME_KEYWORDS.test(attrs)) return true;

  // Walk up to find a nearby label or surrounding text
  let el = input;
  for (let i = 0; i < 5; i++) {
    el = el.parentElement;
    if (!el) break;
    if (RESUME_KEYWORDS.test(el.innerText || el.textContent || "")) return true;
  }

  return false;
}

// ----------------------------------------------------------
// 2. Handle a selected/dropped file
// ----------------------------------------------------------
function handleFile(file) {
  if (!file) return;

  // Only handle PDF/DOCX
  if (!RESUME_MIME_TYPES.includes(file.type)) return;

  // File size guard
  if (file.size > MAX_FILE_SIZE) {
    console.warn("[JobTracker] Resume file too large (max 10 MB):", file.name);
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    // reader.result is "data:<mime>;base64,<data>" — strip the prefix
    const dataUrl = reader.result;
    if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.includes(",")) return;
    const base64 = dataUrl.split(",")[1];
    if (!base64) return;
    chrome.runtime.sendMessage({
      type: "RESUME_UPLOADED",
      fileName: file.name,
      fileData: base64,
      mimeType: file.type,
      fileSize: file.size,
    });
  };
  reader.readAsDataURL(file);
}

// ----------------------------------------------------------
// 3. Attach listener to a file input if it looks like a resume
// ----------------------------------------------------------
function attachToInput(input) {
  if (input._resumeListenerAttached) return;
  if (!looksLikeResumeInput(input)) return;
  input._resumeListenerAttached = true;
  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    handleFile(file);
  });
}

// ----------------------------------------------------------
// 4. Attach drag-and-drop listeners to known drop zones
// ----------------------------------------------------------
function attachDropZones() {
  // Common selectors used by ATS platforms for drag-drop upload areas
  const selectors = [
    "[class*='dropzone']", "[class*='drop-zone']", "[class*='drop_zone']",
    "[class*='upload-area']", "[class*='upload_area']",
    "[data-testid*='resume']", "[data-testid*='upload']",
    "[aria-label*='resume' i]", "[aria-label*='upload' i]",
    "[id*='resume' i]", "[id*='upload' i]",
  ];
  document.querySelectorAll(selectors.join(",")).forEach(el => {
    if (el._resumeDropAttached) return;
    el._resumeDropAttached = true;
    el.addEventListener("drop", e => {
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      handleFile(file);
    });
  });
}

// ----------------------------------------------------------
// 5. Scan all current file inputs
// ----------------------------------------------------------
function scanInputs() {
  document.querySelectorAll('input[type="file"]').forEach(attachToInput);
  attachDropZones();
}

// ----------------------------------------------------------
// 6. MutationObserver for dynamically added inputs
// ----------------------------------------------------------
const observer = new MutationObserver(mutations => {
  let needsScan = false;
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      if (node.matches('input[type="file"]')) {
        needsScan = true;
        break;
      }
      if (node.querySelector('input[type="file"]')) {
        needsScan = true;
        break;
      }
    }
    if (needsScan) break;
  }
  if (needsScan) scanInputs();
});

observer.observe(document.body, { childList: true, subtree: true });

// Initial scan (DOM may already have inputs)
scanInputs();
