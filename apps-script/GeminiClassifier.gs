// ============================================================
// GeminiClassifier.gs → now OpenAI Classifier
// ============================================================

/**
 * Classifies an email using OpenAI GPT-4o-mini to determine if it is a
 * job application email and extract company, role, and status.
 *
 * @param {string} from        - The "From" header of the email.
 * @param {string} subject     - The subject line of the email.
 * @param {string} bodySnippet - First ~1000 chars of the email body.
 * @returns {Object|null} Parsed classification object or null on failure.
 */
function classifyEmailWithGemini(from, subject, bodySnippet) {
  // NOTE: Function name kept as classifyEmailWithGemini to avoid changing all callers
  // but now uses OpenAI GPT-4o-mini under the hood

  var apiKey = _getOpenAIApiKey();
  if (!apiKey) {
    Logger.log("No OpenAI API key found in Settings sheet");
    return null;
  }

  var systemPrompt = 'You are an email classifier for job applications. ' +
    'Analyze the email and respond in JSON only, no markdown, no code fences.\n' +
    'Response format:\n' +
    '{\n' +
    '  "is_job_application_email": true or false,\n' +
    '  "company": "actual company name (not ATS platform name)",\n' +
    '  "role": "job title/role or empty string if unknown",\n' +
    '  "status": "Applied" or "Rejected" or "Interview" or "Assessment" or "Other",\n' +
    '  "confidence": 0.0 to 1.0\n' +
    '}\n\n' +
    'Rules:\n' +
    '- If the email is NOT about a job application (e.g. school notifications, personal emails, newsletters, the user\'s own sent emails), set is_job_application_email to false\n' +
    '- For company name: use the actual company, not the ATS/recruiting platform (e.g. "OpenAI" not "Ashby", "Scale AI" not "Greenhouse", "Micron" not "Workday", "Adobe" not "Workday")\n' +
    '- For role: extract the specific job title if mentioned in the email. If no role is mentioned, return empty string ""\n' +
    '- Only set confidence above 0.8 if you are sure this is a job application email';

  var userPrompt = 'Email From: ' + from + '\n' +
    'Email Subject: ' + subject + '\n' +
    'Email Body (first 1000 chars): ' + bodySnippet;

  var url = 'https://api.openai.com/v1/chat/completions';

  var payload = {
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    temperature: 0.1,
    max_tokens: 256
  };

  try {
    var response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'Authorization': 'Bearer ' + apiKey
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    var responseCode = response.getResponseCode();
    if (responseCode !== 200) {
      Logger.log("OpenAI API error (HTTP " + responseCode + "): " + response.getContentText().substring(0, 300));
      return null;
    }

    var json = JSON.parse(response.getContentText());
    var text = json.choices[0].message.content;

    // Strip markdown code fences if present
    text = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

    return JSON.parse(text);
  } catch (e) {
    Logger.log("OpenAI API error: " + e.message);
    return null;
  }
}

/**
 * Reads the OpenAI API key from the Settings sheet.
 * Looks for setting_name "openai_api_key".
 * @returns {string|null} The API key string or null if not found.
 */
function _getOpenAIApiKey() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var settingsSheet = ss.getSheetByName("Settings");
    if (settingsSheet && settingsSheet.getLastRow() >= 2) {
      var rows = settingsSheet.getRange(2, 1, settingsSheet.getLastRow() - 1, 2).getValues();
      for (var i = 0; i < rows.length; i++) {
        if (String(rows[i][0]).toLowerCase() === "openai_api_key" && rows[i][1]) {
          return String(rows[i][1]);
        }
      }
    }
  } catch (e) {}
  return null;
}
