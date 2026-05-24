import { API_URL } from "./config";

const CACHE_KEY = "williams_house_data_cache";
let cacheWriteTimer = null;
const READ_TIMEOUT_MS = 12000;
const WRITE_TIMEOUT_MS = 18000;

async function fetchWithTimeout(url, options = {}, timeoutMs = READ_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("החיבור לשיטס איטי מדי. נסה שוב בעוד רגע");
    }

    throw err;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function readAll() {
  const url = new URL(API_URL);
  url.searchParams.set("action", "read");

  const response = await fetchWithTimeout(url.toString(), {}, READ_TIMEOUT_MS);
  const data = await response.json();

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
  }

  cacheWriteTimer = window.setTimeout(() => {
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
  }, 250);
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

  const data = await response.json();

  if (!data.ok) {
    throw new Error(data.error || "Failed to save data");
  }

  return data.result;
}
