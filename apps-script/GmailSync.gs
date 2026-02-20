// ============================================================
// GmailSync.gs — Sync application statuses from Gmail
// ============================================================

// Status priority: higher index wins
var STATUS_PRIORITY = ["Viewed", "Ghosted", "Applied", "Assessment", "Interview", "Offer", "Rejected", "Withdrawn"];

// Terminal statuses — do not process further
var TERMINAL_STATUSES = ["Rejected", "Offer", "Withdrawn"];

// ---------------------------------------------------------------------------
// _getSettings — read all key/value pairs from the Settings sheet
// ---------------------------------------------------------------------------
function _getSettings() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var settingsSheet = ss.getSheetByName("Settings");
  var settings = {};
  if (!settingsSheet || settingsSheet.getLastRow() < 2) return settings;
  var data = settingsSheet.getRange(2, 1, settingsSheet.getLastRow() - 1, 2).getValues();
  for (var i = 0; i < data.length; i++) {
    var key = String(data[i][0]).trim();
    var val = String(data[i][1]).trim();
    if (key) settings[key] = val;
  }
  return settings;
}

// ---------------------------------------------------------------------------
// _writeSetting — write a single key/value to the Settings sheet
// ---------------------------------------------------------------------------
function _writeSetting(key, value) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var settingsSheet = ss.getSheetByName("Settings");
  if (!settingsSheet) return;
  var lastRow = settingsSheet.getLastRow();
  if (lastRow < 2) return;
  var data = settingsSheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === key) {
      settingsSheet.getRange(i + 2, 2).setValue(value);
      return;
    }
  }
  // Key not found — append a new row
  settingsSheet.appendRow([key, value]);
}

// ---------------------------------------------------------------------------
// _toGmailDateString — format a Date as YYYY/MM/DD for Gmail after: filter
// ---------------------------------------------------------------------------
function _toGmailDateString(date) {
  var y = date.getFullYear();
  var m = String(date.getMonth() + 1).padStart(2, "0");
  var d = String(date.getDate()).padStart(2, "0");
  return y + "/" + m + "/" + d;
}

// ---------------------------------------------------------------------------
// _getCutoffDate — return the effective Gmail cutoff date for a given row
// timestamp (LATER of global cutoff and timestamp - 2 days)
// ---------------------------------------------------------------------------
function _getCutoffDate(rowTimestamp, globalCutoff) {
  var rowDate = new Date(rowTimestamp);
  var rowBuffer = new Date(isNaN(rowDate.getTime()) ? globalCutoff : rowDate.getTime() - 2 * 24 * 60 * 60 * 1000);
  return rowBuffer > globalCutoff ? rowBuffer : globalCutoff;
}

// ---------------------------------------------------------------------------
// syncStatusFromGmail — runs every 12 hours via time trigger
// ---------------------------------------------------------------------------
function syncStatusFromGmail() {
  var settings = _getSettings();

  // Respect tracking_active flag
  if (settings["tracking_active"] === "FALSE") return;

  var globalCutoff = settings["gmail_cutoff_date"]
    ? new Date(settings["gmail_cutoff_date"])
    : new Date("2026-01-01");

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Applications");
  if (!sheet || sheet.getLastRow() < 2) return;

  var lastRow = sheet.getLastRow();
  var data = sheet.getRange(2, 1, lastRow - 1, 9).getValues();

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var company    = String(row[COL.COMPANY - 1]       || "");
    var currentStatus = String(row[COL.STATUS - 1]    || "");
    var timestamp  = String(row[COL.TIMESTAMP - 1]    || "");
    var notes      = String(row[COL.NOTES - 1]        || "");

    if (!company) continue;
    if (TERMINAL_STATUSES.indexOf(currentStatus) !== -1) continue;

    var cleanCompany = _cleanCompanyName(company);
    if (!cleanCompany) continue;

    var cutoffDate = _getCutoffDate(timestamp, globalCutoff);
    var afterFilter = " after:" + _toGmailDateString(cutoffDate);

    var bestStatus = currentStatus || "Applied";
    var bestNote   = "";

    // Check each status pattern in ascending priority
    var checks = [
      {
        query: 'from:' + cleanCompany + ' ("thank you for applying" OR "application received" OR "successfully submitted" OR "we received your application")' + afterFilter,
        newStatus: "Applied",
      },
      {
        query: 'from:' + cleanCompany + ' (assessment OR "online assessment" OR "coding challenge" OR "technical assessment" OR HackerRank OR HireVue OR Codility)' + afterFilter,
        newStatus: "Assessment",
      },
      {
        query: 'from:' + cleanCompany + ' (interview OR "schedule a call" OR "next steps" OR "move forward" OR "phone screen" OR "video call" OR "recruiter call")' + afterFilter,
        newStatus: "Interview",
      },
      {
        query: 'from:' + cleanCompany + ' (unfortunately OR regret OR "not moving forward" OR "other candidates" OR "not selected" OR "decided not to" OR "no longer" OR "filled the position")' + afterFilter,
        newStatus: "Rejected",
      },
    ];

    for (var c = 0; c < checks.length; c++) {
      try {
        var threads = GmailApp.search(checks[c].query, 0, 5);
        if (threads.length > 0) {
          var newStatus = checks[c].newStatus;
          if (_statusPriority(newStatus) > _statusPriority(bestStatus)) {
            bestStatus = newStatus;
            var msg = threads[0].getMessages()[0];
            bestNote = "Gmail: " + newStatus + " on " + _formatDate(msg.getDate());
          }
        }
      } catch (gmailErr) {
        // Gmail quota or permission error — skip
        Logger.log("Gmail search error for " + cleanCompany + ": " + gmailErr.message);
      }
    }

    // Update row if status improved
    if (bestStatus !== currentStatus && _statusPriority(bestStatus) > _statusPriority(currentStatus)) {
      var sheetRow = i + 2; // 1-based, skip header
      sheet.getRange(sheetRow, COL.STATUS).setValue(bestStatus);
      var newNotes = notes ? notes + " | " + bestNote : bestNote;
      sheet.getRange(sheetRow, COL.NOTES).setValue(newNotes);
    }

    // Rate-limit Gmail API calls
    Utilities.sleep(200);
  }
}

// ---------------------------------------------------------------------------
// discoverApplicationsFromGmail — create new rows for applications found only
// in Gmail (LinkedIn Easy Apply, Greenhouse, etc.)
// ---------------------------------------------------------------------------
function discoverApplicationsFromGmail() {
  var settings = _getSettings();
  if (settings["tracking_active"] === "FALSE") return;

  var globalCutoff = settings["gmail_cutoff_date"]
    ? new Date(settings["gmail_cutoff_date"])
    : new Date("2026-01-01");

  var afterFilter = " after:" + _toGmailDateString(globalCutoff);

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Applications");
  if (!sheet) return;

  // Build a set of existing company names (lower-cased) to avoid duplicates
  var existingCompanies = {};
  if (sheet.getLastRow() >= 2) {
    var existing = sheet.getRange(2, COL.COMPANY, sheet.getLastRow() - 1, 1).getValues();
    for (var e = 0; e < existing.length; e++) {
      var name = _cleanCompanyName(String(existing[e][0] || "")).toLowerCase();
      if (name) existingCompanies[name] = true;
    }
  }

  var confirmQuery = '("thank you for applying" OR "application received" OR "successfully submitted" OR "we received your application")' + afterFilter;

  var threads;
  try {
    // NOTE: GmailApp.search is limited to 50 results per call. If the user has
    // more than 50 confirmation emails after the cutoff date, some may be missed.
    // Run discoverApplicationsFromGmail multiple times or adjust the cutoff date
    // to narrow the search window if this becomes an issue.
    threads = GmailApp.search(confirmQuery, 0, 50);
  } catch (err) {
    Logger.log("discoverApplicationsFromGmail search error: " + err.message);
    return;
  }

  var today = _formatDate(new Date());

  for (var t = 0; t < threads.length; t++) {
    try {
      var messages = threads[t].getMessages();
      if (!messages.length) continue;
      var firstMsg = messages[0];
      var senderEmail = firstMsg.getFrom();
      var subject = firstMsg.getSubject() || "";
      var msgDate = firstMsg.getDate();

      // Extract company name from sender display name or domain
      var company = _extractCompanyFromSender(senderEmail);
      if (!company) continue;

      var cleanCompany = _cleanCompanyName(company).toLowerCase();
      if (!cleanCompany) continue;

      // Skip if we already have this company in the sheet
      if (existingCompanies[cleanCompany]) continue;

      // Extract role title from subject if possible
      var roleTitle = _extractRoleTitleFromSubject(subject) || "Unknown";

      // Add to sheet
      var appId = _generateDiscoveredAppId(msgDate);
      sheet.appendRow([
        appId,
        _formatDate(msgDate),
        company,
        roleTitle,
        "",    // jd_url unknown
        "Gmail",
        "UNKNOWN",
        "Applied",
        "auto-discovered from Gmail on " + today,
      ]);

      // Mark as seen to avoid duplicates on the next run
      existingCompanies[cleanCompany] = true;

      Utilities.sleep(100);
    } catch (err) {
      Logger.log("discoverApplicationsFromGmail row error: " + err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// _extractCompanyFromSender — extract company name from "Display Name <email>"
// ---------------------------------------------------------------------------
function _extractCompanyFromSender(sender) {
  // Try display name first: "Company Name <email@domain.com>"
  var displayMatch = sender.match(/^([^<]+)</);
  if (displayMatch) {
    var display = displayMatch[1].trim()
      .replace(/\bno[-\s]?reply\b/i, "")
      .replace(/\bdo[-\s]?not[-\s]?reply\b/i, "")
      .replace(/\bcareers?\b/i, "")
      .replace(/\bjobs?\b/i, "")
      .replace(/\brecruiting\b/i, "")
      .replace(/\brecruitment\b/i, "")
      .replace(/\btalent\b/i, "")
      .replace(/[<>@]/g, "")
      .trim();
    if (display && display.length > 1) return display;
  }

  // Fall back to domain
  var domainMatch = sender.match(/@([\w.-]+)/);
  if (domainMatch) {
    var parts = domainMatch[1].split(".");
    // Remove common hosting domains (greenhouse, workday, lever, etc.)
    var tld = parts[parts.length - 1];
    var sld = parts.length >= 2 ? parts[parts.length - 2] : "";
    var noiseHosts = ["greenhouse", "myworkdayjobs", "workday", "lever", "smartrecruiters", "jobvite"];
    if (noiseHosts.indexOf(sld) !== -1 && parts.length > 2) {
      sld = parts[parts.length - 3];
    }
    return sld.charAt(0).toUpperCase() + sld.slice(1);
  }

  return null;
}

// ---------------------------------------------------------------------------
// _extractRoleTitleFromSubject — attempt to pull job title from email subject
// ---------------------------------------------------------------------------
function _extractRoleTitleFromSubject(subject) {
  if (!subject) return null;
  // Common patterns: "Your application for [Role] at [Company]"
  var patterns = [
    /application for (.+?) at /i,
    /applied for (.+?) at /i,
    /applied to (.+?) at /i,
    /re: (.+?) - application/i,
    /application: (.+)/i,
  ];
  for (var p = 0; p < patterns.length; p++) {
    var m = subject.match(patterns[p]);
    if (m) return m[1].trim();
  }
  return null;
}

// ---------------------------------------------------------------------------
// _generateDiscoveredAppId — generate an app_id from a Date
// ---------------------------------------------------------------------------
function _generateDiscoveredAppId(date) {
  var d = date || new Date();
  var pad = function(n) { return String(n).padStart(2, "0"); };
  return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
    "-" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) +
    "-" + String(Math.floor(Math.random() * 1000)).padStart(3, "0");
}

// ---------------------------------------------------------------------------
// detectGhosted — mark unanswered applications as Ghosted after N days
// ---------------------------------------------------------------------------
function detectGhosted() {
  var settings = _getSettings();
  if (settings["tracking_active"] === "FALSE") return;

  var ghostedDays = parseInt(settings["ghosted_days"] || "30", 10);

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Applications");
  if (!sheet || sheet.getLastRow() < 2) return;

  var lastRow = sheet.getLastRow();
  var data = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
  var now = new Date();
  var cutoffMs = ghostedDays * 24 * 60 * 60 * 1000;

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var company       = String(row[COL.COMPANY - 1]    || "");
    var currentStatus = String(row[COL.STATUS - 1]     || "");
    var timestamp     = row[COL.TIMESTAMP - 1];
    var notes         = String(row[COL.NOTES - 1]      || "");

    // Only check rows that are "Applied" (not Viewed — those may not have confirmed application)
    if (currentStatus !== "Applied") continue;

    var appDate = new Date(timestamp);
    if (isNaN(appDate.getTime()) || appDate > new Date(now.getTime() - cutoffMs)) continue;

    var cleanCompany = _cleanCompanyName(company);
    if (!cleanCompany) continue;

    try {
      var threads = GmailApp.search("from:" + cleanCompany, 0, 1);
      if (threads.length === 0) {
        var sheetRow = i + 2;
        sheet.getRange(sheetRow, COL.STATUS).setValue("Ghosted");
        var ghostNote = "auto-marked after " + ghostedDays + " days of no response";
        var newNotes = notes ? notes + " | " + ghostNote : ghostNote;
        sheet.getRange(sheetRow, COL.NOTES).setValue(newNotes);
      }
    } catch (err) {
      Logger.log("Gmail error for ghosted check (" + cleanCompany + "): " + err.message);
    }

    Utilities.sleep(200);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function _statusPriority(status) {
  var idx = STATUS_PRIORITY.indexOf(status);
  return idx === -1 ? 0 : idx;
}

function _cleanCompanyName(name) {
  return name
    .replace(/,?\s*(Inc\.?|LLC\.?|Ltd\.?|Corp\.?|Co\.?|GmbH|S\.A\.)$/i, "")
    .replace(/\s*\(.*?\)\s*/g, "")   // remove parenthetical
    .replace(/\s+\d{4,}\s*$/, "")    // remove trailing numbers like "2100"
    .replace(/[^a-zA-Z0-9 &.-]/g, "") // remove special chars
    .trim();
}

function _formatDate(date) {
  if (!date) return "";
  return (date.getMonth() + 1) + "/" + date.getDate() + "/" + date.getFullYear();
}
