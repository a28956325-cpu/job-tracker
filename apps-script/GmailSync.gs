// ============================================================
// GmailSync.gs — Sync application statuses from Gmail
// ============================================================

// Status priority: higher index wins
var STATUS_PRIORITY = ["Viewed", "Ghosted", "Applied", "Assessment", "Interview", "Offer", "Rejected", "Withdrawn"];

// Terminal statuses — do not process further
var TERMINAL_STATUSES = ["Rejected", "Offer", "Withdrawn"];

// ATS/recruiting platform domains — real company name must be extracted from sender display name or subject
var ATS_DOMAINS = {
  "greenhouse.io": true,
  "greenhouse-mail.io": true,
  "lever.co": true,
  "ashbyhq.com": true,
  "myworkdayjobs.com": true,
  "workday.com": true,
  "smartrecruiters.com": true,
  "icims.com": true,
  "jobvite.com": true,
  "breezy.hr": true,
  "jazz.co": true,
  "recruitee.com": true,
  "bamboohr.com": true,
};

// Domains to skip entirely — these are not job-application emails
var SKIP_DOMAINS = ["12twenty.com", "handshake.com", "piazza.com", "canvas.com"];

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
      if (data[i][0]) existingCompanies[_normalizeCompanyKey(String(data[i][0]))] = true;
    }
  }

  // Determine cutoff date from Settings sheet or default to 1 year ago
  var afterFilter = ' after:' + _getBackfillCutoffDate(ss);

  // Search Gmail for application confirmation emails — three broad query buckets
  var queries = [
    'subject:("thank you for applying" OR "application received" OR "application submitted" OR "we received your application" OR "application confirmation")',
    'subject:("successfully submitted" OR "thanks for applying" OR "your application to" OR "applied to" OR "application for the")',
    'subject:("thank you for your interest" OR "application has been received" OR "we have received your application")',
  ];

  var processedMessageIds = {};
  var addedCount = 0;

  for (var q = 0; q < queries.length; q++) {
    try {
      var fullQuery = queries[q] + afterFilter;
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

        // Skip if company already in sheet (normalized comparison)
        var companyKey = _normalizeCompanyKey(company);
        if (existingCompanies[companyKey]) continue;

        // Extract role title from subject if possible
        var roleTitle = _extractRoleFromSubject(subject, company);
        // Discard unfilled template variables (e.g. [m_legal_entity])
        if (roleTitle && /\[[^\]]+\]/.test(roleTitle)) roleTitle = "";

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

        existingCompanies[companyKey] = true;
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

// Return the cutoff date string (yyyy/M/d) for Gmail search.
// Reads "gmail_cutoff_date" from the Settings sheet; defaults to 1 year ago.
function _getBackfillCutoffDate(ss) {
  try {
    var settingsSheet = ss.getSheetByName("Settings");
    if (settingsSheet && settingsSheet.getLastRow() >= 2) {
      var rows = settingsSheet.getRange(2, 1, settingsSheet.getLastRow() - 1, 2).getValues();
      for (var i = 0; i < rows.length; i++) {
        if (String(rows[i][0]).toLowerCase() === "gmail_cutoff_date" && rows[i][1]) {
          return String(rows[i][1]);
        }
      }
    }
  } catch (e) {}
  var d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.getFullYear() + "/" + (d.getMonth() + 1) + "/" + d.getDate();
}

// Normalize a company name for duplicate comparison (lowercase, strip legal suffixes).
function _normalizeCompanyKey(name) {
  return name.toLowerCase()
    .replace(/,?\s*(inc\.?|llc\.?|ltd\.?|corp\.?|co\.?|gmbh|s\.a\.)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Strip trailing job-function words from a sender display name.
function _stripJobSuffix(name) {
  return name.replace(/\s*(careers|recruiting|talent|hr|jobs|hiring|team|no-?reply)\s*$/gi, "").trim();
}

function _extractCompanyFromEmail(from, subject) {
  // Parse display name and email address
  var nameMatch = from.match(/^"?([^"<]+)"?\s*</);
  var emailMatch = from.match(/<([^>]+)>/);
  var email = emailMatch ? emailMatch[1] : from.trim();
  var domain = (email.split("@")[1] || "").toLowerCase();

  // Skip domains that are never job-application senders
  for (var i = 0; i < SKIP_DOMAINS.length; i++) {
    if (domain === SKIP_DOMAINS[i] || domain.endsWith("." + SKIP_DOMAINS[i])) {
      return null;
    }
  }

  // Check whether the sender is an ATS platform
  var isATS = false;
  for (var atsDomain in ATS_DOMAINS) {
    if (domain === atsDomain || domain.endsWith("." + atsDomain)) {
      isATS = true;
      break;
    }
  }

  var displayName = nameMatch ? nameMatch[1].trim() : "";

  if (isATS) {
    // For ATS senders, the real company is in the display name or subject
    if (displayName) {
      // Strip " via [ATS name]" suffixes (e.g. "Scale AI via Greenhouse")
      var cleaned = _stripJobSuffix(displayName.replace(/\s+via\s+\S.*$/i, "").trim());
      if (cleaned.length > 1) return cleaned;
    }
    // Fallback: extract "at [Company]" from subject line
    // Allow any word character at the start to support names like eBay, 3M
    var atMatch = subject.match(/\bat\s+([A-Za-z0-9][A-Za-z0-9 &.,'-]{1,50})(?:\s*[.!?]|\s*[-–|]|\s*$)/);
    if (atMatch) {
      var co = atMatch[1].trim().replace(/[.!?,]+$/, "");
      if (co.length > 1) return co;
    }
    // Could not determine real company — skip this email
    return null;
  }

  // For non-ATS domains, prefer the display name (handles e.g. Meta via facebook.com)
  if (displayName) {
    var name = _stripJobSuffix(displayName);
    // Reject display names that are purely generic sender labels
    if (name.length > 1 && !/^(no-?reply|jobs?|hr|careers?|hiring|recruiting|team|talent|noreply)$/i.test(name)) {
      return name;
    }
  }

  // Fall back to extracting company from domain (e.g. "careers.dell.com" → "Dell")
  var genericDomains = ["gmail.com", "outlook.com", "yahoo.com", "hotmail.com", "icloud.com"];
  if (genericDomains.indexOf(domain) === -1 && domain) {
    var parts = domain.split(".");
    var companyPart = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    if (companyPart && companyPart.length > 1 && !/^\d+$/.test(companyPart)) {
      return companyPart.charAt(0).toUpperCase() + companyPart.slice(1);
    }
  }

  return null;
}

function _extractRoleFromSubject(subject, company) {
  if (!subject) return "";

  var escapedCompany = company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  var patterns = [
    // "applying to/for [Role] at [Company]"
    /applying (?:to|for) (?:the )?(.+?)(?:\s+at\s+|\s+[-–]\s+|\s*$)/i,
    // "application for/received [Role] at [Company]"
    /application (?:for|received:?\s*|submitted\s*(?:for)?\s*)(?:the )?(.+?)(?:\s+at\s+|\s+[-–]\s+|\s*$)/i,
    // "interest in [Role] at [Company]"
    /interest in (?:the )?(.+?)(?:\s+at\s+|\s+[-–]\s+|\s*$)/i,
    // "position: [Role]"
    /position:?\s*(.+?)(?:\s+at\s+|\s+[-–]\s+|\s*$)/i,
    // "role: [Role]"
    /role:?\s*(.+?)(?:\s+at\s+|\s+[-–]\s+|\s*$)/i,
    // "[Role] at [Company]" — company must start with an uppercase letter
    /^(.+?)\s+at\s+[A-Z]/,
  ];

  for (var i = 0; i < patterns.length; i++) {
    var match = subject.match(patterns[i]);
    if (match && match[1]) {
      var role = match[1].trim();
      // Strip leading separators or prepositions left by the pattern
      role = role.replace(/^[-–:,]\s*/, "").replace(/^(?:for|to)\s+/i, "").trim();
      // Remove company name if it crept into the role string
      role = role.replace(new RegExp("(?:^|\\s)" + escapedCompany + "(?:\\s|$)", "gi"), " ").trim();
      // Discard unfilled template variables (e.g. [m_legal_entity])
      if (/\[[^\]]+\]/.test(role)) continue;
      if (role.length > 2 && role.length < 100) return role;
    }
  }

  return "";
}
