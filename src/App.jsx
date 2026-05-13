import React, { useEffect, useMemo, useRef, useState } from "react";
import { addRecord, deleteRecord, readAll, readCachedData, saveCachedData, updateRecord } from "./api";
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
  pool_equipment: []
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
  maint: ["maintenance", "hours", "pool", "shopping"],
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
  return `שינוי בסידור עבודה - ${room}${date ? ` (${date})` : ""}: ${changes.join(" · ")}`;
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

function turnoverDetails(row) {
  if (!row) return "";
  return [
    row.room || "חדר",
    row.date,
    `${row.guests || 0} אורחים`,
    row.children ? `${row.children} ילדים` : "",
    row.babies ? `${row.babies} תינוקות` : "",
    row.isReturning ? "לקוח חוזר" : "לקוח חדש",
    row.isOccupied ? "החלפה" : "",
    row.notes || ""
  ].filter(Boolean).join(" · ");
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
  const [saving, setSaving] = useState(false);
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

  const runInBackground = (operation, messages) => {
    pendingWritesRef.current += 1;
    setSaving(true);
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
        if (pendingWritesRef.current === 0) setSaving(false);
      });
  };

  const actions = {
    notice: (text, type = "success") => {
      setActionNotice({ type, text });
      window.setTimeout(() => {
        setActionNotice((current) => (current?.text === text ? null : current));
      }, 1600);
    },
    add: (table, record) => {
      applyOptimisticData((current) => ({
        ...current,
        [table]: [...(current[table] || []), record]
      }));
      runInBackground(() => addRecord(table, record), { pending: "נשלח...", success: "נשמר" });
      setError("");
      return Promise.resolve();
    },
    update: (table, record) => {
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
      }, { pending: "נשלח עדכון...", success: "עודכן" });
      setError("");
      return Promise.resolve();
    },
    remove: (table, id) => {
      applyOptimisticData((current) => ({
        ...current,
        [table]: (current[table] || []).filter((row) => row.id !== id)
      }));
      runInBackground(() => deleteRecord(table, id), { pending: "מוחק...", success: "נמחק" });
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
        <button className="ghost" type="button" onClick={logout}>
          יציאה
        </button>
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
      {tab === "turnovers" && <TurnoversPanel rows={data.turnovers} saving={saving} user={user} actions={actions} />}
      {tab === "maintenance" && <MaintenancePanel rows={data.maintenance} turnovers={data.turnovers} saving={saving} user={user} actions={actions} />}
      {tab === "shopping" && <ShoppingPanel rows={data.shopping} saving={saving} user={user} users={data.users} actions={actions} />}
      {tab === "hours" && <HoursPanel rows={data.hours} saving={saving} user={user} actions={actions} />}
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
function TurnoversPanel({ rows, saving, user, actions }) {
  if (user.role === "house") {
    return <HouseTurnoversPanel rows={rows} saving={saving} user={user} actions={actions} />;
  }

  if (user.role === "bookings") {
    return <BookingTurnoversPanel rows={rows} saving={saving} actions={actions} />;
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
        <BookingsCalendar rows={rows} actions={actions} canEdit />
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
            <button className="primary" disabled={saving || !form.room.trim()} type="submit">
              הוסף סידור
            </button>
          </form>
          <TurnoverList title="פתוחים" rows={open} allRows={rows} actions={actions} user={user} canEdit />
          <TurnoverList title="בוצעו" rows={done.slice(0, 10)} allRows={rows} actions={actions} user={user} canEdit />
        </>
      )}
    </section>
  );
}

function BookingTurnoversPanel({ rows, saving, actions }) {
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
        title={view === "schedule" ? "סידור עבודה" : "חדרים"}
        badge={view === "calendar" ? "יומן חודשי" : view === "today" ? `${todayRows.length} היום` : view === "future" ? `${futureRows.length} עתידיים` : "הזנה"}
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
      </div>

      {view === "calendar" ? (
        <BookingsCalendar rows={rows} actions={actions} canEdit />
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

          <button className="primary" disabled={saving || !form.room} type="submit">
            שמור סידור עבודה
          </button>
        </form>
      ) : (
        <TurnoverList title={view === "today" ? "חדרים להיום" : "חדרים עתידיים"} rows={visibleRows} allRows={rows} actions={actions} readOnly canEdit />
      )}
    </section>
  );
}

function BookingsCalendar({ rows, actions, canEdit = false }) {
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

  return (
    <div className="calendar-panel">
      <div className="calendar-head">
        <button type="button" onClick={() => setMonth(addMonths(month, -1))}>הקודם</button>
        <div>
          <h3>{formatMonthName(month)}</h3>
          <p>{totalEntries} כניסות בחודש</p>
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
                  {row.date} · {row.guests || 0} אורחים
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
                  <button type="button" onClick={() => actions.update(TABLES.turnovers, { ...row, status: "completed", completedAt: nowIso() })}>
                    בוצע
                  </button>
                )}
                {!readOnly && !isDone(row) && (
                  <button className={row.gardenDone ? "success-soft" : ""} type="button" onClick={() => actions.update(TABLES.turnovers, { ...row, gardenDone: true, gardenDoneAt: nowIso() })}>
                    {row.gardenDone ? "גינה ✓" : "גינה"}
                  </button>
                )}
                {!readOnly && (
                  <button className="danger" type="button" onClick={() => actions.remove(TABLES.turnovers, row.id)}>
                    מחק
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
        <button className="primary" type="submit">
          שמור שינוי
        </button>
        <button className="ghost" type="button" onClick={onCancel}>
          בטל
        </button>
      </div>
    </form>
  );
}

function HouseTurnoversPanel({ rows, saving, actions }) {
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
        <BookingsCalendar rows={rows} />
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
                onComplete={() => actions.update(TABLES.turnovers, { ...row, status: "completed", completedAt: nowIso() })}
              />
            ))
          )}
        </div>
      )}
    </section>
  );
}
function HouseRoomCard({ row, saving, onComplete }) {
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

  return (
    <article className={row.isOccupied ? "house-room occupied" : "house-room"}>
      <div className="house-room-top">
        <div>
          <p>{row.date}</p>
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

      <div className="house-actions">
        <button className="primary" disabled={saving} type="button" onClick={onComplete}>
          סיימתי את החדר
        </button>
      </div>
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
    await actions.add(TABLES.maintenance, {
      id: newId(),
      ...form,
      title: form.title.trim(),
      status: "open",
      source: user.role,
      createdByName: user.display || user.username,
      createdAt: nowIso(),
      completedAt: ""
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
              <button type="button" disabled={saving} onClick={() => actions.update(TABLES.turnovers, { ...row, gardenDone: true, gardenDoneAt: nowIso() })}>
                בוצע
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
        <button className="primary" disabled={saving || !form.title.trim()} type="submit">
          הוסף לאחזקה
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
              <button type="button" onClick={() => actions.update(TABLES.maintenance, { ...row, status: "done", completedAt: nowIso() })}>
                בוצע
              </button>
            )}
            <button className="danger" type="button" onClick={() => actions.remove(TABLES.maintenance, row.id)}>
              מחק
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
    await actions.add(TABLES.shopping, {
      id: newId(),
      ...form,
      item: form.item.trim(),
      requestedBy: user.display || user.username,
      requestedById: user.username,
      requestedByRole: user.role,
      status: "requested",
      requestedAt: nowIso(),
      purchasedAt: ""
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
        <button className="primary" disabled={saving || !form.item.trim()} type="submit">
          הוסף לקניות
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
              <button type="button" onClick={() => onPurchase(row)}>
                נרכש
              </button>
            )}
            <button className="danger" type="button" onClick={() => actions.remove(TABLES.shopping, row.id)}>
              מחק
            </button>
          </div>
        </article>
      ))}
    </ListBlock>
  );
}

function HoursPanel({ rows, saving, user, actions }) {
  const [form, setForm] = useState({ date: today(), startTime: "08:00", endTime: "16:00" });
  const visibleRows = user.role === "admin"
    ? rows.filter((row) => isHouseOrMaintenanceHour(row))
    : rows.filter((row) => row.userId === user.username || row.userName === user.display);
  const currentMonth = monthKey(today());
  const monthTotal = visibleRows.filter((row) => monthKey(row.date) === currentMonth).reduce((sum, row) => sum + (Number(row.totalHours) || 0), 0);
  const total = hoursBetween(form.startTime, form.endTime);
  const totalsByPerson = summarizeHoursByPerson(visibleRows.filter((row) => monthKey(row.date) === currentMonth));

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
        <>
          <div className="summary-line">תצוגת אדמין בלבד: שעות של משק בית ואחזקה</div>
          {totalsByPerson.length > 0 && (
            <div className="hours-summary">
              {totalsByPerson.map((row) => (
                <div className="hours-total" key={row.name}>
                  <span>{row.name}</span>
                  <strong>{row.total.toFixed(1)}</strong>
                </div>
              ))}
            </div>
          )}
        </>
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
          <button className="primary" disabled={saving || total <= 0} type="submit">
            שמור שעות
          </button>
        </form>
      )}
      <ListBlock title="רישומי שעות" empty="אין שעות">
        {visibleRows.slice().reverse().slice(0, 20).map((row) => (
          <article className="list-item" key={row.id}>
            <div>
              <strong>{row.userName}</strong>
              <p>
                {row.date} · {row.startTime}-{row.endTime}
              </p>
            </div>
            <div className="actions">
              <span className="pill subtle">{row.totalHours} שעות</span>
              <button className="danger" type="button" onClick={() => actions.remove(TABLES.hours, row.id)}>
                מחק
              </button>
            </div>
          </article>
        ))}
      </ListBlock>
    </section>
  );
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

function summarizeHoursByPerson(rows) {
  const totals = new Map();
  rows.forEach((row) => {
    const name = row.userName || row.userId || "לא ידוע";
    totals.set(name, (totals.get(name) || 0) + (Number(row.totalHours) || 0));
  });
  return Array.from(totals, ([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
}

function NotificationsPanel({ rows, turnovers, user, actions }) {
  const [hiddenReadyRooms, setHiddenReadyRooms] = useState([]);
  const readyRooms = turnovers
    .filter((row) => isDone(row) && !hiddenReadyRooms.includes(row.id))
    .sort((a, b) => String(b.completedAt || b.date || "").localeCompare(String(a.completedAt || a.date || "")));
  const visibleRows = user.role === "admin"
    ? []
    : rows.filter((row) => row.read !== true && row.read !== "TRUE" && (row.for === "all" || row.for === user.role || row.for === user.username));

  return (
    <section className="panel">
      <SectionHead title="התראות" badge={`${user.role === "admin" ? readyRooms.length : visibleRows.length} התראות`} />
      {user.role === "admin" ? (
        <ListBlock title="חדרים מוכנים" empty="אין חדרים שסומנו כמוכנים">
          {readyRooms.map((row) => (
            <article className="list-item" key={row.id}>
              <div>
                <strong>{row.room || "חדר"}</strong>
                <p>
                  {row.date ? `כניסה: ${row.date}` : "סומן כמוכן"}
                  {row.completedAt ? ` · מוכן: ${formatDateTime(row.completedAt)}` : ""}
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
                <button type="button" onClick={() => actions.update(TABLES.notifications, { ...row, read: true })}>
                  נקרא
                </button>
                <button className="danger" type="button" onClick={() => actions.remove(TABLES.notifications, row.id)}>
                  מחק
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
            <button className="pool-main-action" disabled={saving} type="button" onClick={completeTreatment}>
              סיימתי טיפול בבריכה
            </button>
          </div>

          <div className="pool-actions">
            <button className={chlorineSent ? "success-soft" : "danger-soft"} disabled={saving} type="button" onClick={requestChlorine}>
              {chlorineSent ? "נשלח לאלדד" : "בקש כלור"}
            </button>
            <button className="purple-soft" disabled={saving} type="button" onClick={registerUvReplacement}>
              רישום החלפת מנורות UV
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
              <p>{formatDateTime(lastUv.doneAt)}</p>
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
                {row.lastReplaced ? `הוחלף: ${formatDateTime(row.lastReplaced)}` : "לא נרשם תאריך החלפה"}
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
              <strong>{formatDateTime(row.doneAt)}</strong>
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







