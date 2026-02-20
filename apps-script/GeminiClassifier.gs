// ============================================================
// GeminiClassifier.gs — Gemini AI email classification
// ============================================================

/**
 * Classifies an email using Gemini 2.0 Flash to determine if it is a
 * job application email and extract company, role, and status.
 *
 * @param {string} from        - The "From" header of the email.
 * @param {string} subject     - The subject line of the email.
 * @param {string} bodySnippet - First ~1000 chars of the email body.
 * @returns {Object|null} Parsed classification object or null on failure.
 */
function classifyEmailWithGemini(from, subject, bodySnippet) {
  var apiKey = _getGeminiApiKey();
  if (!apiKey) {
    Logger.log("No Gemini API key found in Settings sheet");
    return null;
  }

  var prompt = 'Analyze this email and determine if it is a job application confirmation, rejection, interview invitation, or assessment notification.\n\n' +
    'Email From: ' + from + '\n' +
    'Email Subject: ' + subject + '\n' +
    'Email Body (first 1000 chars): ' + bodySnippet + '\n\n' +
    'Respond in JSON only, no markdown, no code fences:\n' +
    '{\n' +
    '  "is_job_application_email": true or false,\n' +
    '  "company": "actual company name (not ATS platform name)",\n' +
    '  "role": "job title/role or empty string if unknown",\n' +
    '  "status": "Applied" or "Rejected" or "Interview" or "Assessment" or "Other",\n' +
    '  "confidence": 0.0 to 1.0\n' +
    '}\n\n' +
    'Rules:\n' +
    '- If the email is NOT about a job application (e.g. school notifications, personal emails, newsletters), set is_job_application_email to false\n' +
    '- For company name: use the actual company, not the ATS/recruiting platform (e.g. "OpenAI" not "Ashby", "Scale AI" not "Greenhouse")\n' +
    '- For role: extract the specific job title if mentioned in the email. If no role is mentioned, return empty string ""\n' +
    '- Only set confidence above 0.8 if you are sure this is a job application email';

  var url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + apiKey;

  var payload = {
    contents: [{
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 256
    }
  };

  try {
    var response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    var json = JSON.parse(response.getContentText());
    var text = json.candidates[0].content.parts[0].text;

    // Strip markdown code fences if present
    text = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

    return JSON.parse(text);
  } catch (e) {
    Logger.log("Gemini API error: " + e.message);
    return null;
  }
}

/**
 * Reads the Gemini API key from the Settings sheet.
 * @returns {string|null} The API key string or null if not found.
 */
function _getGeminiApiKey() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var settingsSheet = ss.getSheetByName("Settings");
    if (settingsSheet && settingsSheet.getLastRow() >= 2) {
      var rows = settingsSheet.getRange(2, 1, settingsSheet.getLastRow() - 1, 2).getValues();
      for (var i = 0; i < rows.length; i++) {
        if (String(rows[i][0]).toLowerCase() === "gemini_api_key" && rows[i][1]) {
          return String(rows[i][1]);
        }
      }
    }
  } catch (e) {}
  return null;
}
