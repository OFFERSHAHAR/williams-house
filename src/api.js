import { API_URL } from "./config";

const CACHE_KEY = "williams_house_data_cache";
let cacheWriteTimer = null;
let cacheIdleCallback = null;
const READ_TIMEOUT_MS = 12000;
const WRITE_TIMEOUT_MS = 18000;
const NETWORK_ERROR_MESSAGE = "החיבור לשיטס לא יציב כרגע. הנתונים האחרונים נשארים על המסך";

async function fetchWithTimeout(url, options = {}, timeoutMs = READ_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(NETWORK_ERROR_MESSAGE);
    }

    throw err;
  } finally {
    window.clearTimeout(timer);
  }
}

async function readJsonResponse(response, fallbackMessage) {
  const text = await response.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(fallbackMessage);
  }

  if (!response.ok) {
    throw new Error(data.error || fallbackMessage);
  }

  return data;
}

export async function readAll() {
  const url = new URL(API_URL);
  url.searchParams.set("action", "read");

  const response = await fetchWithTimeout(url.toString(), {}, READ_TIMEOUT_MS);
  const data = await readJsonResponse(response, NETWORK_ERROR_MESSAGE);

  if (!data.ok) {
    throw new Error(data.error || "Failed to load data");
  }

  return data.data;
}

export function readCachedData() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveCachedData(data) {
  if (cacheWriteTimer) {
    window.clearTimeout(cacheWriteTimer);
    cacheWriteTimer = null;
  }

  if (cacheIdleCallback && "cancelIdleCallback" in window) {
    window.cancelIdleCallback(cacheIdleCallback);
    cacheIdleCallback = null;
  }

  const writeCache = () => {
    cacheWriteTimer = null;
    cacheIdleCallback = null;

    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({
          savedAt: new Date().toISOString(),
          data
        })
      );
    } catch {
      // Cache is a speed improvement only. Failure should not block the app.
    }
  };

  if ("requestIdleCallback" in window) {
    cacheIdleCallback = window.requestIdleCallback(writeCache, { timeout: 2000 });
    return;
  }

  cacheWriteTimer = window.setTimeout(writeCache, 1000);
}

export async function addRecord(table, record) {
  return writeRecord({ table, op: "add", record });
}

export async function updateRecord(table, record) {
  return writeRecord({ table, op: "update", record });
}

export async function deleteRecord(table, id) {
  return writeRecord({ table, op: "delete", id });
}

export async function syncReportTurnovers(rows, summary) {
  return writeRecord({ table: "turnovers", op: "syncReports", rows, summary });
}

async function writeRecord(payload) {
  const response = await fetchWithTimeout(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify(payload)
  }, WRITE_TIMEOUT_MS);

  const data = await readJsonResponse(response, "השמירה לשיטס נכשלה. נסה שוב בעוד רגע");

  if (!data.ok) {
    throw new Error(data.error || "Failed to save data");
  }

  return data.result;
}
