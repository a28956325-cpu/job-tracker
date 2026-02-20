// ============================================================
// Setup.gs — One-time sheet setup and trigger creation
// ============================================================

var HEADERS = ["app_id", "timestamp", "company", "role_title", "jd_url", "source", "resume_version", "status", "notes"];

var STATUS_COLORS = {
  "Offer":      "#c8e6c9", // green
  "Interview":  "#bbdefb", // blue
  "Assessment": "#e1bee7", // purple
  "Applied":    "#fff9c4", // yellow
  "Viewed":     "#ffffff", // white
  "Ghosted":    "#eeeeee", // gray
  "Rejected":   "#ffcdd2", // red
  "Withdrawn":  "#f5f5f5", // light gray
};

// ---------------------------------------------------------------------------
// initialSetup — run once to initialize the spreadsheet
// ---------------------------------------------------------------------------
function initialSetup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // Create or get the Applications sheet
  var sheet = ss.getSheetByName("Applications");
  if (!sheet) {
    sheet = ss.insertSheet("Applications");
  }

  // Write headers if the sheet is empty
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
  }

  // Format header row
  var headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
  headerRange.setFontWeight("bold");
  headerRange.setBackground("#1a1a2e");
  headerRange.setFontColor("#ffffff");
  headerRange.setFontSize(11);

  // Set column widths
  var colWidths = [160, 140, 140, 260, 400, 110, 110, 90, 300];
  for (var i = 0; i < colWidths.length; i++) {
    sheet.setColumnWidth(i + 1, colWidths[i]);
  }

  // Freeze header row
  sheet.setFrozenRows(1);

  // Apply conditional formatting for status column (col 8)
  _applyConditionalFormatting(sheet);

  // Create or get the Settings sheet
  var settingsSheet = ss.getSheetByName("Settings");
  if (!settingsSheet) {
    settingsSheet = ss.insertSheet("Settings");
    settingsSheet.appendRow(["setting_name", "setting_value"]);
    settingsSheet.appendRow(["gmail_cutoff_date", "2026-01-01"]);
    settingsSheet.appendRow(["tracking_active", "TRUE"]);
    settingsSheet.appendRow(["ghosted_days", "30"]);
    settingsSheet.appendRow(["openai_api_key", ""]);

    // Format header
    var settingsHeader = settingsSheet.getRange(1, 1, 1, 2);
    settingsHeader.setFontWeight("bold");
    settingsHeader.setBackground("#1a1a2e");
    settingsHeader.setFontColor("#ffffff");
    settingsSheet.setColumnWidth(1, 200);
    settingsSheet.setColumnWidth(2, 200);
  }

  // Create time-based triggers
  createTriggers();

  Logger.log("initialSetup complete.");
  SpreadsheetApp.getUi().alert("Setup complete! Triggers and formatting have been applied.");
}

// ---------------------------------------------------------------------------
// _applyConditionalFormatting
// ---------------------------------------------------------------------------
function _applyConditionalFormatting(sheet) {
  var lastRow = Math.max(sheet.getLastRow(), 1000);
  var statusColRange = sheet.getRange(2, 8, lastRow - 1, 1); // col 8 = status

  // Clear existing rules first
  sheet.clearConditionalFormatRules();
  var rules = [];

  for (var status in STATUS_COLORS) {
    var color = STATUS_COLORS[status];
    var rule = SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(status)
      .setBackground(color)
      .setRanges([statusColRange])
      .build();
    rules.push(rule);
  }

  sheet.setConditionalFormatRules(rules);
}

// ---------------------------------------------------------------------------
// createTriggers — delete existing and create fresh time-based triggers
// ---------------------------------------------------------------------------
function createTriggers() {
  // Delete all existing project triggers to avoid duplicates
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    ScriptApp.deleteTrigger(triggers[i]);
  }

  // syncStatusFromGmail every 12 hours
  ScriptApp.newTrigger("syncStatusFromGmail")
    .timeBased()
    .everyHours(12)
    .create();

  // detectGhosted every 24 hours
  ScriptApp.newTrigger("detectGhosted")
    .timeBased()
    .everyHours(24)
    .create();

  Logger.log("Triggers created: syncStatusFromGmail (12h), detectGhosted (24h)");
}
