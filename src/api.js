import { API_URL } from "./config";

const CACHE_KEY = "williams_house_data_cache";

export async function readAll() {
  const url = new URL(API_URL);
  url.searchParams.set("action", "read");

  const response = await fetch(url.toString());
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
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify(payload)
  });

  const data = await response.json();

  if (!data.ok) {
    throw new Error(data.error || "Failed to save data");
  }

  return data.result;
}
