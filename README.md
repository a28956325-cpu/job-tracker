# Job Application Tracker

A Chrome Extension + Google Apps Script system that automatically tracks your job applications and syncs status updates from Gmail.

---

## What This Does

- **Chrome Extension** — Detects when you visit a job posting page (LinkedIn, Greenhouse, Lever, Workday, Tesla, Amazon, Meta, Microsoft, etc.), extracts the job info, and sends it to your Google Sheet automatically.
- **Google Apps Script** — Receives the data, deduplicates it (no more triple-counted jobs), stores it in a Google Sheet, and periodically scans Gmail to update statuses (Applied, Interview, Rejected, Ghosted, etc.).

### Key Features
- Smart URL detection — only records actual job detail pages, not search results or apply-flow sub-pages
- Company name extraction — correctly identifies "Scale AI" from Greenhouse instead of "Greenhouse"
- Client + server side deduplication — 7-day dedup window prevents duplicate rows
- Automatic Gmail status sync every 12 hours
- "Ghosted" detection — marks Applied jobs with no response after 30 days
- Status color-coding: 🟢 Offer, 🔵 Interview, 🟡 Applied, 🔴 Rejected, ⚫ Ghosted

---

## Setup Guide (English)

### Part 1: Google Apps Script Setup

1. **Create a Google Sheet**
   - Go to [sheets.google.com](https://sheets.google.com) and create a new spreadsheet.
   - Name it "Job Application Tracker" (or anything you like).
   - Copy the spreadsheet URL for later.

2. **Open Apps Script**
   - In your sheet, click **Extensions → Apps Script**.

3. **Add the script files**
   - Replace the default `Code.gs` with the content from `apps-script/Code.gs`
   - Add a new file `GmailSync` with content from `apps-script/GmailSync.gs`
   - Add a new file `Setup` with content from `apps-script/Setup.gs`

4. **Deploy as Web App**
   - Click **Deploy → New deployment**
   - Choose **Web app**
   - Set: Execute as = **Me**, Who has access = **Anyone**
   - Click **Deploy** and grant permissions
   - **Copy the Web App URL**

5. **Run Initial Setup**
   - Select `initialSetup` from the function dropdown
   - Click **▶ Run**
   - Grant Gmail permissions when prompted

   This creates sheet headers, formatting, and time-based triggers.

---

### Part 2: Chrome Extension Setup

1. **Open Chrome Extensions**
   - Go to `chrome://extensions/`
   - Enable **Developer mode** (toggle in top right)

2. **Load the extension**
   - Click **Load unpacked**
   - Select the `chrome-extension/` folder from this repository

3. **Configure the extension**
   - Click the extension icon in your toolbar
   - Click **Settings**
   - Paste the **Apps Script Web App URL** from Step 1
   - Optionally paste your **Google Sheet URL** (shown as a link in the popup)
   - Click **Save**

4. **Test it**
   - Visit a job posting page on LinkedIn, Greenhouse, etc.
   - Check your Google Sheet — a new row should appear within a few seconds

---

### How Gmail Sync Works

Every 12 hours, the script scans Gmail for emails from companies in your tracker:

| Email Pattern | New Status |
|--------------|------------|
| "thank you for applying" | Applied |
| "coding challenge", HackerRank | Assessment |
| "interview", "schedule a call" | Interview |
| "unfortunately", "not moving forward" | Rejected |

Every 24 hours, it also checks for "Ghosted" — Applied jobs older than 30 days with no email response.

Status priority (highest wins): `Offer > Interview > Assessment > Applied > Viewed > Ghosted > Rejected`

---

### Troubleshooting

- **Extension not recording jobs**: Make sure the Apps Script URL is saved in Settings. Check the URL passes the job detection filter (only job detail pages are recorded).
- **Duplicate rows**: The extension has a 7-day dedup window per job key. Check if you cleared extension storage.
- **Gmail sync not working**: Re-run `initialSetup()` in Apps Script and grant Gmail permissions.
- **Wrong company name**: Greenhouse and Lever use URL slugs — the extension maps common slugs to names. Add custom mappings in `service_worker.js` if needed.

---

## 設定指南（繁體中文）

### 第一部分：Google Apps Script 設定

1. **建立 Google 試算表**
   - 前往 [sheets.google.com](https://sheets.google.com)，建立新試算表
   - 命名為「求職追蹤器」或任意名稱
   - 複製試算表網址備用

2. **開啟 Apps Script**
   - 在試算表中點選「**擴充功能 → Apps Script**」

3. **新增腳本檔案**
   - 將預設 `Code.gs` 內容替換為 `apps-script/Code.gs`
   - 新增 `GmailSync` 檔案，貼上 `apps-script/GmailSync.gs` 內容
   - 新增 `Setup` 檔案，貼上 `apps-script/Setup.gs` 內容

4. **部署為網路應用程式**
   - 點選「**部署 → 新增部署**」
   - 選擇「**網路應用程式**」
   - 執行身分設為「**我**」，存取權設為「**任何人**」
   - 點選「**部署**」並授權
   - **複製網路應用程式網址**

5. **執行初始設定**
   - 在函式下拉選單選擇 `initialSetup`
   - 點選「**▶ 執行**」
   - 依提示授予 Gmail 存取權限

   這將建立試算表標題列、格式設定及定時觸發程序。

---

### 第二部分：Chrome 擴充功能設定

1. **開啟 Chrome 擴充功能頁面**
   - 前往 `chrome://extensions/`
   - 啟用右上角的「**開發人員模式**」

2. **載入擴充功能**
   - 點選「**載入未封裝項目**」
   - 選擇本儲存庫的 `chrome-extension/` 資料夾

3. **設定擴充功能**
   - 點選工具列的擴充功能圖示
   - 點選「**設定**」
   - 貼上第一部分取得的「**Apps Script 網路應用程式網址**」
   - 可選填 Google 試算表網址（顯示於彈出視窗）
   - 點選「**儲存**」

4. **測試功能**
   - 前往 LinkedIn、Greenhouse 等平台的職缺頁面
   - 幾秒後查看 Google 試算表，應出現新的一列

---

### Gmail 同步原理

每 12 小時，腳本會自動掃描 Gmail，根據來自各公司的郵件更新狀態：

| 郵件關鍵字 | 更新狀態 |
|-----------|---------|
| 「感謝您的應徵」、「已收到您的應徵」 | 已投遞（Applied） |
| 「線上測驗」、HackerRank | 測驗（Assessment） |
| 「面試」、「安排通話」 | 面試（Interview） |
| 「很遺憾」、「不繼續推進」 | 已拒絕（Rejected） |

每 24 小時也會檢查「已讀無回應（Ghosted）」：已投遞超過 30 天且 Gmail 中無任何該公司郵件的職缺將自動標記為 Ghosted。

狀態優先順序（高者優先）：`錄取 > 面試 > 測驗 > 已投遞 > 已查看 > 已讀無回應 > 已拒絕`

---

### 疑難排解

- **擴充功能未記錄職缺**：確認 Apps Script 網址已在設定中儲存；確認該頁面為具體職缺頁面（不是搜尋結果頁）
- **出現重複列**：擴充功能有 7 天的重複偵測機制；若清除了擴充功能資料可能導致重複
- **Gmail 同步無效**：重新執行 `initialSetup()` 並授予 Gmail 權限
- **公司名稱錯誤**：Greenhouse 和 Lever 使用 URL slug；如需新增對應，請編輯 `service_worker.js` 的 `SLUG_TO_COMPANY`

---

## File Structure

```
job-tracker/
├── chrome-extension/
│   ├── manifest.json        # Extension manifest (V3)
│   ├── service_worker.js    # Background logic
│   ├── popup.html           # Extension popup UI
│   ├── popup.js
│   ├── popup.css
│   ├── options.html         # Settings page
│   ├── options.js
│   ├── options.css
│   └── icons/
│       ├── icon16.png
│       ├── icon48.png
│       └── icon128.png
├── apps-script/
│   ├── Code.gs              # doPost handler + dedup
│   ├── GmailSync.gs         # Gmail status sync
│   ├── Setup.gs             # One-time sheet setup
│   └── README.md            # Detailed Apps Script setup guide
└── README.md                # This file
```

---

## Privacy

All data stays in your own Google Sheet. No external servers or third parties receive your job application data.

