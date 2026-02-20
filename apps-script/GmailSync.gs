// ============================================================
// GmailSync.gs — Sync application statuses from Gmail
// ============================================================

// Status priority: higher index wins
var STATUS_PRIORITY = ["Viewed", "Ghosted", "Applied", "Assessment", "Interview", "Offer", "Rejected", "Withdrawn"];

// Terminal statuses — do not process further
var TERMINAL_STATUSES = ["Rejected", "Offer", "Withdrawn"];

// Generic email domains to skip when extracting company from sender address
var GENERIC_EMAIL_DOMAINS = ["greenhouse.io", "lever.co", "smartrecruiters.com", "myworkdayjobs.com", "gmail.com", "outlook.com", "yahoo.com"];

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

// ---------------------------------------------------------------------------
// backfillFromGmail — one-time scan of Gmail to discover past applications
// ---------------------------------------------------------------------------
function backfillFromGmail() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Applications");
  if (!sheet) return;

  // Get existing companies to avoid duplicates
  var lastRow = sheet.getLastRow();
  var existingCompanies = {};
  if (lastRow >= 2) {
    var data = sheet.getRange(2, COL.COMPANY, lastRow - 1, 1).getValues();
    for (var i = 0; i < data.length; i++) {
      if (data[i][0]) existingCompanies[String(data[i][0]).toLowerCase().trim()] = true;
    }
  }

  // Search Gmail for application confirmation emails
  var queries = [
    'subject:("thank you for applying" OR "application received" OR "application submitted" OR "we received your application" OR "application confirmation" OR "successfully submitted" OR "thanks for applying" OR "your application" OR "application for")',
    'subject:("thank you for your interest" OR "we have received" OR "application has been" OR "applied to" OR "position" OR "role")',
  ];

  var processedMessageIds = {};
  var addedCount = 0;

  for (var q = 0; q < queries.length; q++) {
    try {
      var fullQuery = queries[q] + ' after:2025/12/01';
      var threads = GmailApp.search(fullQuery, 0, 100);

      for (var t = 0; t < threads.length; t++) {
        var messages = threads[t].getMessages();
        var msg = messages[0]; // first message in thread

        // Skip if already processed
        var msgId = msg.getId();
        if (processedMessageIds[msgId]) continue;
        processedMessageIds[msgId] = true;

        var from = msg.getFrom();
        var subject = msg.getSubject();
        var date = msg.getDate();

        // Extract company name from sender
        var company = _extractCompanyFromEmail(from, subject);
        if (!company) continue;

        // Skip if company already in sheet
        if (existingCompanies[company.toLowerCase().trim()]) continue;

        // Extract role title from subject if possible
        var roleTitle = _extractRoleFromSubject(subject, company);

        var status = "Applied";

        // Create the row
        var appId = "gmail-" + Utilities.getUuid().substring(0, 8);
        var timestamp = Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

        sheet.appendRow([
          appId,
          timestamp,
          company,
          roleTitle || "Unknown Role",
          "", // jd_url
          "Gmail Backfill", // source
          "", // resume_version
          status,
          "Auto-discovered from Gmail on " + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd"),
        ]);

        existingCompanies[company.toLowerCase().trim()] = true;
        addedCount++;

        Utilities.sleep(100);
      }
    } catch (err) {
      Logger.log("Backfill search error: " + err.message);
    }
  }

  // Run status sync on the newly added rows to update statuses
  if (addedCount > 0) {
    syncStatusFromGmail();
  }

  SpreadsheetApp.getUi().alert("Backfill complete! Added " + addedCount + " applications from Gmail. Running status sync...");
}

function _extractCompanyFromEmail(from, subject) {
  // Try to extract from email address domain
  var emailMatch = from.match(/<([^>]+)>/);
  var email = emailMatch ? emailMatch[1] : from;
  var domain = email.split("@")[1] || "";

  // Skip generic domains
  var isGeneric = false;
  for (var i = 0; i < GENERIC_EMAIL_DOMAINS.length; i++) {
    if (domain.indexOf(GENERIC_EMAIL_DOMAINS[i]) !== -1) {
      isGeneric = true;
      break;
    }
  }

  if (!isGeneric && domain) {
    // Extract company from domain: "careers.dell.com" → "dell" → "Dell"
    var parts = domain.split(".");
    var companyPart = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    if (companyPart && companyPart.length > 1) {
      return companyPart.charAt(0).toUpperCase() + companyPart.slice(1);
    }
  }

  // Try to extract from the display name
  var nameMatch = from.match(/^"?([^"<]+)"?\s*</);
  if (nameMatch) {
    var name = nameMatch[1].trim();
    // Remove common suffixes
    name = name.replace(/\s*(careers|recruiting|talent|hr|jobs|hiring|team|no-?reply)\s*/gi, "").trim();
    if (name.length > 1) return name;
  }

  return null;
}

function _extractRoleFromSubject(subject, company) {
  if (!subject) return "";

  var patterns = [
    /applying (?:to|for) (?:the )?(.+?)(?:\s+at\s+|\s+[-–]\s+|\s*$)/i,
    /application (?:for|received:?\s*)(?:the )?(.+?)(?:\s+at\s+|\s+[-–]\s+|\s*$)/i,
    /position:?\s*(.+?)(?:\s+at\s+|\s+[-–]\s+|\s*$)/i,
    /role:?\s*(.+?)(?:\s+at\s+|\s+[-–]\s+|\s*$)/i,
  ];

  for (var i = 0; i < patterns.length; i++) {
    var match = subject.match(patterns[i]);
    if (match && match[1]) {
      var role = match[1].trim();
      // Remove company name from role if it's there
      role = role.replace(new RegExp("\\s*(?:at\\s+)?" + company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*", "gi"), "").trim();
      if (role.length > 2 && role.length < 100) return role;
    }
  }

  return "";
}
