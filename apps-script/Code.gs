// ============================================================
// Code.gs — Main doPost / doGet handlers
// ============================================================

var SHEET_NAME = "Applications";
var DEDUPE_DAYS = 7;
var SCAN_ROWS = 2000;

// Column indices (1-based)
var COL = {
  APP_ID:         1,
  TIMESTAMP:      2,
  COMPANY:        3,
  ROLE_TITLE:     4,
  JD_URL:         5,
  SOURCE:         6,
  RESUME_VERSION: 7,
  STATUS:         8,
  NOTES:          9,
};

// ---------------------------------------------------------------------------
// doGet — test connection endpoint or get settings
// ---------------------------------------------------------------------------
function doGet(e) {
  var params = e && e.parameter ? e.parameter : {};
  if (params.action === "getSettings") {
    var settings = _readAllSettings();
    return jsonResponse({ ok: true, settings: settings });
  }
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, message: "Job Tracker Apps Script is running." }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------------
// doPost — receive job application data from Chrome extension
// ---------------------------------------------------------------------------
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // Handle settings updates
    if (data.action === "saveSettings") {
      var settingsSheet = ss.getSheetByName("Settings");
      if (!settingsSheet) return jsonResponse({ ok: false, error: "Settings sheet not found" });
      var allowedKeys = ["gmail_cutoff_date", "tracking_active", "ghosted_days"];
      for (var k = 0; k < allowedKeys.length; k++) {
        var key = allowedKeys[k];
        if (data[key] !== undefined) {
          _updateSettingRow(settingsSheet, key, String(data[key]));
        }
      }
      return jsonResponse({ ok: true });
    }

    // Validate required fields
    if (!data.canonical_key && !data.jd_url) {
      return jsonResponse({ ok: false, error: "Missing canonical_key or jd_url" });
    }

    var sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      _writeHeaders(sheet);
    }

    // Server-side deduplication
    var dupeResult = _checkDuplicate(sheet, data.canonical_key, data.jd_url);
    if (dupeResult.isDuplicate) {
      return jsonResponse({ ok: true, skipped: true, reason: "duplicate", row: dupeResult.row });
    }

    // Build notes: include canonical_key for future dedup lookups
    var notes = data.notes || "";
    if (data.canonical_key) {
      notes = notes ? notes + " | key:" + data.canonical_key : "key:" + data.canonical_key;
    }

    // Append row
    sheet.appendRow([
      data.app_id         || "",
      data.timestamp      || new Date().toLocaleString(),
      data.company        || "",
      data.role_title     || "",
      data.jd_url         || "",
      data.source         || "",
      data.resume_version || "UNKNOWN",
      data.status         || "Viewed",
      notes,
    ]);

    return jsonResponse({ ok: true, skipped: false });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// ---------------------------------------------------------------------------
// _checkDuplicate — scan last SCAN_ROWS rows for matching key/url within 7 days
// ---------------------------------------------------------------------------
function _checkDuplicate(sheet, canonicalKey, jdUrl) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { isDuplicate: false };

  var startRow = Math.max(2, lastRow - SCAN_ROWS + 1);
  var numRows = lastRow - startRow + 1;
  var data = sheet.getRange(startRow, 1, numRows, COL.NOTES).getValues();

  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - DEDUPE_DAYS);

  for (var i = data.length - 1; i >= 0; i--) {
    var row = data[i];
    var rowTimestamp = new Date(row[COL.TIMESTAMP - 1]);
    if (isNaN(rowTimestamp.getTime()) || rowTimestamp < cutoff) continue;

    var rowUrl = row[COL.JD_URL - 1];

    // canonical_key is stored in notes as "key:{canonical_key}"
    if (canonicalKey && String(row[COL.NOTES - 1]).indexOf("key:" + canonicalKey) !== -1) {
      return { isDuplicate: true, row: startRow + i };
    }
    if (jdUrl && rowUrl && _normalizeUrl(String(rowUrl)) === _normalizeUrl(String(jdUrl))) {
      return { isDuplicate: true, row: startRow + i };
    }
  }

  return { isDuplicate: false };
}

function _normalizeUrl(url) {
  return url.replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase();
}

function _writeHeaders(sheet) {
  sheet.appendRow(["app_id", "timestamp", "company", "role_title", "jd_url", "source", "resume_version", "status", "notes"]);
}

// ---------------------------------------------------------------------------
// jsonResponse helper
// ---------------------------------------------------------------------------
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------------
// _readAllSettings — read Settings sheet into a plain object
// ---------------------------------------------------------------------------
function _readAllSettings() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var settingsSheet = ss.getSheetByName("Settings");
  var result = {};
  if (!settingsSheet || settingsSheet.getLastRow() < 2) return result;
  var rows = settingsSheet.getRange(2, 1, settingsSheet.getLastRow() - 1, 2).getValues();
  for (var i = 0; i < rows.length; i++) {
    var key = String(rows[i][0]).trim();
    var val = String(rows[i][1]).trim();
    if (key) result[key] = val;
  }
  return result;
}

// ---------------------------------------------------------------------------
// _updateSettingRow — update or append a key/value in the Settings sheet
// ---------------------------------------------------------------------------
function _updateSettingRow(settingsSheet, key, value) {
  var lastRow = settingsSheet.getLastRow();
  if (lastRow >= 2) {
    var keys = settingsSheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) {
      if (String(keys[i][0]).trim() === key) {
        settingsSheet.getRange(i + 2, 2).setValue(value);
        return;
      }
    }
  }
  settingsSheet.appendRow([key, value]);
}
