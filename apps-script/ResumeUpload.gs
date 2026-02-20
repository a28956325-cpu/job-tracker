// ============================================================
// ResumeUpload.gs — Save resume to Google Drive and update sheet
// ============================================================

var DEFAULT_DRIVE_FOLDER = "Job Tracker Resumes";

// ---------------------------------------------------------------------------
// handleResumeUpload — called from doPost when action === "uploadResume"
// ---------------------------------------------------------------------------
function handleResumeUpload(data) {
  try {
    if (!data.fileData || !data.fileName || !data.mimeType) {
      return { ok: false, error: "Missing fileData, fileName, or mimeType" };
    }

    // 1. Decode base64 file data
    var decoded = Utilities.newBlob(
      Utilities.base64Decode(data.fileData),
      data.mimeType,
      _sanitizeFileName(data)
    );

    // 2. Get or create root folder
    var folderName = _getDriveFolderName(data);
    var rootFolder = _getOrCreateFolder(DriveApp.getRootFolder(), folderName);

    // 3. Get or create year subfolder
    var year = String(new Date().getFullYear());
    var yearFolder = _getOrCreateFolder(rootFolder, year);

    // 4. Save the file (inherits folder permissions — private to Drive owner)
    var file = yearFolder.createFile(decoded);
    var driveUrl = file.getUrl();

    // 5. Update the corresponding spreadsheet row
    if (data.canonicalKey || data.jdUrl) {
      _updateResumeVersion(data.canonicalKey, data.jdUrl, driveUrl);
    }

    return { ok: true, driveUrl: driveUrl };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// _sanitizeFileName — build a clean file name from metadata
// ---------------------------------------------------------------------------
function _sanitizeFileName(data) {
  var today = _todayString();
  var company = _sanitizeSegment(data.company || "");
  var role    = _sanitizeSegment(data.roleTitle || "");
  // Determine extension from mimeType or original filename
  var ext = _extensionFor(data.mimeType, data.fileName);

  var parts = [today];
  if (company) parts.push(company);
  if (role) parts.push(role);
  parts.push("resume");

  return parts.join("_") + "." + ext;
}

function _sanitizeSegment(str) {
  return str
    .replace(/[^a-zA-Z0-9 ]/g, "")  // remove special chars
    .trim()
    .replace(/\s+/g, "_")            // spaces → underscores
    .substring(0, 50);               // limit length
}

function _todayString() {
  var now = new Date();
  var y = now.getFullYear();
  var m = _pad2(now.getMonth() + 1);
  var d = _pad2(now.getDate());
  return y + "-" + m + "-" + d;
}

function _pad2(n) {
  return n < 10 ? "0" + n : String(n);
}

function _extensionFor(mimeType, fileName) {
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "application/msword") return "doc";
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  // Fall back to original file extension
  var m = (fileName || "").match(/\.([a-zA-Z0-9]+)$/);
  return m ? m[1].toLowerCase() : "pdf";
}

// ---------------------------------------------------------------------------
// _getOrCreateFolder — find subfolder by name or create it
// ---------------------------------------------------------------------------
function _getOrCreateFolder(parent, name) {
  var iter = parent.getFoldersByName(name);
  if (iter.hasNext()) return iter.next();
  return parent.createFolder(name);
}

// ---------------------------------------------------------------------------
// _getDriveFolderName — returns folder name from payload, script property, or default
// ---------------------------------------------------------------------------
function _getDriveFolderName(data) {
  if (data && data.driveFolderName) return data.driveFolderName;
  try {
    var props = PropertiesService.getScriptProperties();
    return props.getProperty("DRIVE_FOLDER_NAME") || DEFAULT_DRIVE_FOLDER;
  } catch (e) {
    return DEFAULT_DRIVE_FOLDER;
  }
}

// ---------------------------------------------------------------------------
// _updateResumeVersion — find the row and set resume_version to driveUrl
// ---------------------------------------------------------------------------
function _updateResumeVersion(canonicalKey, jdUrl, driveUrl) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return;

  var lastRow = sheet.getLastRow();
  var data = sheet.getRange(2, 1, lastRow - 1, COL.NOTES).getValues();

  for (var i = data.length - 1; i >= 0; i--) {
    var row = data[i];
    var rowNotes = String(row[COL.NOTES - 1] || "");
    var rowUrl   = String(row[COL.JD_URL - 1] || "");

    var matched = false;
    if (canonicalKey && rowNotes.indexOf("key:" + canonicalKey) !== -1) {
      matched = true;
    } else if (jdUrl && rowUrl && _normalizeUrl(rowUrl) === _normalizeUrl(jdUrl)) {
      matched = true;
    }

    if (matched) {
      sheet.getRange(i + 2, COL.RESUME_VERSION).setValue(driveUrl);
      return;
    }
  }
}

// String.prototype.padStart polyfill for older V8 in Apps Script — removed in favour of _pad2() utility
