// ============================================================
// GmailSync.gs — Sync application statuses from Gmail
// ============================================================

// Status priority: higher index wins
var STATUS_PRIORITY = ["Viewed", "Ghosted", "Applied", "Assessment", "Interview", "Offer", "Rejected", "Withdrawn"];

// Terminal statuses — do not process further
var TERMINAL_STATUSES = ["Rejected", "Offer", "Withdrawn"];

// ---------------------------------------------------------------------------
// syncStatusFromGmail — runs every 12 hours via time trigger
// ---------------------------------------------------------------------------
function syncStatusFromGmail() {
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

    var bestStatus = currentStatus || "Viewed";
    var bestNote   = "";

    // Check each status pattern in ascending priority
    var checks = [
      {
        query: 'from:' + cleanCompany + ' ("thank you for applying" OR "application received" OR "successfully submitted" OR "we received your application")',
        newStatus: "Applied",
      },
      {
        query: 'from:' + cleanCompany + ' (assessment OR "online assessment" OR "coding challenge" OR "technical assessment" OR HackerRank OR HireVue OR Codility)',
        newStatus: "Assessment",
      },
      {
        query: 'from:' + cleanCompany + ' (interview OR "schedule a call" OR "next steps" OR "move forward" OR "phone screen" OR "video call" OR "recruiter call")',
        newStatus: "Interview",
      },
      {
        query: 'from:' + cleanCompany + ' (unfortunately OR regret OR "not moving forward" OR "other candidates" OR "not selected" OR "decided not to" OR "no longer" OR "filled the position")',
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
// detectGhosted — mark unanswered applications as Ghosted after 30 days
// ---------------------------------------------------------------------------
function detectGhosted() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Applications");
  if (!sheet || sheet.getLastRow() < 2) return;

  var lastRow = sheet.getLastRow();
  var data = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
  var now = new Date();
  var thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var company       = String(row[COL.COMPANY - 1]    || "");
    var currentStatus = String(row[COL.STATUS - 1]     || "");
    var timestamp     = row[COL.TIMESTAMP - 1];
    var notes         = String(row[COL.NOTES - 1]      || "");

    // Only check rows that are "Applied" (not Viewed — those may not have confirmed application)
    if (currentStatus !== "Applied") continue;

    var appDate = new Date(timestamp);
    if (isNaN(appDate.getTime()) || appDate > thirtyDaysAgo) continue;

    var cleanCompany = _cleanCompanyName(company);
    if (!cleanCompany) continue;

    try {
      var threads = GmailApp.search("from:" + cleanCompany, 0, 1);
      if (threads.length === 0) {
        var sheetRow = i + 2;
        sheet.getRange(sheetRow, COL.STATUS).setValue("Ghosted");
        var ghostNote = "auto-marked after 30 days of no response";
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
