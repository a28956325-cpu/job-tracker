# Google Apps Script — Setup Instructions

## Overview

The Apps Script backend receives job data from the Chrome Extension, deduplicates it, stores it in a Google Sheet, and periodically syncs status updates from Gmail.

---

## Step 1: Create a Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new spreadsheet.
2. Name it something like **"Job Application Tracker"**.
3. Copy the spreadsheet URL — you'll need it for the extension settings.

---

## Step 2: Open Apps Script Editor

1. In your Google Sheet, click **Extensions → Apps Script**.
2. You'll see a default `Code.gs` file.

---

## Step 3: Add the Script Files

Create three files in the Apps Script editor:

### `Code.gs`
Replace the default contents with the contents of `Code.gs`.

### `GmailSync.gs`
Click **＋ (New file)** → select **Script** → name it `GmailSync` → paste the contents of `GmailSync.gs`.

### `Setup.gs`
Click **＋ (New file)** → select **Script** → name it `Setup` → paste the contents of `Setup.gs`.

---

## Step 4: Deploy as Web App

1. Click **Deploy → New deployment**.
2. Click the **gear icon** next to "Select type" and choose **Web app**.
3. Set:
   - **Execute as**: Me (your Google account)
   - **Who has access**: Anyone
4. Click **Deploy**.
5. Grant permissions when prompted.
6. **Copy the Web App URL** — you'll need this in the Chrome Extension settings.

---

## Step 5: Run initialSetup()

1. In the Apps Script editor, select `initialSetup` from the function dropdown.
2. Click **▶ Run**.
3. Grant Gmail permissions when prompted.
4. You should see a popup saying "Setup complete!".

This will:
- Create the **Applications** sheet with headers
- Set column widths and formatting
- Apply conditional formatting (green = Offer, blue = Interview, yellow = Applied, red = Rejected, gray = Ghosted)
- Create time-based triggers for Gmail sync

---

## Step 6: Verify Triggers

1. Click **Triggers** (alarm clock icon) in the left sidebar.
2. You should see:
   - `syncStatusFromGmail` — every 12 hours
   - `detectGhosted` — every 24 hours

---

## Sheet Columns

| Column | Description |
|--------|-------------|
| `app_id` | Unique ID for each application event |
| `timestamp` | When the job was viewed/applied |
| `company` | Company name |
| `role_title` | Job title |
| `jd_url` | URL to the job posting |
| `source` | Platform (LinkedIn, Greenhouse, etc.) |
| `resume_version` | Which resume version was used |
| `status` | Current status (Viewed, Applied, Interview, etc.) |
| `notes` | Auto-generated notes from Gmail sync |

---

## Gmail Sync Logic

The `syncStatusFromGmail()` function runs every 12 hours and:

1. Reads all rows where status is not a terminal state (Rejected, Offer, Withdrawn)
2. For each company, searches Gmail for relevant emails:
   - **Applied**: confirmation emails ("thank you for applying")
   - **Assessment**: coding challenge / HackerRank emails
   - **Interview**: interview scheduling emails
   - **Rejected**: rejection emails ("unfortunately", "not moving forward")
3. Updates the status if a higher-priority status is found

The `detectGhosted()` function runs every 24 hours and marks applications as "Ghosted" if:
- Status is "Applied"
- Application is older than 30 days
- No emails found from that company

---

## Troubleshooting

**Q: The web app URL is returning errors**
- Make sure you deployed as "Anyone" can access
- Re-deploy after any code changes (creates a new version)

**Q: Gmail sync isn't updating statuses**
- Check that you granted Gmail permissions (run `initialSetup()` again if needed)
- Verify the company names in your sheet match what appears in Gmail `from:` headers

**Q: Duplicate rows appearing**
- The Chrome extension has client-side dedup (7-day window)
- The Apps Script has server-side dedup checking last 2000 rows
- Check that `canonical_key` is stored in the notes column

**Q: "Execution failed" errors**
- Check Apps Script execution logs: **Executions** in the left sidebar
