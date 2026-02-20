// ============================================================
// Job Application Tracker — content_script.js
// Monitors file inputs and drag-drop zones for resume uploads
// ============================================================

const RESUME_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const RESUME_MIME_TYPES = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
const RESUME_KEYWORDS = ["resume", "cv", "upload"];

// Check if a file looks like a resume based on MIME type and nearby label text
function isResumeFile(file, inputElement) {
  if (!RESUME_MIME_TYPES.includes(file.type)) return false;

  // Check nearby label text for resume/CV keywords
  const labelText = getNearbyLabelText(inputElement);
  return RESUME_KEYWORDS.some(kw => labelText.toLowerCase().includes(kw));
}

// Get text content from nearby label or ancestor elements
function getNearbyLabelText(el) {
  if (!el) return "";
  const parts = [];

  // Check explicit <label for="..."> association
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label) parts.push(label.textContent);
  }

  // Check aria-label and placeholder
  if (el.getAttribute("aria-label")) parts.push(el.getAttribute("aria-label"));
  if (el.getAttribute("placeholder")) parts.push(el.getAttribute("placeholder"));
  if (el.getAttribute("name")) parts.push(el.getAttribute("name"));
  if (el.getAttribute("accept")) parts.push(el.getAttribute("accept"));

  // Walk up ancestors (up to 4 levels) to find label-like text
  let ancestor = el.parentElement;
  for (let i = 0; i < 4 && ancestor; i++) {
    parts.push(ancestor.textContent.slice(0, 200));
    ancestor = ancestor.parentElement;
  }

  return parts.join(" ");
}

// Read a file as base64 string
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // result is "data:<mime>;base64,<data>" — strip the prefix
      const base64 = reader.result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// Handle a candidate resume file
async function handleResumeFile(file, sourceElement) {
  if (!file) return;
  if (file.size > RESUME_MAX_BYTES) return;
  if (!isResumeFile(file, sourceElement)) return;

  let fileData;
  try {
    fileData = await readFileAsBase64(file);
  } catch (_) {
    return;
  }

  chrome.runtime.sendMessage({
    type: "RESUME_UPLOADED",
    fileName: file.name,
    fileData,
    mimeType: file.type,
    fileSize: file.size,
  });
}

// Attach change listener to a file input element
function attachFileInputListener(input) {
  if (input._resumeListenerAttached) return;
  input._resumeListenerAttached = true;

  input.addEventListener("change", () => {
    const files = input.files;
    if (!files || !files.length) return;
    for (const file of files) {
      handleResumeFile(file, input);
    }
  });
}

// Attach drop listener to a potential drag-drop zone element
function attachDropListener(el) {
  if (el._resumeDropListenerAttached) return;
  el._resumeDropListenerAttached = true;

  el.addEventListener("drop", e => {
    const files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;
    for (const file of files) {
      handleResumeFile(file, el);
    }
  });
}

// Selector for elements that are likely drag-drop upload zones (avoiding broad matches like "dropdown")
const DROP_ZONE_SELECTORS = [
  '[class~="dropzone"]',
  '[class~="drop-zone"]',
  '[class~="file-drop"]',
  '[data-testid*="upload"]',
  '[aria-label*="resume" i]',
  '[aria-label*="upload" i]',
].join(", ");

// Scan the document for file inputs and drop zones
function scanForInputs() {
  document.querySelectorAll('input[type="file"]').forEach(attachFileInputListener);

  // Attach to common drag-drop zone patterns
  document.querySelectorAll(DROP_ZONE_SELECTORS).forEach(attachDropListener);
}

// Initial scan
scanForInputs();

// Observe DOM mutations to catch dynamically added file inputs
const observer = new MutationObserver(mutations => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      if (node.matches && node.matches('input[type="file"]')) {
        attachFileInputListener(node);
      }
      node.querySelectorAll && node.querySelectorAll('input[type="file"]').forEach(attachFileInputListener);

      // Check for new drop zones
      if (node.matches && node.matches(DROP_ZONE_SELECTORS)) {
        attachDropListener(node);
      }
      node.querySelectorAll && node.querySelectorAll(DROP_ZONE_SELECTORS).forEach(attachDropListener);
    }
  }
});

observer.observe(document.documentElement, { childList: true, subtree: true });
