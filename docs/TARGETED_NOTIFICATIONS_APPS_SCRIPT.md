# התראות לפי שיוך - Apps Script

האפליקציה שומרת בטאב `notifications` יעד בעמודה `for`:

- `house` - משק בית
- `maint` - תחזוקה
- `bookings` - הזמנות
- שם משתמש, למשל `offer` או `jude` - התראה אישית

כדי שה-Push לא יישלח לכולם, אסור להשתמש ב-`included_segments: ["Total Subscriptions"]`.
במקומו יש לשלוח לפי `external_id`.

המשתמש נרשם באפליקציה ל-OneSignal עם:

```js
OneSignal.login(username)
```

לכן בסקריפט צריך למפות יעד לשמות משתמשים ואז לשלוח כך:

```js
function getNotificationTargets_(target) {
  const ss = getSS();
  const usersSheet = ss.getSheetByName("users");
  if (!usersSheet) return [];

  const values = usersSheet.getDataRange().getValues();
  const headers = values.shift();
  const usernameIndex = headers.indexOf("username");
  const roleIndex = headers.indexOf("role");

  if (usernameIndex === -1 || roleIndex === -1) return [];

  return values
    .filter(row => String(row[usernameIndex] || "").trim())
    .filter(row => {
      const username = String(row[usernameIndex] || "").trim();
      const role = String(row[roleIndex] || "").trim();
      return target === username || target === role;
    })
    .map(row => String(row[usernameIndex] || "").trim());
}

function sendOneSignalPushToTarget_(target, title, message) {
  const externalIds = getNotificationTargets_(target);
  if (!externalIds.length) {
    Logger.log("Push skipped: no users for target " + target);
    return { ok: false, skipped: true, body: "no targets" };
  }

  const props = PropertiesService.getScriptProperties();
  const appId = props.getProperty("ONESIGNAL_APP_ID");
  const apiKey = props.getProperty("ONESIGNAL_REST_API_KEY");

  const payload = {
    app_id: appId,
    target_channel: "push",
    include_aliases: {
      external_id: externalIds
    },
    headings: { en: String(title || "בית ויליאמס") },
    contents: { en: String(message || "") },
    url: "https://williams-house.onrender.com"
  };

  const response = UrlFetchApp.fetch("https://api.onesignal.com/notifications", {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Key " + apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  return {
    ok: response.getResponseCode() >= 200 && response.getResponseCode() < 300,
    code: response.getResponseCode(),
    body: response.getContentText()
  };
}
```

בתוך `checkNotificationsAndSendPush`, במקום:

```js
const result = sendOneSignalPush(title, message);
```

שים:

```js
const target = String(rows[i][1] || "").trim();
const result = sendOneSignalPushToTarget_(target, title, message);
```

