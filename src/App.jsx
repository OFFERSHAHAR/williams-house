import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { addRecord, deleteRecord, readAll, readCachedData, saveCachedData, syncReportTurnovers, updateRecord } from "./api";
import { TABLES } from "./config";
import "./styles.css";

const emptyData = {
  users: [],
  maintenance: [],
  turnovers: [],
  notifications: [],
  shopping: [],
  hours: [],
  pool_logs: [],
  pool_equipment: [],
  report_sync: []
};

const roleLabels = {
  admin: "מנהל",
  bookings: "הזמנות",
  maint: "תחזוקה",
  house: "משק בית"
};

const tabSets = {
  admin: ["dashboard", "turnovers", "maintenance", "shopping", "hours", "notifications", "pool"],
  bookings: ["turnovers", "notifications"],
  maint: ["maintenance", "hours", "pool", "shopping", "notifications"],
  house: ["turnovers", "shopping", "hours", "notifications"]
};

const tabLabels = {
  dashboard: "בית",
  turnovers: "חדרים",
  maintenance: "אחזקה",
  shopping: "קניות",
  hours: "שעות",
  notifications: "התראות",
  pool: "בריכה"
};

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (date, days) => {
  const next = new Date(`${date}T12:00:00`);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
};
const monthStart = (key) => `${key}-01`;
const addMonths = (key, months) => {
  const date = new Date(`${monthStart(key)}T12:00:00`);
  date.setMonth(date.getMonth() + months);
  return date.toISOString().slice(0, 7);
};
const formatMonthName = (key) => new Date(`${monthStart(key)}T12:00:00`).toLocaleDateString("he-IL", { month: "long", year: "numeric" });
const nowIso = () => new Date().toISOString();
const newId = () => `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
const isDone = (row) => row.status === "done" || row.status === "completed";
const isPurchased = (row) => row.status === "purchased";
const sameText = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
const isShoppingRequestedByUser = (row, user) =>
  sameText(row.requestedById, user.username) ||
  sameText(row.requestedBy, user.username) ||
  sameText(row.requestedBy, user.display);
const isShoppingRequestedByHouse = (row, users = []) => {
  if (row.requestedByRole === "house") return true;
  const requester = String(row.requestedById || row.requestedBy || "").trim().toLowerCase();
  return users.some((person) => person.role === "house" && (sameText(requester, person.username) || sameText(requester, person.display)));
};
const poolType = (row) => String(row.type || row.name || "").trim().toLowerCase();
const isPoolTreatment = (row) => poolType(row).includes("treatment") || poolType(row).includes("טיפול");
const isPoolUv = (row) => poolType(row).includes("uv") || poolType(row).includes("מנור");
const BOOKING_ROOMS = ["קרון", "יורט", "ראג'ה", "עדי", "שיטה"];
const ONE_SIGNAL_APP_ID = "46062f6a-d7a8-4714-8765-bac63a2e3bc5";
const REPORT_TURNOVER_PREFIX = "report-";
const turnoverChangeFields = [
  ["room", "חדר"],
  ["date", "תאריך"],
  ["guests", "אורחים"],
  ["children", "ילדים"],
  ["babies", "תינוקות"],
  ["hasCrib", "לול"],
  ["hasHighChair", "כסא אוכל"],
  ["isOccupied", "החלפה"],
  ["isReturning", "סוג לקוח"],
  ["notes", "הערות"]
];

function monthKey(date) {
  return String(date || today()).slice(0, 7);
}

function displayValue(value) {
  if (value === true || value === "TRUE") return "כן";
  if (value === false || value === "FALSE" || value === undefined || value === null || value === "") return "לא";
  return String(value);
}

function normalizedValue(value) {
  if (value === true || value === "TRUE") return "true";
  if (value === false || value === "FALSE" || value === undefined || value === null) return "";
  return String(value).trim();
}

function turnoverChangeSummary(before, after) {
  if (!before || !after) return "";
  const changes = turnoverChangeFields
    .filter(([key]) => normalizedValue(before[key]) !== normalizedValue(after[key]))
    .map(([key, label]) => `${label}: ${displayValue(before[key])} ← ${displayValue(after[key])}`);
  if (!changes.length) return "";
  const room = after.room || before.room || "חדר";
  const date = after.date || before.date || "";
  return `שינוי בסידור עבודה - ${room}${date ? ` (${formatDisplayDate(date)})` : ""}: ${changes.join(" · ")}`;
}

function turnoverCreatedSummary(row) {
  const room = row.room || "חדר";
  const date = row.date ? formatDisplayDate(row.date) : "";
  const guests = Number(row.guests || 0);
  const parts = [
    `סידור עבודה חדש - ${room}${date ? ` (${date})` : ""}`,
    guests ? `${guests} אורחים` : "",
    row.children ? `${row.children} ילדים` : "",
    row.babies ? `${row.babies} תינוקות` : "",
    row.isOccupied ? "החלפה" : "",
    row.notes ? String(row.notes).trim() : ""
  ].filter(Boolean);
  return parts.join(" · ");
}

function findTurnoverChanges(previousRows = [], nextRows = []) {
  const previousById = new Map(previousRows.map((row) => [row.id, row]));
  return nextRows
    .map((row) => turnoverChangeSummary(previousById.get(row.id), row))
    .filter(Boolean);
}

function findDuplicateTurnover(rows, form, ignoreId = "") {
  const room = String(form.room || "").trim().toLowerCase();
  const date = String(form.date || "").slice(0, 10);
  if (!room || !date) return null;
  return rows.find((row) => row.id !== ignoreId && String(row.room || "").trim().toLowerCase() === room && String(row.date || "").slice(0, 10) === date) || null;
}

function isReportTurnover(row) {
  return String(row?.id || "").startsWith(REPORT_TURNOVER_PREFIX);
}

function normalizeReportText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeReportRoom(value) {
  const room = normalizeReportText(value).replace(/׳/g, "'");
  if (room.startsWith("ראג")) return "ראג'ה";
  return room;
}

function parseReportDate(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return "";
    return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  const text = normalizeReportText(value);
  const dateOnly = text.split(" ")[0];
  const match = dateOnly.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (!match) return "";
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function parseGuestCounts(value) {
  const numbers = normalizeReportText(value).match(/\d+/g)?.map(Number) || [];
  return {
    guests: numbers[0] || 0,
    children: numbers[1] || 0,
    babies: numbers[2] || 0
  };
}

function cleanReportNote(value) {
  const text = normalizeReportText(value);
  if (!text || /no note/i.test(text)) return "";
  return text.replace(/^guest node:\s*/i, "").trim();
}

function getReportCell(row, headerMap, names) {
  const key = names.find((name) => headerMap.has(name));
  return key ? row[headerMap.get(key)] : "";
}

function extractReportRows(sheetRows, requiredHeaders) {
  const headerIndex = sheetRows.findIndex((row) => requiredHeaders.every((header) => row.map(normalizeReportText).includes(header)));
  if (headerIndex === -1) {
    throw new Error(`לא נמצאה שורת כותרות מתאימה בקובץ`);
  }
  const headerMap = new Map(sheetRows[headerIndex].map((cell, index) => [normalizeReportText(cell), index]).filter(([cell]) => cell));
  return sheetRows
    .slice(headerIndex + 1)
    .filter((row) => normalizeReportText(getReportCell(row, headerMap, ["מספר הזמנה"])).match(/^\d+$/))
    .map((row) => ({ row, headerMap }));
}

async function readReportSheet(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { cellDates: true, type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: "", header: 1, raw: false });
}

function buildReportAnalysis(arrivalSheetRows, departureSheetRows, currentRows) {
  const arrivals = extractReportRows(arrivalSheetRows, ["מספר הזמנה", "תאריך הגעה", "תאריך עזיבה"]);
  const departures = extractReportRows(departureSheetRows, ["מספר הזמנה", "תאריך הגעה", "תאריך עזיבה"]);
  const departureKeys = new Set(
    departures.map(({ row, headerMap }) => {
      const room = normalizeReportRoom(getReportCell(row, headerMap, ["מספר חדר", "שם מוצר", "סוג חדר"]));
      const date = parseReportDate(getReportCell(row, headerMap, ["תאריך עזיבה"]));
      return `${room}|${date}`;
    })
  );

  const nextRows = arrivals.map(({ row, headerMap }) => {
    const bookingId = normalizeReportText(getReportCell(row, headerMap, ["מספר הזמנה"]));
    const room = normalizeReportRoom(getReportCell(row, headerMap, ["סוג חדר", "מספר חדר", "שם מוצר"]));
    const date = parseReportDate(getReportCell(row, headerMap, ["תאריך הגעה"]));
    const guestName = normalizeReportText(getReportCell(row, headerMap, ["שם מלא"]));
    const counts = parseGuestCounts(getReportCell(row, headerMap, ["מספר האורחים"]));
    const reportNote = cleanReportNote(getReportCell(row, headerMap, ["הערות"]));
    const notes = [
      guestName ? `אורח: ${guestName}` : "",
      bookingId ? `הזמנה: ${bookingId}` : "",
      reportNote
    ].filter(Boolean).join(" · ");

    return {
      id: `${REPORT_TURNOVER_PREFIX}${bookingId}`,
      room,
      date,
      ...counts,
      hasCrib: false,
      hasHighChair: false,
      isReturning: false,
      isOccupied: departureKeys.has(`${room}|${date}`),
      notes,
      status: "pending",
      gardenDone: false,
      gardenDoneAt: "",
      createdAt: nowIso(),
      completedAt: "",
      reportSource: "local"
    };
  }).filter((row) => row.room && row.date);

  const previousReportRows = currentRows.filter(isReportTurnover);
  const previousById = new Map(previousReportRows.map((row) => [row.id, row]));
  const nextById = new Map(nextRows.map((row) => [row.id, row]));
  const changedRows = nextRows.filter((row) => turnoverChangeSummary(previousById.get(row.id), row));
  const newRows = nextRows.filter((row) => !previousById.has(row.id));
  const unchangedRows = nextRows.filter((row) => previousById.has(row.id) && !turnoverChangeSummary(previousById.get(row.id), row));
  const removedRows = previousReportRows.filter((row) => !nextById.has(row.id));

  return {
    nextRows,
    summary: {
      reportMonth: [...new Set(nextRows.map((row) => monthKey(row.date)).filter(Boolean))].sort().join(","),
      arrivals: nextRows.length,
      departures: departures.length,
      sameDay: nextRows.filter((row) => row.isOccupied).length,
      newRows: newRows.length,
      changedRows: changedRows.length,
      unchangedRows: unchangedRows.length,
      removedRows: removedRows.length
    },
    preview: [...newRows, ...changedRows].slice(0, 8)
  };
}

async function analyzeReportFiles(files, currentRows) {
  if (!files.arrivals || !files.departures) {
    throw new Error("צריך לבחור גם דוח כניסות וגם דוח עזיבות");
  }
  const [arrivalSheetRows, departureSheetRows] = await Promise.all([
    readReportSheet(files.arrivals),
    readReportSheet(files.departures)
  ]);
  return buildReportAnalysis(arrivalSheetRows, departureSheetRows, currentRows);
}

function turnoverDetails(row) {
  if (!row) return "";
  return [
    row.room || "חדר",
    formatDisplayDate(row.date),
    `${row.guests || 0} אורחים`,
    row.children ? `${row.children} ילדים` : "",
    row.babies ? `${row.babies} תינוקות` : "",
    row.isReturning ? "לקוח חוזר" : "לקוח חדש",
    row.isOccupied ? "החלפה" : "",
    row.notes || ""
  ].filter(Boolean).join(" · ");
}

function DateText({ children }) {
  return (
    <span className="date-text" dir="ltr">
      {children}
    </span>
  );
}

function formatDisplayDate(value) {
  if (!value) return "";
  const text = String(value).slice(0, 10);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : text;
}

function hoursBetween(start, end) {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const minutes = eh * 60 + em - (sh * 60 + sm);
  return Math.max(0, Math.round((minutes / 60) * 100) / 100);
}

async function initOneSignalSubscription(user) {
  if (window.WILLIAMS_IS_LOCAL || ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)) {
    return { ok: false, message: "התראות זמינות רק באתר שפורסם" };
  }

  if (!window.OneSignalDeferred) {
    return { ok: false, message: "מערכת ההתראות עדיין לא נטענה" };
  }

  return new Promise((resolve) => {
    window.OneSignalDeferred.push(async (OneSignal) => {
      try {
        await OneSignal.init({
          appId: ONE_SIGNAL_APP_ID,
          safari_web_id: "web.onesignal.auto.1b5ff574-1f63-4acf-ab26-dadb313db610",
          notifyButton: { enable: false }
        });

        if (user?.username) {
          await OneSignal.login(String(user.username));
        }

        await OneSignal.Notifications.requestPermission();
        resolve({ ok: true, message: "ההתראות הופעלו במכשיר הזה" });
      } catch (err) {
        resolve({ ok: false, message: err.message || "לא ניתן להפעיל התראות כרגע" });
      }
    });
  });
}

export default function App() {
  const [cachedSnapshot] = useState(() => readCachedData());
  const [data, setData] = useState(() => ({ ...emptyData, ...(cachedSnapshot?.data || {}) }));
  const [loading, setLoading] = useState(!cachedSnapshot?.data);
  const [error, setError] = useState("");
  const [scheduleNotice, setScheduleNotice] = useState("");
  const [pendingActions, setPendingActions] = useState(() => new Set());
  const [actionNotice, setActionNotice] = useState(null);
  const pendingWritesRef = useRef(0);
  const previousTurnoversRef = useRef(cachedSnapshot?.data?.turnovers || []);
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("williams_user") || "null");
    } catch {
      return null;
    }
  });
  const [tab, setTab] = useState("dashboard");

  const loadData = async () => {
    const nextData = await readAll();
    const normalized = { ...emptyData, ...nextData };
    const changes = findTurnoverChanges(previousTurnoversRef.current, normalized.turnovers);
    if (changes.length > 0) {
      setScheduleNotice(changes.length === 1 ? changes[0] : `${changes[0]} · ועוד ${changes.length - 1} שינויים`);
    }
    previousTurnoversRef.current = normalized.turnovers;
    setData(normalized);
    saveCachedData(normalized);
    return normalized;
  };

  useEffect(() => {
    if (cachedSnapshot?.data) return;

    let alive = true;

    loadData()
      .catch((err) => {
        if (alive) setError(err.message || String(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [cachedSnapshot]);

  useEffect(() => {
    if (!user) return undefined;

    const interval = window.setInterval(() => {
      if (pendingWritesRef.current > 0) return;
      loadData().catch(() => {});
    }, 5000);

    return () => window.clearInterval(interval);
  }, [user]);

  useEffect(() => {
    const tabs = tabSets[user?.role || "admin"] || tabSets.admin;
    if (!tabs.includes(tab)) setTab(tabs[0]);
  }, [user, tab]);

  const applyOptimisticData = (updater) => {
    setData((current) => {
      const next = updater(current);
      saveCachedData(next);
      return next;
    });
  };

  const markPending = (key, pending) => {
    if (!key) return;
    setPendingActions((current) => {
      const next = new Set(current);
      if (pending) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  };

  const isPending = (key) => pendingActions.has(key);

  const runInBackground = (operation, messages, actionKey) => {
    pendingWritesRef.current += 1;
    markPending(actionKey, true);
    setActionNotice({ type: "pending", text: messages.pending });

    Promise.resolve()
      .then(operation)
      .then(loadData)
      .then(() => {
        setActionNotice({ type: "success", text: messages.success });
        window.setTimeout(() => {
          setActionNotice((current) => (current?.text === messages.success ? null : current));
        }, 1800);
      })
      .catch((err) => {
        const message = err.message || String(err);
        setActionNotice({ type: "error", text: `שגיאה: ${message}` });
        setError(message);
        loadData().catch(() => {});
      })
      .finally(() => {
        pendingWritesRef.current = Math.max(0, pendingWritesRef.current - 1);
        markPending(actionKey, false);
      });
  };

  const actions = {
    isPending,
    notice: (text, type = "success") => {
      setActionNotice({ type, text });
      window.setTimeout(() => {
        setActionNotice((current) => (current?.text === text ? null : current));
      }, 1600);
    },
    add: (table, record) => {
      const actionKey = `add:${table}`;
      const notification = table === TABLES.turnovers
        ? {
          id: newId(),
          for: "house",
          room: "סידור עבודה",
          date: today(),
          message: turnoverCreatedSummary(record),
          read: false,
          createdAt: nowIso(),
          pushSent: ""
        }
        : null;

      applyOptimisticData((current) => ({
        ...current,
        [table]: [...(current[table] || []), record],
        notifications: notification ? [...(current.notifications || []), notification] : current.notifications
      }));

      runInBackground(async () => {
        await addRecord(table, record);
        if (notification) await addRecord(TABLES.notifications, notification);
      }, { pending: "נשלח...", success: "נשמר" }, actionKey);
      setError("");
      return Promise.resolve();
    },
    update: (table, record) => {
      const actionKey = `update:${table}:${record.id}`;
      const before = table === TABLES.turnovers ? data.turnovers.find((row) => row.id === record.id) : null;
      const summary = table === TABLES.turnovers ? turnoverChangeSummary(before, record) : "";
      const notification = summary
        ? {
          id: newId(),
          for: "house",
          room: "סידור עבודה",
          date: today(),
          message: summary,
          read: false,
          createdAt: nowIso(),
          pushSent: ""
        }
        : null;

      applyOptimisticData((current) => ({
        ...current,
        [table]: (current[table] || []).map((row) => (row.id === record.id ? record : row)),
        notifications: notification ? [...(current.notifications || []), notification] : current.notifications
      }));

      runInBackground(async () => {
        await updateRecord(table, record);
        if (notification) await addRecord(TABLES.notifications, notification);
      }, { pending: "נשלח עדכון...", success: "עודכן" }, actionKey);
      setError("");
      return Promise.resolve();
    },
    syncReports: async (nextReportRows, summary) => {
      const actionKey = "sync:reports";
      pendingWritesRef.current += 1;
      markPending(actionKey, true);
      setActionNotice({ type: "pending", text: "שומר דוחות בשיטס..." });
      applyOptimisticData((current) => ({
        ...current,
        turnovers: [
          ...(current.turnovers || []).filter((row) => !isReportTurnover(row)),
          ...nextReportRows
        ]
      }));
      try {
        const result = await syncReportTurnovers(nextReportRows, summary);
        await loadData();
        setActionNotice({ type: "success", text: "הדוחות נשמרו בשיטס" });
        window.setTimeout(() => {
          setActionNotice((current) => (current?.text === "הדוחות נשמרו בשיטס" ? null : current));
        }, 1800);
        setError("");
        return result;
      } catch (err) {
        const message = err.message || String(err);
        setActionNotice({ type: "error", text: `שגיאה: ${message}` });
        setError(message);
        await loadData().catch(() => {});
        throw err;
      } finally {
        pendingWritesRef.current = Math.max(0, pendingWritesRef.current - 1);
        markPending(actionKey, false);
      }
    },
    remove: (table, id) => {
      const actionKey = `remove:${table}:${id}`;
      applyOptimisticData((current) => ({
        ...current,
        [table]: (current[table] || []).filter((row) => row.id !== id)
      }));
      runInBackground(() => deleteRecord(table, id), { pending: "מוחק...", success: "נמחק" }, actionKey);
      setError("");
      return Promise.resolve();
    }
  };

  const login = async (username, password) => {
    const findUser = (rows) => rows.find(
      (row) =>
        String(row.username || "").trim().toLowerCase() === username.trim().toLowerCase() &&
        String(row.password || "").trim() === password.trim()
    );

    let found = findUser(data.users);
    if (!found) {
      try {
        const freshData = await loadData();
        found = findUser(freshData.users || []);
      } catch (err) {
        setError(err.message || String(err));
      }
    }

    if (!found) return false;
    localStorage.setItem("williams_user", JSON.stringify(found));
    setUser(found);
    setTab((tabSets[found.role] || tabSets.admin)[0]);
    initOneSignalSubscription(found);
    return true;
  };

  const logout = () => {
    localStorage.removeItem("williams_user");
    setUser(null);
  };

  if (loading) {
    return <main className="screen center">טוען...</main>;
  }

  if (!user) {
    return <LoginScreen users={data.users} error={error} onLogin={login} />;
  }

  const tabs = tabSets[user.role] || tabSets.admin;
  const saving = pendingActions.size > 0;

  return (
    <main className="screen app-shell">
      <header className="header">
        <div>
          <p className="eyebrow">Williams House</p>
          <h1>בית ויליאמס</h1>
          <p className="muted">
            {user.display || user.username} · {roleLabels[user.role] || user.role}
          </p>
        </div>
        <div className="header-actions">
          {saving && <span className="sync-pill"><span className="tiny-spinner" />מסנכרן</span>}
          <button className="ghost" type="button" onClick={logout}>
            יציאה
          </button>
        </div>
      </header>

      {error && <div className="notice error">שגיאה: {error}</div>}
      {actionNotice && <div className={`action-toast ${actionNotice.type}`}>{actionNotice.text}</div>}
      {scheduleNotice && (
        <div className="notice schedule-change">
          <strong>חל שינוי בסידור העבודה</strong>
          <span>{scheduleNotice}</span>
        </div>
      )}

      <nav className="tabs">
        {tabs.map((item) => (
          <button className={tab === item ? "active" : ""} key={item} type="button" onClick={() => setTab(item)}>
            {tabLabels[item]}
          </button>
        ))}
      </nav>

      {tab === "dashboard" && <Dashboard data={data} onNavigate={setTab} />}
      {tab === "turnovers" && <TurnoversPanel rows={data.turnovers} reportSync={data.report_sync} saving={saving} user={user} actions={actions} />}
      {tab === "maintenance" && <MaintenancePanel rows={data.maintenance} turnovers={data.turnovers} saving={saving} user={user} actions={actions} />}
      {tab === "shopping" && <ShoppingPanel rows={data.shopping} saving={saving} user={user} users={data.users} actions={actions} />}
      {tab === "hours" && <HoursPanel rows={data.hours} saving={saving} user={user} users={data.users} actions={actions} />}
      {tab === "notifications" && <NotificationsPanel rows={data.notifications} turnovers={data.turnovers} saving={saving} user={user} users={data.users} actions={actions} />}
      {tab === "pool" && <PoolPanel logs={data.pool_logs} equipment={data.pool_equipment} saving={saving} user={user} actions={actions} />}
    </main>
  );
}

function LoginScreen({ users, error, onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [pushMessage, setPushMessage] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setLoginError("");
    setLoginBusy(true);
    const ok = await onLogin(username, password);
    if (!ok) setLoginError("שם משתמש או סיסמה שגויים");
    setLoginBusy(false);
  };

  const enablePush = async () => {
    const typedUser = users.find((row) => String(row.username || "").trim().toLowerCase() === username.trim().toLowerCase());
    const result = await initOneSignalSubscription(typedUser || null);
    setPushMessage(result.message);
  };

  return (
    <main className="screen center">
      <form className="login-card" onSubmit={submit}>
        <p className="eyebrow">Williams House</p>
        <h1>בית ויליאמס</h1>
        <p className="muted">כניסה לפי המשתמשים בטאב users</p>
        {error && <div className="notice error">{error}</div>}
        {loginError && <div className="notice error">{loginError}</div>}
        <label>
          שם משתמש
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
        </label>
        <label>
          סיסמה
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
        </label>
        <button className="primary" disabled={loginBusy || !username || !password || users.length === 0} type="submit">
          {loginBusy ? "בודק..." : "כניסה"}
        </button>
        <button className="notify-login" type="button" onClick={enablePush}>
          הפעל התראות במכשיר הזה
        </button>
        {pushMessage && <div className="notice compact">{pushMessage}</div>}
      </form>
    </main>
  );
}

function Dashboard({ data, onNavigate }) {
  const todayDate = today();
  const openMaintenance = data.maintenance.filter((row) => !isDone(row)).length;
  const pendingShopping = data.shopping.filter((row) => !isPurchased(row)).length;
  const todayTurnovers = data.turnovers.filter((row) => row.date === todayDate).length;
  const todayOpen = data.turnovers.filter((row) => row.date === todayDate && !isDone(row)).slice(0, 5);
  const urgent = data.maintenance.filter((row) => !isDone(row) && (row.urgency === "קריטי" || row.urgency === "דחוף")).slice(0, 5);
  const poolTreatments = data.pool_logs.filter(isPoolTreatment).length;
  const completedRooms = data.turnovers.filter(isDone).length;

  return (
    <>
      <section className="grid stat-grid">
        <Stat title="חדרים היום" value={todayTurnovers} icon="🛏️" tone="blue" onClick={() => onNavigate("turnovers")} />
        <Stat title="אחזקה פתוחה" value={openMaintenance} icon="🛠️" tone="orange" onClick={() => onNavigate("maintenance")} />
        <Stat title="קניות ממתינות" value={pendingShopping} icon="🛒" tone="green" onClick={() => onNavigate("shopping")} />
        <Stat title="חדרים מוכנים" value={completedRooms} icon="🔔" tone="purple" onClick={() => onNavigate("notifications")} />
      </section>
      <div className="dashboard-grid">
        <section className="panel">
          <SectionHead title="היום" badge={`${todayOpen.length} לטיפול`} />
          <MiniRows rows={todayOpen} empty="אין חדרים פתוחים להיום" getTitle={(row) => row.room} getMeta={(row) => `${row.guests || 0} אורחים${row.notes ? ` · ${row.notes}` : ""}`} />
        </section>
        <section className="panel">
          <SectionHead title="דחוף" badge={`${urgent.length} משימות`} />
          <MiniRows rows={urgent} empty="אין משימות דחופות" getTitle={(row) => row.title} getMeta={(row) => `${row.location || "ללא מיקום"} · ${row.urgency || "רגיל"}`} />
        </section>
        <section className="panel">
          <SectionHead title="מעקב קצר" badge="עד כה" />
          <div className="mini-metrics">
            <div className="mini-metric">
              <span>טיפולי בריכה</span>
              <strong>{poolTreatments}</strong>
            </div>
            <div className="mini-metric">
              <span>חדרים שאושרו</span>
              <strong>{completedRooms}</strong>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
function TurnoversPanel({ rows, reportSync = [], saving, user, actions }) {
  if (user.role === "house") {
    return <HouseTurnoversPanel rows={rows} reportSync={reportSync} saving={saving} user={user} actions={actions} />;
  }

  if (user.role === "bookings") {
    return <BookingTurnoversPanel rows={rows} reportSync={reportSync} saving={saving} actions={actions} />;
  }

  const roomOptions = getRoomOptions(rows);
  const [view, setView] = useState("calendar");
  const [form, setForm] = useState({
    room: roomOptions[0] || "",
    date: today(),
    guests: 2,
    children: 0,
    babies: 0,
    hasCrib: false,
    hasHighChair: false,
    isReturning: false,
    isOccupied: false,
    notes: ""
  });
  const [duplicateNotice, setDuplicateNotice] = useState("");
  const open = rows.filter((row) => !isDone(row));
  const done = rows.filter((row) => isDone(row));

  useEffect(() => {
    if (!form.room && roomOptions.length) {
      setForm((current) => ({ ...current, room: roomOptions[0] }));
    }
  }, [form.room, roomOptions]);

  const submit = async (event) => {
    event.preventDefault();
    if (!form.room.trim()) return;
    const duplicate = findDuplicateTurnover(rows, form);
    if (duplicate) {
      setDuplicateNotice(`כבר קיימת כניסה לאותו חדר באותו יום: ${turnoverDetails(duplicate)}`);
      return;
    }
    await actions.add(TABLES.turnovers, {
      id: newId(),
      ...form,
      room: form.room.trim(),
      status: "pending",
      gardenDone: false,
      gardenDoneAt: "",
      createdAt: nowIso(),
      completedAt: ""
    });
    setDuplicateNotice("");
    setForm((current) => ({ ...current, room: "", notes: "", guests: 2, children: 0, babies: 0 }));
  };

  return (
    <section className="panel booking-board">
      <SectionHead title={view === "calendar" ? "יומן חדרים" : "חדרים וסידורי עבודה"} badge={view === "calendar" ? "יומן חודשי" : `${open.length} פתוחים`} />
      <div className="house-switch admin-turnovers-switch">
        <button className={view === "calendar" ? "active" : ""} type="button" onClick={() => setView("calendar")}>
          יומן
        </button>
        <button className={view === "manage" ? "active" : ""} type="button" onClick={() => setView("manage")}>
          ניהול
        </button>
      </div>

      {view === "calendar" ? (
        <BookingsCalendar rows={rows} reportSync={reportSync} actions={actions} canEdit />
      ) : (
        <>
          <form className="form" onSubmit={submit}>
            {duplicateNotice && <div className="notice error compact">{duplicateNotice}</div>}
            <label>
              בחר חדר
              <div className="room-picker">
                {roomOptions.map((room) => (
                  <button className={form.room === room ? "active" : ""} key={room} type="button" onClick={() => setForm({ ...form, room })}>
                    {room}
                  </button>
                ))}
              </div>
            </label>
            <div className="form-row">
              <label>
                תאריך
                <input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
              </label>
              <label>
                אורחים
                <input type="number" min="0" value={form.guests} onChange={(event) => setForm({ ...form, guests: Number(event.target.value) || 0 })} />
              </label>
            </div>
            <div className="child-baby-stack">
              <label>
                ילדים
                <input type="number" min="0" value={form.children} onChange={(event) => setForm({ ...form, children: Number(event.target.value) || 0 })} />
              </label>
              <label>
                תינוקות
                <input type="number" min="0" value={form.babies} onChange={(event) => setForm({ ...form, babies: Number(event.target.value) || 0 })} />
              </label>
            </div>
            <div className="checks">
              <Check label="לול" checked={form.hasCrib} onChange={(checked) => setForm({ ...form, hasCrib: checked })} />
              <Check label="כסא אוכל" checked={form.hasHighChair} onChange={(checked) => setForm({ ...form, hasHighChair: checked })} />
              <Check label="החלפה" checked={form.isOccupied} onChange={(checked) => setForm({ ...form, isOccupied: checked })} />
            </div>
            <label>
              סוג לקוח
              <Segmented
                value={form.isReturning ? "לקוח חוזר" : "לקוח חדש"}
                options={["לקוח חדש", "לקוח חוזר"]}
                onChange={(value) => setForm({ ...form, isReturning: value === "לקוח חוזר" })}
              />
            </label>
            <label>
              הערות
              <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
            </label>
            <button className="primary" disabled={!form.room.trim() || actions.isPending("add:turnovers")} type="submit">
              {actions.isPending("add:turnovers") ? "שומר..." : "הוסף סידור"}
            </button>
          </form>
          <TurnoverList title="פתוחים" rows={open} allRows={rows} actions={actions} user={user} canEdit />
          <TurnoverList title="בוצעו" rows={done.slice(0, 10)} allRows={rows} actions={actions} user={user} canEdit />
        </>
      )}
    </section>
  );
}

function BookingTurnoversPanel({ rows, reportSync = [], saving, actions }) {
  const roomOptions = getRoomOptions(rows);
  const [view, setView] = useState("calendar");
  const [form, setForm] = useState({
    room: roomOptions[0] || "",
    date: today(),
    guests: 2,
    children: 0,
    babies: 0,
    hasCrib: false,
    hasHighChair: false,
    isReturning: false,
    isOccupied: false,
    notes: ""
  });
  const [duplicateNotice, setDuplicateNotice] = useState("");
  const todayDate = today();
  const todayRows = rows
    .filter((row) => String(row.date || "").slice(0, 10) === todayDate)
    .sort((a, b) => String(a.room || "").localeCompare(String(b.room || "")));
  const futureRows = rows
    .filter((row) => String(row.date || "").slice(0, 10) > todayDate)
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || String(a.room || "").localeCompare(String(b.room || "")));
  const visibleRows = view === "today" ? todayRows : futureRows;

  useEffect(() => {
    if (!form.room && roomOptions.length) {
      setForm((current) => ({ ...current, room: roomOptions[0] }));
    }
  }, [form.room, roomOptions]);

  const submit = async (event) => {
    event.preventDefault();
    if (!form.room) return;
    const duplicate = findDuplicateTurnover(rows, form);
    if (duplicate) {
      setDuplicateNotice(`כבר קיימת כניסה לאותו חדר באותו יום: ${turnoverDetails(duplicate)}`);
      return;
    }
    await actions.add(TABLES.turnovers, {
      id: newId(),
      ...form,
      status: "pending",
      gardenDone: false,
      gardenDoneAt: "",
      createdAt: nowIso(),
      completedAt: ""
    });
    setDuplicateNotice("");
    setView(form.date > todayDate ? "future" : "today");
    setForm((current) => ({ ...current, notes: "", guests: 2, children: 0, babies: 0 }));
  };

  return (
    <section className="panel booking-board">
      <SectionHead
        title={view === "schedule" ? "סידור עבודה" : view === "reports" ? "דוחות" : "חדרים"}
        badge={view === "calendar" ? "יומן חודשי" : view === "today" ? `${todayRows.length} היום` : view === "future" ? `${futureRows.length} עתידיים` : view === "reports" ? "טעינה מקומית" : "הזנה"}
      />

      <div className="house-switch booking-switch">
        <button className={view === "calendar" ? "active" : ""} type="button" onClick={() => setView("calendar")}>
          יומן
        </button>
        <button className={view === "schedule" ? "active" : ""} type="button" onClick={() => setView("schedule")}>
          סידור עבודה
        </button>
        <button className={view === "today" ? "active" : ""} type="button" onClick={() => setView("today")}>
          היום
        </button>
        <button className={view === "future" ? "active" : ""} type="button" onClick={() => setView("future")}>
          עתידי
        </button>
        <button className={view === "reports" ? "active" : ""} type="button" onClick={() => setView("reports")}>
          דוחות
        </button>
      </div>

      {view === "calendar" ? (
        <BookingsCalendar rows={rows} reportSync={reportSync} actions={actions} canEdit />
      ) : view === "schedule" ? (
        <form className="form" onSubmit={submit}>
          {duplicateNotice && <div className="notice error compact">{duplicateNotice}</div>}
          <label>
            בחרי חדר
            <div className="room-picker">
              {roomOptions.map((room) => (
                <button className={form.room === room ? "active" : ""} key={room} type="button" onClick={() => setForm({ ...form, room })}>
                  {room}
                </button>
              ))}
            </div>
          </label>

          <div className="form-row">
            <label>
              כניסה לחדר
              <input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
            </label>
            <label>
              אורחים
              <input type="number" min="0" value={form.guests} onChange={(event) => setForm({ ...form, guests: Number(event.target.value) || 0 })} />
            </label>
          </div>

          <div className="child-baby-stack">
            <label>
              ילדים
              <input type="number" min="0" value={form.children} onChange={(event) => setForm({ ...form, children: Number(event.target.value) || 0 })} />
            </label>
            <label>
              תינוקות
              <input type="number" min="0" value={form.babies} onChange={(event) => setForm({ ...form, babies: Number(event.target.value) || 0 })} />
            </label>
          </div>

          <div className="checks">
            <Check label="לול" checked={form.hasCrib} onChange={(checked) => setForm({ ...form, hasCrib: checked })} />
            <Check label="כסא אוכל" checked={form.hasHighChair} onChange={(checked) => setForm({ ...form, hasHighChair: checked })} />
            <Check label="החלפה" checked={form.isOccupied} onChange={(checked) => setForm({ ...form, isOccupied: checked })} />
          </div>

          <label>
            סוג לקוח
            <Segmented
              value={form.isReturning ? "לקוח חוזר" : "לקוח חדש"}
              options={["לקוח חדש", "לקוח חוזר"]}
              onChange={(value) => setForm({ ...form, isReturning: value === "לקוח חוזר" })}
            />
          </label>

          <label>
            הערות
            <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </label>

          <button className="primary" disabled={!form.room || actions.isPending("add:turnovers")} type="submit">
            {actions.isPending("add:turnovers") ? "שומר..." : "שמור סידור עבודה"}
          </button>
        </form>
      ) : view === "reports" ? (
        <ReportsImportPanel rows={rows} reportSync={reportSync} actions={actions} />
      ) : (
        <TurnoverList title={view === "today" ? "חדרים להיום" : "חדרים עתידיים"} rows={visibleRows} allRows={rows} actions={actions} readOnly canEdit />
      )}
    </section>
  );
}

function ReportsImportPanel({ rows, reportSync = [], actions }) {
  const [files, setFiles] = useState({ arrivals: null, departures: null });
  const [analysis, setAnalysis] = useState(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lastSync = reportSync
    .slice()
    .sort((a, b) => String(b.syncedAt || "").localeCompare(String(a.syncedAt || "")))[0];
  const canApplyReports = Boolean(analysis && analysis.nextRows?.length);

  const setFile = (key, file) => {
    setFiles((current) => ({ ...current, [key]: file }));
    setAnalysis(null);
    setError("");
    setStatus("");
  };

  const analyze = async () => {
    setBusy(true);
    setError("");
    setStatus("בודק דוחות...");
    try {
      const result = await analyzeReportFiles(files, rows);
      setAnalysis(result);
      setStatus("הבדיקה הסתיימה");
    } catch (err) {
      setError(err.message || String(err));
      setStatus("");
    } finally {
      setBusy(false);
    }
  };

  const applyToSheets = async () => {
    if (!analysis) return;
    setBusy(true);
    setError("");
    setStatus("שומר בשיטס...");
    try {
      const result = await actions.syncReports(analysis.nextRows, analysis.summary);
      const saved = result?.newRows || result?.changedRows || result?.removedRows || result?.manualOverrides
        ? `${result.newRows || 0} חדשים · ${result.changedRows || 0} שונו · ${result.removedRows || 0} הוסרו · ${result.unchangedRows || 0} לא נכתבו שוב · ${result.manualOverrides || 0} ידניות נדרסו`
        : "לא נמצאו שינויים לכתיבה";
      setStatus(`הבדיקה הסתיימה והיומנים עודכנו · ${saved}`);
    } catch (err) {
      setError(err.message || String(err));
      setStatus("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="reports-import">
      <div className="notice compact">
        אחרי בדיקת השינויים ואישור של יפעת, הדוחות נשמרים בשיטס ומעדכנים את כל היומנים.
      </div>

      <div className="report-summary">
        <div className="mini-metric">
          <span>סנכרון אחרון</span>
          <strong>{lastSync ? formatDateTime(lastSync.syncedAt) : "אין עדיין"}</strong>
        </div>
        <div className="mini-metric">
          <span>כניסות אחרונות</span>
          <strong>{lastSync?.arrivals ?? 0}</strong>
        </div>
        <div className="mini-metric">
          <span>עזיבות אחרונות</span>
          <strong>{lastSync?.departures ?? 0}</strong>
        </div>
        <div className="mini-metric">
          <span>לא נכתבו שוב</span>
          <strong>{lastSync?.skippedRows ?? 0}</strong>
        </div>
        <div className="mini-metric">
          <span>ידניות נדרסו</span>
          <strong>{lastSync?.manualOverrides ?? 0}</strong>
        </div>
      </div>

      <div className="report-file-grid">
        <label className="report-file">
          <span>דוח כניסות</span>
          <input accept=".xlsx,.xls" type="file" onChange={(event) => setFile("arrivals", event.target.files?.[0] || null)} />
          <strong>{files.arrivals?.name || "לא נבחר קובץ"}</strong>
        </label>
        <label className="report-file">
          <span>דוח עזיבות</span>
          <input accept=".xlsx,.xls" type="file" onChange={(event) => setFile("departures", event.target.files?.[0] || null)} />
          <strong>{files.departures?.name || "לא נבחר קובץ"}</strong>
        </label>
      </div>

      <div className="actions report-actions">
        <button className="primary" disabled={busy || !files.arrivals || !files.departures} type="button" onClick={analyze}>
          {busy ? "בודק..." : "בדוק שינויים"}
        </button>
        <button disabled={busy || !canApplyReports} type="button" onClick={applyToSheets}>
          {busy ? "שומר..." : "שמור בשיטס"}
        </button>
      </div>

      {status && <div className="summary-line">{status}</div>}
      {error && <div className="notice error compact">{error}</div>}

      {analysis && (
        <>
          <div className="report-summary">
            <div className="mini-metric">
              <span>כניסות</span>
              <strong>{analysis.summary.arrivals}</strong>
            </div>
            <div className="mini-metric">
              <span>עזיבות</span>
              <strong>{analysis.summary.departures}</strong>
            </div>
            <div className="mini-metric">
              <span>החלפות</span>
              <strong>{analysis.summary.sameDay}</strong>
            </div>
            <div className="mini-metric">
              <span>חדשים</span>
              <strong>{analysis.summary.newRows}</strong>
            </div>
            <div className="mini-metric">
              <span>שונו</span>
              <strong>{analysis.summary.changedRows}</strong>
            </div>
            <div className="mini-metric">
              <span>ללא שינוי</span>
              <strong>{analysis.summary.unchangedRows}</strong>
            </div>
            <div className="mini-metric">
              <span>יוסרו</span>
              <strong>{analysis.summary.removedRows}</strong>
            </div>
          </div>

          <ListBlock title="תצוגה מקדימה" empty="אין רשומות חדשות או משתנות">
            {analysis.preview.map((row) => (
              <article className="list-item" key={row.id}>
                <div>
                  <strong>{row.room}</strong>
                  <p>
                    <DateText>{formatDisplayDate(row.date)}</DateText> · {row.guests || 0} אורחים
                    {row.children ? ` · ${row.children} ילדים` : ""}
                    {row.babies ? ` · ${row.babies} תינוקות` : ""}
                    {row.isOccupied ? " · החלפה" : ""}
                    {row.notes ? ` · ${row.notes}` : ""}
                  </p>
                </div>
              </article>
            ))}
          </ListBlock>
        </>
      )}
    </div>
  );
}

function BookingsCalendar({ rows, reportSync = [], actions, canEdit = false }) {
  const [month, setMonth] = useState(monthKey(today()));
  const [selectedDay, setSelectedDay] = useState(null);
  const [editingRow, setEditingRow] = useState(null);
  const monthRows = rows.filter((row) => monthKey(row.date) === month);
  const rowsByDate = monthRows.reduce((acc, row) => {
    const date = String(row.date || "").slice(0, 10);
    if (!date) return acc;
    if (!acc[date]) acc[date] = [];
    acc[date].push(row);
    return acc;
  }, {});
  const first = new Date(`${monthStart(month)}T12:00:00`);
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const startOffset = first.getDay();
  const cells = [
    ...Array.from({ length: startOffset }, (_, index) => ({ key: `empty-${index}`, empty: true })),
    ...Array.from({ length: daysInMonth }, (_, index) => {
      const day = index + 1;
      const date = `${month}-${String(day).padStart(2, "0")}`;
      return { key: date, date, day, rows: rowsByDate[date] || [] };
    })
  ];
  const totalEntries = monthRows.length;
  const monthDepartureSync = reportSync
    .filter((sync) => String(sync.reportMonth || "") === month)
    .sort((a, b) => String(b.syncedAt || "").localeCompare(String(a.syncedAt || "")))[0];
  const totalDepartures = monthDepartureSync?.departures ?? 0;

  return (
    <div className="calendar-panel">
      <div className="calendar-head">
        <button type="button" onClick={() => setMonth(addMonths(month, -1))}>הקודם</button>
        <div>
          <h3>{formatMonthName(month)}</h3>
          <p>{totalEntries} כניסות בחודש · {totalDepartures} עזיבות בחודש</p>
        </div>
        <button type="button" onClick={() => setMonth(addMonths(month, 1))}>הבא</button>
      </div>
      <div className="calendar-weekdays">
        {["א", "ב", "ג", "ד", "ה", "ו", "ש"].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="calendar-grid">
        {cells.map((cell) => (
          <button
            className={cell.empty ? "calendar-day empty-day" : cell.rows.length ? "calendar-day has-entries" : "calendar-day"}
            disabled={cell.empty}
            key={cell.key}
            onClick={() => !cell.empty && setSelectedDay(cell)}
            type="button"
          >
            {!cell.empty && (
              <>
                <span className="calendar-date">{cell.day}</span>
                {cell.rows.length > 0 && (
                  <strong>
                    <span className="calendar-count-number">{cell.rows.length}</span>
                    <span className="calendar-count-label"> כניסות</span>
                  </strong>
                )}
                {cell.rows.slice(0, 3).map((row) => (
                  <small key={row.id || `${cell.date}-${row.room}`}>{row.room || "חדר"}</small>
                ))}
                {cell.rows.length > 3 && <small>+{cell.rows.length - 3} נוספים</small>}
              </>
            )}
          </button>
        ))}
      </div>
      {selectedDay && (
        <div className="modal-backdrop" role="presentation" onClick={() => setSelectedDay(null)}>
          <div className="calendar-modal" role="dialog" aria-modal="true" aria-labelledby="calendar-modal-title" onClick={(event) => event.stopPropagation()}>
            <div className="calendar-modal-head">
              <div>
                <p className="eyebrow">יומן כניסות</p>
                <h3 id="calendar-modal-title">
                  {selectedDay.day} {formatMonthName(month)}
                </h3>
              </div>
              <button className="ghost" type="button" onClick={() => setSelectedDay(null)}>
                סגור
              </button>
            </div>
            {selectedDay.rows.length ? (
              <div className="calendar-modal-list">
                {selectedDay.rows.map((row) => (
                  <article className="calendar-modal-item" key={row.id || `${selectedDay.date}-${row.room}`}>
                    {editingRow?.id === row.id ? (
                      <TurnoverEditForm row={row} rows={rows} actions={actions} onCancel={() => setEditingRow(null)} onSaved={() => setEditingRow(null)} />
                    ) : (
                      <>
                        <strong>{row.room || "חדר"}</strong>
                        <p>
                          {row.guests || 0} אורחים
                          {row.children ? ` · ${row.children} ילדים` : ""}
                          {row.babies ? ` · ${row.babies} תינוקות` : ""}
                          {row.isReturning ? " · לקוח חוזר" : " · לקוח חדש"}
                          {row.isOccupied ? " · החלפה" : ""}
                        </p>
                        {row.notes && <small>{row.notes}</small>}
                        {canEdit && actions && (
                          <div className="actions calendar-modal-actions">
                            <button className="edit-button" type="button" onClick={() => setEditingRow(row)}>
                              <span aria-hidden="true">✎</span>
                              ערוך
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <div className="calendar-modal-empty">אין כניסות ביום הזה</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
function getRoomOptions(rows) {
  return BOOKING_ROOMS;
}

function TurnoverList({ title, rows, allRows = rows, actions, readOnly = false, canEdit = false }) {
  const [editingId, setEditingId] = useState("");
  return (
    <ListBlock title={title} empty="אין סידורים להצגה">
      {rows.map((row) => (
        <article className="list-item" key={row.id}>
          {editingId === row.id ? (
            <TurnoverEditForm row={row} rows={allRows} actions={actions} onCancel={() => setEditingId("")} onSaved={() => setEditingId("")} />
          ) : (
            <>
              <div>
                <strong>{row.room}</strong>
                <p>
                  <DateText>{formatDisplayDate(row.date)}</DateText> · {row.guests || 0} אורחים
                  {row.children ? ` · ${row.children} ילדים` : ""}
                  {row.babies ? ` · ${row.babies} תינוקות` : ""}
                  {row.isReturning ? " · לקוח חוזר" : " · לקוח חדש"}
                  {row.isOccupied ? " · החלפה" : ""}
                  {row.notes ? ` · ${row.notes}` : ""}
                </p>
              </div>
              <div className="actions">
                {canEdit && (
                  <button type="button" onClick={() => setEditingId(row.id)}>
                    ערוך
                  </button>
                )}
                {!readOnly && !isDone(row) && (
                  <button type="button" disabled={actions.isPending(`update:${TABLES.turnovers}:${row.id}`)} onClick={() => actions.update(TABLES.turnovers, { ...row, status: "completed", completedAt: nowIso() })}>
                    {actions.isPending(`update:${TABLES.turnovers}:${row.id}`) ? "מסמן..." : "בוצע"}
                  </button>
                )}
                {!readOnly && !isDone(row) && (
                  <button className={row.gardenDone ? "success-soft" : ""} type="button" disabled={actions.isPending(`update:${TABLES.turnovers}:${row.id}`)} onClick={() => actions.update(TABLES.turnovers, { ...row, gardenDone: true, gardenDoneAt: nowIso() })}>
                    {actions.isPending(`update:${TABLES.turnovers}:${row.id}`) ? "מסמן..." : row.gardenDone ? "גינה ✓" : "גינה"}
                  </button>
                )}
                {!readOnly && (
                  <button className="danger" type="button" disabled={actions.isPending(`remove:${TABLES.turnovers}:${row.id}`)} onClick={() => actions.remove(TABLES.turnovers, row.id)}>
                    {actions.isPending(`remove:${TABLES.turnovers}:${row.id}`) ? "מוחק..." : "מחק"}
                  </button>
                )}
              </div>
            </>
          )}
        </article>
      ))}
    </ListBlock>
  );
}

function TurnoverEditForm({ row, rows, actions, onCancel, onSaved }) {
  const [form, setForm] = useState({
    room: row.room || "",
    date: String(row.date || today()).slice(0, 10),
    guests: Number(row.guests) || 0,
    children: Number(row.children) || 0,
    babies: Number(row.babies) || 0,
    hasCrib: row.hasCrib === true || row.hasCrib === "TRUE",
    hasHighChair: row.hasHighChair === true || row.hasHighChair === "TRUE",
    isReturning: row.isReturning === true || row.isReturning === "TRUE",
    isOccupied: row.isOccupied === true || row.isOccupied === "TRUE",
    notes: row.notes || ""
  });
  const [duplicateNotice, setDuplicateNotice] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    if (!form.room.trim()) return;
    const duplicate = findDuplicateTurnover(rows, form, row.id);
    if (duplicate) {
      setDuplicateNotice(`כבר קיימת כניסה לאותו חדר באותו יום: ${turnoverDetails(duplicate)}`);
      return;
    }
    await actions.update(TABLES.turnovers, {
      ...row,
      ...form,
      room: form.room.trim(),
      updatedAt: nowIso()
    });
    setDuplicateNotice("");
    onSaved();
  };

  return (
    <form className="form turnover-edit-form" onSubmit={submit}>
      {duplicateNotice && <div className="notice error compact">{duplicateNotice}</div>}
      <label>
        חדר / יחידה
        <input value={form.room} onChange={(event) => setForm({ ...form, room: event.target.value })} />
      </label>
      <div className="form-row">
        <label>
          תאריך
          <input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
        </label>
        <label>
          אורחים
          <input type="number" min="0" value={form.guests} onChange={(event) => setForm({ ...form, guests: Number(event.target.value) || 0 })} />
        </label>
      </div>
      <div className="child-baby-stack">
        <label>
          ילדים
          <input type="number" min="0" value={form.children} onChange={(event) => setForm({ ...form, children: Number(event.target.value) || 0 })} />
        </label>
        <label>
          תינוקות
          <input type="number" min="0" value={form.babies} onChange={(event) => setForm({ ...form, babies: Number(event.target.value) || 0 })} />
        </label>
      </div>
      <div className="checks">
        <Check label="לול" checked={form.hasCrib} onChange={(checked) => setForm({ ...form, hasCrib: checked })} />
        <Check label="כסא אוכל" checked={form.hasHighChair} onChange={(checked) => setForm({ ...form, hasHighChair: checked })} />
        <Check label="החלפה" checked={form.isOccupied} onChange={(checked) => setForm({ ...form, isOccupied: checked })} />
      </div>
      <label>
        סוג לקוח
        <Segmented
          value={form.isReturning ? "לקוח חוזר" : "לקוח חדש"}
          options={["לקוח חדש", "לקוח חוזר"]}
          onChange={(value) => setForm({ ...form, isReturning: value === "לקוח חוזר" })}
        />
      </label>
      <label>
        הערות
        <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
      </label>
      <div className="actions">
        <button className="primary" disabled={actions.isPending(`update:${TABLES.turnovers}:${row.id}`)} type="submit">
          {actions.isPending(`update:${TABLES.turnovers}:${row.id}`) ? "שומר..." : "שמור שינוי"}
        </button>
        <button className="ghost" type="button" onClick={onCancel}>
          בטל
        </button>
      </div>
    </form>
  );
}

function HouseTurnoversPanel({ rows, reportSync = [], saving, user, actions }) {
  const [view, setView] = useState("today");
  const todayDate = today();
  const weekEnd = addDays(todayDate, 7);
  const pending = rows.filter((row) => !isDone(row));
  const todayRows = pending
    .filter((row) => String(row.date || "").slice(0, 10) === todayDate)
    .sort((a, b) => String(a.room || "").localeCompare(String(b.room || "")));
  const futureRows = pending
    .filter((row) => {
      const date = String(row.date || "").slice(0, 10);
      return date > todayDate && date <= weekEnd;
    })
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || String(a.room || "").localeCompare(String(b.room || "")));
  const visibleRows = view === "today" ? todayRows : futureRows;
  const heroTitle = view === "calendar" ? "יומן כניסות" : view === "today" ? "החדרים של היום" : "השבוע הקרוב";
  const heroSubtitle = view === "calendar" ? "כמות כניסות לפי יום" : view === "today" ? `${todayRows.length} חדרים להכנה היום` : `${futureRows.length} חדרים עתידיים עד שבוע קדימה`;

  return (
    <section className="house-board">
      <div className="house-hero">
        <p className="eyebrow">משק בית</p>
        <h2>{heroTitle}</h2>
        <p>{heroSubtitle}</p>
      </div>

      <div className="house-switch house-switch-three">
        <button className={view === "calendar" ? "active" : ""} type="button" onClick={() => setView("calendar")}>
          יומן
        </button>
        <button className={view === "today" ? "active" : ""} type="button" onClick={() => setView("today")}>
          היום
        </button>
        <button className={view === "future" ? "active" : ""} type="button" onClick={() => setView("future")}>
          עתידי
        </button>
      </div>

      {view === "calendar" ? (
        <BookingsCalendar rows={rows} reportSync={reportSync} />
      ) : (
        <div className="house-room-list">
          {visibleRows.length === 0 ? (
            <div className="house-empty">{view === "today" ? "אין חדרים להכנה היום" : "אין חדרים עתידיים בשבוע הקרוב"}</div>
          ) : (
            visibleRows.map((row) => (
              <HouseRoomCard
                key={row.id}
                row={row}
                saving={saving}
                user={user}
                completing={actions.isPending(`update:${TABLES.turnovers}:${row.id}`)}
                showComplete={view === "today"}
                onComplete={() => actions.update(TABLES.turnovers, { ...row, status: "completed", completedAt: nowIso() })}
                actions={actions}
              />
            ))
          )}
        </div>
      )}
    </section>
  );
}
function HouseRoomCard({ row, user, completing, onComplete, actions, showComplete = true }) {
  const [issueText, setIssueText] = useState("");
  const [issueOpen, setIssueOpen] = useState(false);
  const childParts = [
    row.children ? `${row.children} ילדים` : "",
    row.babies ? `${row.babies} תינוקות` : ""
  ].filter(Boolean);
  const equipment = [
    row.hasCrib ? "לול" : "",
    row.hasHighChair ? "כסא אוכל" : "",
    row.isReturning ? "לקוח חוזר" : "לקוח חדש",
    row.isOccupied ? "החלפה" : ""
  ].filter(Boolean);
  const issuePending = actions.isPending("add:maintenance") || actions.isPending("add:notifications");

  const submitIssue = async () => {
    const text = issueText.trim();
    if (!text) {
      setIssueOpen(true);
      return;
    }

    const createdAt = nowIso();
    const reporter = user?.display || user?.username || "משק בית";
    const title = `תקלה בחדר ${row.room || ""}`.trim();

    await actions.add(TABLES.maintenance, {
      id: newId(),
      title,
      description: text,
      location: row.room || "",
      dueDate: "",
      urgency: "דחוף",
      status: "open",
      source: "house",
      createdByName: reporter,
      createdAt,
      completedAt: ""
    });

    await actions.add(TABLES.notifications, {
      id: newId(),
      for: "maint",
      room: row.room || "משק בית",
      date: today(),
      message: `${reporter} דיווח/ה על תקלה בחדר ${row.room || ""}: ${text}`.trim(),
      read: false,
      createdAt,
      pushSent: ""
    });

    setIssueText("");
    setIssueOpen(false);
    actions.notice("התקלה נשלחה לאחזקה");
  };

  return (
    <article className={row.isOccupied ? "house-room occupied" : "house-room"}>
      <div className="house-room-top">
        <div>
          <p><DateText>{formatDisplayDate(row.date)}</DateText></p>
          <h3>{row.room}</h3>
        </div>
        {row.isOccupied && <span className="house-alert">החלפה</span>}
      </div>

      <div className="house-big-meta">
        <span>{row.guests || 0} אורחים</span>
        {childParts.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>

      {equipment.length > 0 && (
        <div className="house-tags">
          {equipment.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      )}

      {row.notes && <div className="house-note">{row.notes}</div>}

      <div className={`house-issue ${issueOpen || issueText ? "open" : ""}`}>
        <button className="danger-soft house-issue-toggle" type="button" onClick={() => setIssueOpen((current) => !current)}>
          {issueOpen ? "סגור דיווח תקלה" : "דווח תקלה"}
        </button>
        {(issueOpen || issueText) && (
          <div className="house-issue-form">
            <label>
              מה דורש תשומת לב
              <textarea
                value={issueText}
                onChange={(event) => setIssueText(event.target.value)}
                placeholder="לדוגמה: נזילה, מזגן, מנורה, ריח, ניקיון נוסף..."
              />
            </label>
            <button className="danger-soft" disabled={issuePending || !issueText.trim()} type="button" onClick={submitIssue}>
              {issuePending ? "שולח..." : "שלח לאחזקה"}
            </button>
          </div>
        )}
      </div>

      {showComplete && (
        <div className="house-actions">
          <button className="primary" disabled={completing} type="button" onClick={onComplete}>
            {completing ? "מסמן..." : "סיימתי את החדר"}
          </button>
        </div>
      )}
    </article>
  );
}

function MaintenancePanel({ rows, turnovers, saving, user, actions }) {
  const [form, setForm] = useState({ title: "", description: "", location: "", dueDate: "", urgency: "רגיל" });
  const open = rows.filter((row) => !isDone(row));
  const done = rows.filter((row) => isDone(row));
  const todayGardenRows = turnovers
    .filter((row) => String(row.date || "").slice(0, 10) === today() && !row.gardenDone)
    .sort((a, b) => String(a.room || "").localeCompare(String(b.room || "")));

  const submit = async (event) => {
    event.preventDefault();
    if (!form.title.trim()) return;
    const createdAt = nowIso();
    const title = form.title.trim();
    const creator = user.display || user.username;
    await actions.add(TABLES.maintenance, {
      id: newId(),
      ...form,
      title,
      status: "open",
      source: user.role,
      createdByName: creator,
      createdAt,
      completedAt: ""
    });
    await actions.add(TABLES.notifications, {
      id: newId(),
      for: "maint",
      room: "משימת אחזקה",
      date: today(),
      message: `${creator} יצר/ה משימת אחזקה: ${title}${form.location ? ` · ${form.location}` : ""}${form.urgency ? ` · ${form.urgency}` : ""}`,
      read: false,
      createdAt,
      pushSent: ""
    });
    setForm({ title: "", description: "", location: "", dueDate: "", urgency: "רגיל" });
  };

  return (
    <section className="panel">
      <SectionHead title="אחזקה" badge={`${open.length} פתוחות`} />
      <ListBlock title="כניסות היום - גינות" empty="אין כניסות שממתינות לגינה היום">
        {todayGardenRows.map((row) => (
          <article className="list-item" key={row.id}>
            <div>
              <strong>{row.room}</strong>
              <p>
                {row.guests || 0} אורחים
                {row.notes ? ` · ${row.notes}` : ""}
              </p>
            </div>
            <div className="actions">
              <button type="button" disabled={actions.isPending(`update:${TABLES.turnovers}:${row.id}`)} onClick={() => actions.update(TABLES.turnovers, { ...row, gardenDone: true, gardenDoneAt: nowIso() })}>
                {actions.isPending(`update:${TABLES.turnovers}:${row.id}`) ? "מסמן..." : "בוצע"}
              </button>
            </div>
          </article>
        ))}
      </ListBlock>
      <form className="form" onSubmit={submit}>
        <label>
          כותרת
          <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="נזילה, מזגן, מנורה..." />
        </label>
        <div className="form-row">
          <label>
            מיקום
            <input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} />
          </label>
          <label>
            תאריך יעד
            <input type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} />
          </label>
        </div>
        <Segmented value={form.urgency} options={["רגיל", "דחוף", "קריטי"]} onChange={(urgency) => setForm({ ...form, urgency })} />
        <label>
          פירוט
          <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
        </label>
        <button className="primary" disabled={!form.title.trim() || actions.isPending("add:maintenance")} type="submit">
          {actions.isPending("add:maintenance") ? "שומר..." : "הוסף לאחזקה"}
        </button>
      </form>
      <MaintenanceList title="פתוחות" rows={open} actions={actions} />
      <MaintenanceList title="בוצעו" rows={done.slice(0, 10)} actions={actions} />
    </section>
  );
}
function MaintenanceList({ title, rows, actions }) {
  return (
    <ListBlock title={title} empty="אין משימות אחזקה">
      {rows.map((row) => (
        <article className={`list-item ${row.urgency === "קריטי" ? "critical" : row.urgency === "דחוף" ? "urgent" : ""}`} key={row.id}>
          <div>
            <strong>{row.title}</strong>
            <p>
              {row.location || "ללא מיקום"} · {row.urgency || "רגיל"}
              {row.dueDate ? ` · עד ${row.dueDate}` : ""}
              {row.description ? ` · ${row.description}` : ""}
            </p>
          </div>
          <div className="actions">
            {row.status !== "done" && (
              <button type="button" disabled={actions.isPending(`update:${TABLES.maintenance}:${row.id}`)} onClick={() => actions.update(TABLES.maintenance, { ...row, status: "done", completedAt: nowIso() })}>
                {actions.isPending(`update:${TABLES.maintenance}:${row.id}`) ? "מסמן..." : "בוצע"}
              </button>
            )}
            <button className="danger" type="button" disabled={actions.isPending(`remove:${TABLES.maintenance}:${row.id}`)} onClick={() => actions.remove(TABLES.maintenance, row.id)}>
              {actions.isPending(`remove:${TABLES.maintenance}:${row.id}`) ? "מוחק..." : "מחק"}
            </button>
          </div>
        </article>
      ))}
    </ListBlock>
  );
}

function ShoppingPanel({ rows, saving, user, users, actions }) {
  const [form, setForm] = useState({ item: "", quantity: 1, note: "", category: "" });
  const visibleRows = user.role === "house" ? rows.filter((row) => isShoppingRequestedByUser(row, user)) : rows;
  const requested = visibleRows.filter((row) => !isPurchased(row));
  const purchased = visibleRows.filter((row) => isPurchased(row));

  const submit = async (event) => {
    event.preventDefault();
    if (!form.item.trim()) return;
    const requestedAt = nowIso();
    const creator = user.display || user.username;
    const item = form.item.trim();
    await actions.add(TABLES.shopping, {
      id: newId(),
      ...form,
      item,
      requestedBy: creator,
      requestedById: user.username,
      requestedByRole: user.role,
      status: "requested",
      requestedAt,
      purchasedAt: ""
    });
    await actions.add(TABLES.notifications, {
      id: newId(),
      for: "admin",
      room: "קניות",
      date: today(),
      message: `${creator} יצר/ה בקשת קנייה: ${item} · כמות ${form.quantity || 1}${form.category ? ` · ${form.category}` : ""}${form.note ? ` · ${form.note}` : ""}`,
      read: false,
      createdAt: requestedAt,
      pushSent: ""
    });
    setForm({ item: "", quantity: 1, note: "", category: "" });
  };

  const approvePurchase = async (row) => {
    const purchasedAt = nowIso();
    await actions.update(TABLES.shopping, { ...row, status: "purchased", purchasedAt });
    if (user.role === "admin" && isShoppingRequestedByHouse(row, users)) {
      await actions.add(TABLES.notifications, {
        id: newId(),
        for: "house",
        room: "קניות",
        date: today(),
        message: `אושרה רכישה: ${row.item || "פריט"}`,
        read: false,
        createdAt: purchasedAt,
        pushSent: ""
      });
    }
  };

  return (
    <section className="panel">
      <SectionHead title="קניות" badge={`${requested.length} ממתינות`} />
      <form className="form" onSubmit={submit}>
        <label>
          שם הפריט
          <input value={form.item} onChange={(event) => setForm({ ...form, item: event.target.value })} />
        </label>
        <div className="form-row">
          <label>
            כמות
            <input type="number" min="1" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: Number(event.target.value) || 1 })} />
          </label>
          <label>
            קטגוריה
            <input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} />
          </label>
        </div>
        <label>
          הערה
          <input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
        </label>
        <button className="primary" disabled={!form.item.trim() || actions.isPending("add:shopping")} type="submit">
          {actions.isPending("add:shopping") ? "שומר..." : "הוסף לקניות"}
        </button>
      </form>
      <ShoppingList title="ממתין לרכישה" rows={requested} actions={actions} onPurchase={approvePurchase} />
      <ShoppingList title="נרכש" rows={purchased.slice(0, 10)} actions={actions} onPurchase={approvePurchase} />
    </section>
  );
}

function ShoppingList({ title, rows, actions, onPurchase }) {
  return (
    <ListBlock title={title} empty="אין פריטים">
      {rows.map((row) => (
        <article className="list-item" key={row.id}>
          <div>
            <strong>{row.item}</strong>
            <p>
              כמות {row.quantity || 1}
              {row.category ? ` · ${row.category}` : ""}
              {row.note ? ` · ${row.note}` : ""}
              {row.requestedBy ? ` · ${row.requestedBy}` : ""}
            </p>
          </div>
          <div className="actions">
            {row.status !== "purchased" && (
              <button type="button" disabled={actions.isPending(`update:${TABLES.shopping}:${row.id}`)} onClick={() => onPurchase(row)}>
                {actions.isPending(`update:${TABLES.shopping}:${row.id}`) ? "מסמן..." : "נרכש"}
              </button>
            )}
            <button className="danger" type="button" disabled={actions.isPending(`remove:${TABLES.shopping}:${row.id}`)} onClick={() => actions.remove(TABLES.shopping, row.id)}>
              {actions.isPending(`remove:${TABLES.shopping}:${row.id}`) ? "מוחק..." : "מחק"}
            </button>
          </div>
        </article>
      ))}
    </ListBlock>
  );
}

function HoursPanel({ rows, saving, user, users = [], actions }) {
  const [form, setForm] = useState({ date: today(), startTime: "08:00", endTime: "16:00" });
  const visibleRows = user.role === "admin"
    ? rows.filter((row) => isHouseOrMaintenanceHour(row))
    : rows.filter((row) => row.userId === user.username || row.userName === user.display);
  const currentMonth = monthKey(today());
  const monthTotal = visibleRows.filter((row) => monthKey(row.date) === currentMonth).reduce((sum, row) => sum + (Number(row.totalHours) || 0), 0);
  const total = hoursBetween(form.startTime, form.endTime);

  const submit = async (event) => {
    event.preventDefault();
    if (total <= 0) return;
    await actions.add(TABLES.hours, {
      id: newId(),
      userId: user.username,
      userName: user.display || user.username,
      date: form.date,
      startTime: form.startTime,
      endTime: form.endTime,
      totalHours: total,
      createdAt: nowIso()
    });
  };

  return (
    <section className="panel">
      <SectionHead title="שעות" badge={`${monthTotal.toFixed(1)} החודש`} />
      {user.role === "admin" ? (
        null
      ) : (
        <form className="form" onSubmit={submit}>
          <div className="form-row three">
            <label>
              תאריך
              <input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
            </label>
            <label>
              התחלה
              <input type="time" value={form.startTime} onChange={(event) => setForm({ ...form, startTime: event.target.value })} />
            </label>
            <label>
              סיום
              <input type="time" value={form.endTime} onChange={(event) => setForm({ ...form, endTime: event.target.value })} />
            </label>
          </div>
          <div className="summary-line">סה"כ משמרת: {total.toFixed(1)} שעות</div>
          <button className="primary" disabled={total <= 0 || actions.isPending("add:hours")} type="submit">
            {actions.isPending("add:hours") ? "שומר..." : "שמור שעות"}
          </button>
        </form>
      )}
      <ListBlock title="רישומי שעות" empty="אין שעות">
        {visibleRows.slice().reverse().slice(0, 20).map((row) => (
          user.role === "admin" ? (
            <article className="list-item hours-row" key={row.id}>
              <span>שם: {displayHourUserName(row, users)}</span>
              <span>תאריך: <DateText>{formatDisplayDate(row.date)}</DateText></span>
              <span>כניסה: <DateText>{row.startTime || "-"}</DateText></span>
              <span>יציאה: <DateText>{row.endTime || "-"}</DateText></span>
              <strong>סה"כ: {Number(row.totalHours || 0).toFixed(1)} שעות</strong>
            </article>
          ) : (
            <article className="list-item" key={row.id}>
              <div>
                <strong>{row.userName}</strong>
                <p>
                  <DateText>{formatDisplayDate(row.date)}</DateText> · <DateText>{row.startTime}-{row.endTime}</DateText>
                </p>
              </div>
              <div className="actions">
                <span className="pill subtle">{row.totalHours} שעות</span>
                <button className="danger" type="button" disabled={actions.isPending(`remove:${TABLES.hours}:${row.id}`)} onClick={() => actions.remove(TABLES.hours, row.id)}>
                  {actions.isPending(`remove:${TABLES.hours}:${row.id}`) ? "מוחק..." : "מחק"}
                </button>
              </div>
            </article>
          )
        ))}
      </ListBlock>
    </section>
  );
}

function displayHourUserName(row, users = []) {
  const value = `${row.userName || ""} ${row.userId || ""}`.trim();
  const lower = value.toLowerCase();
  const matchedUser = users.find((person) =>
    sameText(person.username, row.userId) ||
    sameText(person.username, row.userName) ||
    sameText(person.display, row.userName)
  );
  if (matchedUser?.display) return matchedUser.display;
  if (lower.includes("jude") || lower.includes("jud") || lower.includes("house")) return "ג׳וד";
  if (lower.includes("offer") || lower.includes("ofer") || lower.includes("maint")) return "אחזקה";
  return "לא ידוע";
}

function isHouseOrMaintenanceHour(row) {
  const value = `${row.userId || ""} ${row.userName || ""}`.toLowerCase();
  return (
    value.includes("house") ||
    value.includes("jude") ||
    value.includes("jud") ||
    value.includes("ג׳וד") ||
    value.includes("ג'וד") ||
    value.includes("maint") ||
    value.includes("offer") ||
    value.includes("ofer") ||
    value.includes("עופר")
  );
}

function NotificationsPanel({ rows, turnovers, user, actions }) {
  const [hiddenReadyRooms, setHiddenReadyRooms] = useState([]);
  const readyRooms = turnovers
    .filter((row) => isDone(row) && !hiddenReadyRooms.includes(row.id))
    .sort((a, b) => String(b.completedAt || b.date || "").localeCompare(String(a.completedAt || a.date || "")));
  const adminRows = rows
    .filter((row) => row.read !== true && row.read !== "TRUE" && (row.for === "admin" || row.for === "all"))
    .sort((a, b) => String(b.createdAt || b.date || "").localeCompare(String(a.createdAt || a.date || "")));
  const visibleRows = user.role === "admin"
    ? adminRows
    : rows.filter((row) => row.read !== true && row.read !== "TRUE" && (row.for === "all" || row.for === user.role || row.for === user.username));
  const adminNotificationCount = readyRooms.length + adminRows.length;

  return (
    <section className="panel">
      <SectionHead title="התראות" badge={`${user.role === "admin" ? adminNotificationCount : visibleRows.length} התראות`} />
      {user.role === "admin" ? (
        <>
          <ListBlock title="חדרים מוכנים" empty="אין חדרים שסומנו כמוכנים">
            {readyRooms.map((row) => (
              <article className="list-item" key={row.id}>
                <div>
                  <strong>{row.room || "חדר"}</strong>
                  <p>
                    {row.date ? <>כניסה: <DateText>{formatDisplayDate(row.date)}</DateText></> : "סומן כמוכן"}
                    {row.completedAt ? <> · מוכן: <DateText>{formatDateTime(row.completedAt)}</DateText></> : ""}
                    {row.guests ? ` · ${row.guests} אורחים` : ""}
                    {row.notes ? ` · ${row.notes}` : ""}
                  </p>
                </div>
                <div className="actions">
                  <button
                    type="button"
                    onClick={() => {
                      setHiddenReadyRooms((current) => [...current, row.id]);
                      actions.notice("הוסר מהתצוגה");
                    }}
                  >
                    נקרא
                  </button>
                </div>
              </article>
            ))}
          </ListBlock>
          <ListBlock title="התראות אדמין" empty="אין התראות אדמין">
            {adminRows.map((row) => (
              <article className="list-item" key={row.id}>
                <div>
                  <strong>{row.room || "התראה"}</strong>
                  <p>{row.message}</p>
                </div>
                <div className="actions">
                  <button type="button" disabled={actions.isPending(`update:${TABLES.notifications}:${row.id}`)} onClick={() => actions.update(TABLES.notifications, { ...row, read: true })}>
                    {actions.isPending(`update:${TABLES.notifications}:${row.id}`) ? "מסמן..." : "נקרא"}
                  </button>
                </div>
              </article>
            ))}
          </ListBlock>
        </>
      ) : (
        <ListBlock title="התראות" empty="אין התראות">
          {visibleRows.slice().reverse().map((row) => (
            <article className="list-item" key={row.id}>
              <div>
                <strong>{row.room || "התראה"}</strong>
                <p>
                  {row.message}
                  {row.pushSent ? ` · Push: ${row.pushSent}` : ""}
                </p>
              </div>
              <div className="actions">
                <button type="button" disabled={actions.isPending(`update:${TABLES.notifications}:${row.id}`)} onClick={() => actions.update(TABLES.notifications, { ...row, read: true })}>
                  {actions.isPending(`update:${TABLES.notifications}:${row.id}`) ? "מסמן..." : "נקרא"}
                </button>
                <button className="danger" type="button" disabled={actions.isPending(`remove:${TABLES.notifications}:${row.id}`)} onClick={() => actions.remove(TABLES.notifications, row.id)}>
                  {actions.isPending(`remove:${TABLES.notifications}:${row.id}`) ? "מוחק..." : "מחק"}
                </button>
              </div>
            </article>
          ))}
        </ListBlock>
      )}
    </section>
  );
}

function PoolPanel({ logs, equipment, saving, user, actions }) {
  const [chlorineSent, setChlorineSent] = useState(false);
  const treatmentLogs = logs
    .filter(isPoolTreatment)
    .sort((a, b) => String(b.doneAt || "").localeCompare(String(a.doneAt || "")));
  const uvLogs = logs
    .filter(isPoolUv)
    .sort((a, b) => String(b.doneAt || "").localeCompare(String(a.doneAt || "")));
  const lastTreatment = treatmentLogs[0] || null;
  const lastUv = uvLogs[0] || null;
  const treatmentState = getPoolTreatmentState(lastTreatment?.doneAt);

  const completeTreatment = async () => {
    await actions.add(TABLES.poolLogs, {
      id: newId(),
      type: "טיפול בריכה",
      doneAt: nowIso(),
      doneBy: user.display || user.username,
      notes: ""
    });
  };

  const requestChlorine = async () => {
    await actions.add(TABLES.shopping, {
      id: newId(),
      item: "כלור לבריכה",
      quantity: 1,
      note: "בקשה ממסך בריכה",
      requestedBy: user.display || user.username,
      status: "requested",
      requestedAt: nowIso(),
      purchasedAt: "",
      category: "בריכה"
    });
    setChlorineSent(true);
    setTimeout(() => setChlorineSent(false), 2500);
  };

  const registerUvReplacement = async () => {
    await actions.add(TABLES.poolLogs, {
      id: newId(),
      type: "החלפת מנורות UV",
      doneAt: nowIso(),
      doneBy: user.display || user.username,
      notes: ""
    });
  };

  return (
    <section className="pool-screen">
      {user.role !== "admin" ? (
        <>
          <div className="pool-hero">
            <p className="eyebrow">בריכה</p>
            <h2>טיפול כל יומיים</h2>
            <div className={`pool-status ${treatmentState.level}`}>
              <strong>{treatmentState.title}</strong>
              <span>{treatmentState.subtitle}</span>
            </div>
            <button className="pool-main-action" disabled={actions.isPending("add:pool_logs")} type="button" onClick={completeTreatment}>
              {actions.isPending("add:pool_logs") ? "שומר טיפול..." : "סיימתי טיפול בבריכה"}
            </button>
          </div>

          <div className="pool-actions">
            <button className={chlorineSent ? "success-soft" : "danger-soft"} disabled={actions.isPending("add:shopping")} type="button" onClick={requestChlorine}>
              {actions.isPending("add:shopping") ? "שולח..." : chlorineSent ? "נשלח לאלדד" : "בקש כלור"}
            </button>
            <button className="purple-soft" disabled={actions.isPending("add:pool_logs")} type="button" onClick={registerUvReplacement}>
              {actions.isPending("add:pool_logs") ? "שומר..." : "רישום החלפת מנורות UV"}
            </button>
          </div>
        </>
      ) : (
        <div className="panel">
          <SectionHead title="בריכה" badge="תצוגת אדמין" />
          <div className={`pool-status admin-pool-status ${treatmentState.level}`}>
            <strong>{treatmentState.title}</strong>
            <span>{treatmentState.subtitle}</span>
          </div>
        </div>
      )}

      <ListBlock title="מנורות UV" empty="אין רישום החלפת UV">
        {lastUv && (
          <article className="list-item" key={lastUv.id}>
            <div>
              <strong>החלפה אחרונה</strong>
              <p><DateText>{formatDateTime(lastUv.doneAt)}</DateText></p>
            </div>
          </article>
        )}
      </ListBlock>
      <ListBlock title="ציוד בריכה" empty="אין ציוד להצגה">
        {equipment.map((row) => (
          <article className="list-item" key={row.id || row.name}>
            <div>
              <strong>{row.name || row.type || "ציוד"}</strong>
              <p>
                {row.lastReplaced ? <>הוחלף: <DateText>{formatDateTime(row.lastReplaced)}</DateText></> : "לא נרשם תאריך החלפה"}
                {row.notes ? ` · ${row.notes}` : ""}
              </p>
            </div>
          </article>
        ))}
      </ListBlock>

      <ListBlock title="היסטוריית טיפולים" empty="אין טיפולים קודמים">
        {treatmentLogs.slice(0, 30).map((row) => (
          <article className="list-item" key={row.id}>
            <div>
              <strong><DateText>{formatDateTime(row.doneAt)}</DateText></strong>
              <p>
                {row.doneBy || "עופר"}
                {row.notes ? ` · ${row.notes}` : ""}
              </p>
            </div>
            <span className="pill subtle">טיפול</span>
          </article>
        ))}
      </ListBlock>
    </section>
  );
}

function getPoolTreatmentState(doneAt) {
  if (!doneAt) {
    return {
      level: "due",
      title: "לא נמצא טיפול קודם",
      subtitle: "מומלץ לרשום טיפול עכשיו"
    };
  }

  const last = new Date(doneAt);
  const diffDays = Math.floor((Date.now() - last.getTime()) / 86400000);
  const next = new Date(last.getTime() + 2 * 86400000);

  if (diffDays >= 2) {
    return {
      level: "due",
      title: "צריך טיפול היום",
      subtitle: `עברו ${diffDays} ימים מהטיפול האחרון`
    };
  }

  return {
    level: "ok",
    title: "הבריכה בטווח טיפול",
    subtitle: `הטיפול הבא: ${next.toLocaleDateString("he-IL")}`
  };
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("he-IL", {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function SectionHead({ title, badge }) {
  return (
    <div className="section-head">
      <div>
        <p className="eyebrow">ניהול</p>
        <h2>{title}</h2>
      </div>
      <span className="pill subtle">{badge}</span>
    </div>
  );
}

function Stat({ title, value, icon, tone = "blue", onClick }) {
  return (
    <button className={`stat stat-button ${tone}`} type="button" onClick={onClick}>
      <span className="stat-icon">{icon}</span>
      <span>{title}</span>
      <strong>{value}</strong>
      <small>פתח</small>
    </button>
  );
}

function MiniRows({ rows, empty, getTitle, getMeta }) {
  if (!rows.length) {
    return <div className="empty compact">{empty}</div>;
  }

  return (
    <div className="mini-list">
      {rows.map((row) => (
        <div className="mini-row" key={row.id}>
          <strong>{getTitle(row)}</strong>
          <span>{getMeta(row)}</span>
        </div>
      ))}
    </div>
  );
}

function ListBlock({ title, empty, children }) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <div className="list-block">
      <h3>{title}</h3>
      {items.length === 0 ? <div className="empty">{empty}</div> : <div className="list">{items}</div>}
    </div>
  );
}

function Check({ label, checked, onChange }) {
  return (
    <button className={checked ? "check active" : "check"} type="button" onClick={() => onChange(!checked)}>
      {checked ? "✓ " : ""}
      {label}
    </button>
  );
}

function Segmented({ value, options, onChange }) {
  return (
    <div className="segmented" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((option) => (
        <button className={value === option ? "active" : ""} key={option} type="button" onClick={() => onChange(option)}>
          {option}
        </button>
      ))}
    </div>
  );
}







