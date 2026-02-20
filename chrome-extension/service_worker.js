// ============================================================
// Job Application Tracker — service_worker.js
// ============================================================

const DEDUPE_WINDOW = 7 * 24 * 60 * 60 * 1000; // 7 days in ms
const TITLE_WAIT_MS = 2500; // wait for SPA title updates

// Safe hostname matcher: host must equal domain or be a subdomain of it
function hostIs(host, domain) {
  return host === domain || host.endsWith("." + domain);
}

// ----------------------------------------------------------
// 1. URL Detection
// ----------------------------------------------------------
// Only record when the URL indicates the user is actively on an apply page.
// Sites that don't have a dedicated /apply URL (LinkedIn, Greenhouse, Amazon,
// Meta, Microsoft, Adobe) are intentionally excluded — Gmail sync will create
// those rows from confirmation emails.
function isApplyPageUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.toLowerCase();

    // Workday: /apply or /autofillWithResume
    if (hostIs(host, "myworkdayjobs.com") || hostIs(host, "workday.com")) {
      return path.includes("/apply");
    }

    // Greenhouse — no separate /apply URL; rely on Gmail sync
    if (hostIs(host, "greenhouse.io")) return false;

    // Lever: /apply at the end
    if (hostIs(host, "lever.co")) return path.includes("/apply");

    // LinkedIn Easy Apply happens in a modal — no distinct /apply URL
    if (hostIs(host, "linkedin.com")) return false;

    // Tesla: /careers/search/job/apply/{id}
    if (hostIs(host, "tesla.com")) return path.includes("/apply/");

    // Google Careers
    if (hostIs(host, "google.com") && path.includes("/careers/")) {
      return path.includes("/apply");
    }

    // Amazon — apply happens inline; rely on Gmail sync
    if (hostIs(host, "amazon.jobs")) return false;

    // Meta — apply happens on job_details page; rely on Gmail sync
    if (hostIs(host, "metacareers.com")) return false;

    // Microsoft — apply happens inline; rely on Gmail sync
    if (hostIs(host, "microsoft.com") || hostIs(host, "careers.microsoft.com")) return false;

    // Adobe — apply happens inline; rely on Gmail sync
    if (hostIs(host, "adobe.com") || hostIs(host, "careers.adobe.com")) return false;

    // Stripe: /jobs/listing/{id}/apply
    if (hostIs(host, "stripe.com")) return path.includes("/apply");

    // Generic: only if URL contains /apply
    return path.includes("/apply");
  } catch {
    return false;
  }
}

// ----------------------------------------------------------
// 2. Canonical Job Key
// ----------------------------------------------------------
function canonicalJobKey(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch (_) {
    return rawUrl;
  }
  const host = url.hostname.toLowerCase();
  const path = url.pathname;

  // LinkedIn
  if (hostIs(host, "linkedin.com")) {
    const m = path.match(/\/jobs\/view\/(\d+)/);
    return m ? `linkedin:${m[1]}` : `linkedin:${path}`;
  }

  // Workday
  if (hostIs(host, "myworkdayjobs.com") || hostIs(host, "workday.com")) {
    let p = path
      .replace(/\/apply$/, "")
      .replace(/\/autofillWithResume$/, "")
      .replace(/\/[a-z]{2}-[A-Z]{2}\//, "/"); // strip locale like /en-US/
    p = p.replace(/\/$/, "");
    return `workday:${host}${p}`;
  }

  // Greenhouse
  if (hostIs(host, "greenhouse.io")) {
    const m = path.match(/\/([^/]+)\/jobs\/(\d+)/);
    if (m) return `greenhouse:${m[1]}:${m[2]}`;
    return `greenhouse:${host}${path}`;
  }

  // Lever
  if (hostIs(host, "lever.co")) {
    const m = path.match(/\/([^/]+)\/([a-f0-9-]{36})/i);
    if (m) return `lever:${m[1]}:${m[2]}`;
    return `lever:${host}${path}`;
  }

  // Tesla
  if (hostIs(host, "tesla.com")) {
    const m = path.match(/[-](\d+)$/);
    return m ? `tesla:${m[1]}` : `tesla:${path}`;
  }

  // Amazon
  if (hostIs(host, "amazon.jobs")) {
    const m = path.match(/\/jobs\/(\d+)\//);
    return m ? `amazon:${m[1]}` : `amazon:${path}`;
  }

  // Google Careers
  if (hostIs(host, "google.com") && path.includes("/careers/")) {
    const m = path.match(/\/([a-f0-9-]{36})/i);
    return m ? `google:${m[1]}` : `google:${path}`;
  }

  // Meta
  if (hostIs(host, "metacareers.com")) {
    const m = path.match(/\/job_details\/[^/]+-(\d+)\//);
    return m ? `meta:${m[1]}` : `meta:${path}`;
  }

  // Generic: host + path, no query, no trailing slash
  return `${host}${path}`.replace(/\/$/, "");
}

// ----------------------------------------------------------
// 3. Company Name Extraction
// ----------------------------------------------------------
const SLUG_TO_COMPANY = {
  scaleai: "Scale AI",
  doordashusa: "DoorDash",
  doordash: "DoorDash",
  robinhood: "Robinhood",
  confluent: "Confluent",
  stripe: "Stripe",
  nvidia: "NVIDIA",
  adobe: "Adobe",
  amazon: "Amazon",
  google: "Google",
  microsoft: "Microsoft",
  meta: "Meta",
  tesla: "Tesla",
  dell: "Dell",
  micron: "Micron",
  bosch: "Bosch",
  figma: "Figma",
  airbnb: "Airbnb",
  lyft: "Lyft",
  uber: "Uber",
  snap: "Snap",
  pinterest: "Pinterest",
  twitter: "Twitter",
  coinbase: "Coinbase",
  palantir: "Palantir",
  databricks: "Databricks",
  snowflake: "Snowflake",
  shopify: "Shopify",
  square: "Square",
  block: "Block",
  twilio: "Twilio",
  salesforce: "Salesforce",
  oracle: "Oracle",
  ibm: "IBM",
  intel: "Intel",
  qualcomm: "Qualcomm",
  amd: "AMD",
  arm: "Arm",
};

function slugToName(slug) {
  const lower = slug.toLowerCase().replace(/[-_]/g, "");
  if (SLUG_TO_COMPANY[lower]) return SLUG_TO_COMPANY[lower];
  // Capitalize first letter of each word separated by dashes/underscores
  return slug.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function extractCompanyName(rawUrl, pageTitle) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch (_) {
    return pageTitle || "Unknown";
  }
  const host = url.hostname.toLowerCase();
  const path = url.pathname;

  // Greenhouse: job-boards.greenhouse.io/{company_slug}/jobs/{id}
  if (hostIs(host, "greenhouse.io")) {
    const m = path.match(/^\/([^/]+)\/jobs\//);
    if (m) return slugToName(m[1]);
  }

  // Lever: jobs.lever.co/{company}/...
  if (hostIs(host, "lever.co")) {
    const m = path.match(/^\/([^/]+)\//);
    if (m) return slugToName(m[1]);
  }

  // Workday: extract from subdomain (e.g. nvidia.wd5.myworkdayjobs.com)
  if (hostIs(host, "myworkdayjobs.com") || hostIs(host, "workday.com")) {
    const subdomain = host.split(".")[0];
    if (subdomain && subdomain !== "www") return slugToName(subdomain);
  }

  // LinkedIn: try to extract from title "Job Title at Company - LinkedIn"
  if (hostIs(host, "linkedin.com") && pageTitle) {
    const m = pageTitle.match(/ at (.+?) [\|\-]/);
    if (m) return m[1].trim();
  }

  // Tesla
  if (hostIs(host, "tesla.com")) return "Tesla";

  // Amazon
  if (hostIs(host, "amazon.jobs")) return "Amazon";

  // Meta
  if (hostIs(host, "metacareers.com")) return "Meta";

  // Microsoft
  if (hostIs(host, "microsoft.com")) return "Microsoft";

  // Adobe
  if (hostIs(host, "adobe.com")) return "Adobe";

  // Stripe
  if (hostIs(host, "stripe.com")) return "Stripe";

  // SmartRecruiters: smartrecruiters.com/{company}/{id}
  if (hostIs(host, "smartrecruiters.com")) {
    const m = path.match(/^\/([^/]+)\//);
    if (m) return slugToName(m[1]);
  }

  // Micron
  if (hostIs(host, "micron.com")) return "Micron";

  // Bosch
  if (hostIs(host, "bosch.com")) return "Bosch";

  // Fallback: try to parse from page title
  if (pageTitle) {
    const cleaned = cleanRoleTitle(pageTitle);
    // If title looks like "Role Title at Company", extract after " at "
    const atMatch = cleaned.match(/ at (.+)$/);
    if (atMatch) return atMatch[1].trim();
    // Use page title heuristic
    const parts = pageTitle.split(/[\|\-–]/);
    if (parts.length > 1) return parts[parts.length - 1].trim();
  }

  // Last resort: use domain
  const parts = host.split(".");
  const domain = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  return slugToName(domain);
}

// ----------------------------------------------------------
// 4. Source Detection
// ----------------------------------------------------------
function detectSource(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch (_) {
    return "CompanySite";
  }
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();

  if (hostIs(host, "linkedin.com")) return "LinkedIn";
  if (hostIs(host, "myworkdayjobs.com") || hostIs(host, "workday.com")) return "Workday";
  if (hostIs(host, "greenhouse.io")) return "Greenhouse";
  if (hostIs(host, "lever.co")) return "Lever";
  if (hostIs(host, "google.com") && path.includes("/careers/")) return "Google Careers";
  if (hostIs(host, "amazon.jobs")) return "Amazon Jobs";
  if (hostIs(host, "metacareers.com")) return "Meta Careers";
  if (hostIs(host, "smartrecruiters.com")) return "SmartRecruiters";

  return "CompanySite";
}

// ----------------------------------------------------------
// 5. Role Title Cleaning
// ----------------------------------------------------------
function cleanRoleTitle(title) {
  if (!title) return "Unknown";
  let t = title
    .replace(/^Apply for /i, "")
    .replace(/ \| Tesla Careers$/, "")
    .replace(/ - LinkedIn$/, "")
    .replace(/ \| LinkedIn$/, "")
    .replace(/ \| Careers$/, "")
    .replace(/ \| Jobs$/, "")
    .replace(/ - Careers$/, "")
    .replace(/ - Jobs$/, "")
    .replace(/ \| Indeed$/, "")
    .replace(/ - Indeed$/, "")
    .replace(/ \| Glassdoor$/, "")
    .replace(/ - Glassdoor$/, "")
    .replace(/ \| Greenhouse$/, "")
    .replace(/ - Greenhouse$/, "")
    .replace(/ \| Lever$/, "")
    .replace(/ \| SmartRecruiters$/, "")
    .replace(/ \| [A-Z][\w\s]+$/, "") // strip "| Company Name" suffix
    .replace(/ - [A-Z][\w\s]+ Careers$/, "")
    .trim();
  return t || title;
}

// ----------------------------------------------------------
// 6. Deduplication Helpers
// ----------------------------------------------------------
async function getSeenKeys() {
  return new Promise(resolve => {
    chrome.storage.local.get("seenKeys", data => resolve(data.seenKeys || {}));
  });
}

async function saveSeenKeys(keys) {
  return new Promise(resolve => {
    chrome.storage.local.set({ seenKeys: keys }, resolve);
  });
}

async function isDuplicate(key) {
  const seen = await getSeenKeys();
  const ts = seen[key];
  if (!ts) return false;
  return Date.now() - ts < DEDUPE_WINDOW;
}

async function markSeen(key) {
  const seen = await getSeenKeys();
  seen[key] = Date.now();
  await saveSeenKeys(seen);
}

async function cleanupExpiredKeys() {
  const seen = await getSeenKeys();
  const now = Date.now();
  for (const key of Object.keys(seen)) {
    if (now - seen[key] >= DEDUPE_WINDOW) delete seen[key];
  }
  await saveSeenKeys(seen);
}

// ----------------------------------------------------------
// 7. Apps Script URL helper
// ----------------------------------------------------------
async function getAppsScriptUrl() {
  return new Promise(resolve => {
    chrome.storage.sync.get("appsScriptUrl", data => resolve(data.appsScriptUrl || ""));
  });
}

// ----------------------------------------------------------
// 8. Error queue helpers
// ----------------------------------------------------------
async function getQueue() {
  return new Promise(resolve => {
    chrome.storage.local.get("postQueue", data => resolve(data.postQueue || []));
  });
}

async function saveQueue(q) {
  return new Promise(resolve => {
    chrome.storage.local.set({ postQueue: q }, resolve);
  });
}

async function enqueue(payload) {
  const q = await getQueue();
  q.push({ payload, attempts: 0 });
  await saveQueue(q);
}

async function flushQueue() {
  const url = await getAppsScriptUrl();
  if (!url) return;
  const q = await getQueue();
  if (!q.length) return;
  const remaining = [];
  for (const item of q) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.payload),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    } catch (_) {
      item.attempts = (item.attempts || 0) + 1;
      if (item.attempts < 5) remaining.push(item);
    }
  }
  await saveQueue(remaining);
}

// ----------------------------------------------------------
// 9. POST to Apps Script
// ----------------------------------------------------------
async function postToAppsScript(payload) {
  const url = await getAppsScriptUrl();
  if (!url) {
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#FF0000" });
    await enqueue(payload);
    return;
  }
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    chrome.action.setBadgeText({ text: "" });
    // Update today's count & last job in storage
    await updateStats(payload);
    await flushQueue();
  } catch (err) {
    logError(`POST failed: ${err.message}`, payload);
    await enqueue(payload);
  }
}

// ----------------------------------------------------------
// 10. Stats helpers for popup
// ----------------------------------------------------------
async function updateStats(payload) {
  return new Promise(resolve => {
    chrome.storage.local.get(["todayCount", "todayDate", "lastJob"], data => {
      const today = new Date().toDateString();
      let count = data.todayDate === today ? (data.todayCount || 0) : 0;
      count++;
      chrome.storage.local.set({
        todayCount: count,
        todayDate: today,
        lastJob: { company: payload.company, role_title: payload.role_title },
      }, resolve);
    });
  });
}

async function logError(message, context) {
  return new Promise(resolve => {
    chrome.storage.local.get("errorLog", data => {
      const log = data.errorLog || [];
      log.push({ message, context, ts: Date.now() });
      if (log.length > 50) log.splice(0, log.length - 50);
      chrome.storage.local.set({ errorLog: log }, resolve);
    });
  });
}

// ----------------------------------------------------------
// 11. Generate app_id
// ----------------------------------------------------------
function generateAppId() {
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  const rand = Math.floor(Math.random() * 1000).toString().padStart(3, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${rand}`;
}

function formatTimestamp(date) {
  const d = date || new Date();
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

// ----------------------------------------------------------
// 12. Tab listener
// ----------------------------------------------------------
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  const rawUrl = tab.url || "";
  if (!isApplyPageUrl(rawUrl)) return;

  // Wait for SPA title to settle
  setTimeout(() => {
    chrome.tabs.get(tabId, async (updatedTab) => {
      if (chrome.runtime.lastError) return;

      // Check if tracking is paused
      const syncData = await new Promise(resolve => {
        chrome.storage.sync.get("trackingPaused", resolve);
      });
      if (syncData.trackingPaused) return;

      const pageTitle = updatedTab.title || "";
      const canonicalKey = canonicalJobKey(rawUrl);

      // Deduplication
      if (await isDuplicate(canonicalKey)) return;
      await markSeen(canonicalKey);

      const company = extractCompanyName(rawUrl, pageTitle);
      const roleTitle = cleanRoleTitle(pageTitle);
      const source = detectSource(rawUrl);
      const now = new Date();

      const payload = {
        app_id: generateAppId(),
        timestamp: formatTimestamp(now),
        company,
        role_title: roleTitle,
        jd_url: rawUrl,
        source,
        resume_version: "UNKNOWN",
        status: "Applied",
        canonical_key: canonicalKey,
      };

      await postToAppsScript(payload);
    });
  }, TITLE_WAIT_MS);
});

// ----------------------------------------------------------
// 13. Periodic cleanup (every hour via alarm)
// ----------------------------------------------------------
chrome.alarms.create("cleanup", { periodInMinutes: 60 });
chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === "cleanup") {
    await cleanupExpiredKeys();
    await flushQueue();
  }
});
