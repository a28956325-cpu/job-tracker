// ============================================================
// ResumeUpload.gs — Save uploaded resume to Google Drive
// and link in the Applications sheet
// ============================================================

function handleResumeUpload(data) {
  try {
    var folderName = data.driveFolderName || "Job Tracker Resumes";
    var year = new Date().getFullYear().toString();

    // 1. Create/find root folder
    var rootFolder = _getOrCreateFolder(DriveApp.getRootFolder(), folderName);

    // 2. Create/find year subfolder
    var yearFolder = _getOrCreateFolder(rootFolder, year);

    // 3. Decode base64 file data to blob
    var ext = data.mimeType === "application/pdf" ? "pdf" : "docx";
    var today = _formatDate(new Date());
    var company = _sanitizeName(data.company || "Unknown");
    var role = _sanitizeName(data.roleTitle || "Unknown");
    var safeFileName = today + "_" + company + "_" + role + "_resume." + ext;

    var decoded = Utilities.base64Decode(data.fileData);
    var blob = Utilities.newBlob(decoded, data.mimeType, safeFileName);

    // 4. Save file to Drive
    var driveFile = yearFolder.createFile(blob);
    var driveUrl = driveFile.getUrl();

    // 5. Find and update the matching row in the Applications sheet
    _updateResumeUrl(data.canonicalKey, data.jdUrl, driveUrl);

    return { ok: true, driveUrl: driveUrl };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Get or create a named subfolder within a parent folder
function _getOrCreateFolder(parent, name) {
  var iter = parent.getFoldersByName(name);
  if (iter.hasNext()) return iter.next();
  return parent.createFolder(name);
}

// Format a date as YYYY-MM-DD
function _formatDate(date) {
  var y = date.getFullYear();
  var m = String(date.getMonth() + 1).padStart(2, "0");
  var d = String(date.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}

// Sanitize a string for use in a filename: remove special chars, limit length
function _sanitizeName(name) {
  return name
    .replace(/[^a-zA-Z0-9\s_-]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 40);
}

// Find matching row by canonical_key or jd_url and set resume_version to driveUrl
function _updateResumeUrl(canonicalKey, jdUrl, driveUrl) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) return;

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var numRows = lastRow - 1;
  var data = sheet.getRange(2, 1, numRows, COL.NOTES).getValues();

  for (var i = data.length - 1; i >= 0; i--) {
    var row = data[i];
    var rowNotes = String(row[COL.NOTES - 1]);
    var rowUrl = String(row[COL.JD_URL - 1]);

    var matched = false;
    if (canonicalKey && rowNotes.indexOf("key:" + canonicalKey) !== -1) {
      matched = true;
    } else if (jdUrl && rowUrl && _normalizeUrl(rowUrl) === _normalizeUrl(jdUrl)) {
      matched = true;
    }

    if (matched) {
      sheet.getRange(2 + i, COL.RESUME_VERSION).setValue(driveUrl);
      return;
    }
  }
}
