<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="theme-color" content="#0A84FF">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="בית ויליאמס">
<meta name="mobile-web-app-capable" content="yes">
<meta name="application-name" content="בית ויליאמס">
<title>בית ויליאמס</title>

<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">
<link rel="icon" type="image/png" sizes="512x512" href="/icon-512.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="apple-touch-icon" sizes="180x180" href="/icon-180.png">
<link rel="apple-touch-icon" sizes="192x192" href="/icon-192.png">
<link rel="apple-touch-icon" sizes="512x512" href="/icon-512.png">
<link rel="manifest" href="/manifest.json">

<script src="https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js" defer></script>
<script>
  window.OneSignalDeferred = window.OneSignalDeferred || [];

  OneSignalDeferred.push(async function(OneSignal) {
    await OneSignal.init({
      appId: "46062f6a-d7a8-4714-8765-bac63a2e3bc5",
      safari_web_id: "web.onesignal.auto.1b5ff574-1f63-4acf-ab26-dadb313db610",

      // הפעמון הצף של OneSignal כבוי לגמרי.
      // במקום זה יש לנו כפתור נקי משלנו במסך הכניסה בלבד.
      notifyButton: {
        enable: false
      }
    });
  });

  window.requestWilliamsPush = async function() {
    return new Promise(function(resolve) {
      window.OneSignalDeferred = window.OneSignalDeferred || [];

      window.OneSignalDeferred.push(async function(OneSignal) {
        try {
          if (!("Notification" in window)) {
            resolve({
              ok: false,
              status: "unsupported"
            });
            return;
          }

          if (Notification.permission === "granted") {
            try {
              if (
                OneSignal.User &&
                OneSignal.User.PushSubscription &&
                OneSignal.User.PushSubscription.optIn
              ) {
                await OneSignal.User.PushSubscription.optIn();
              }
            } catch (e) {
              console.warn("OneSignal optIn warning:", e);
            }

            resolve({
              ok: true,
              status: "granted"
            });
            return;
          }

          await OneSignal.Notifications.requestPermission();

          if (Notification.permission === "granted") {
            try {
              if (
                OneSignal.User &&
                OneSignal.User.PushSubscription &&
                OneSignal.User.PushSubscription.optIn
              ) {
                await OneSignal.User.PushSubscription.optIn();
              }
            } catch (e) {
              console.warn("OneSignal optIn warning:", e);
            }

            resolve({
              ok: true,
              status: "granted"
            });
            return;
          }

          resolve({
            ok: false,
            status: Notification.permission
          });
        } catch (err) {
          console.error("Push permission error:", err);

          resolve({
            ok: false,
            status: "error"
          });
        }
      });
    });
  };
</script>

<style>
  html, body {
    margin: 0;
    padding: 0;
    background: #F5F5F7;
    -webkit-tap-highlight-color: transparent;
    overscroll-behavior: none;
  }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Heebo', 'Assistant', 'Arial Hebrew', sans-serif;
  }

  #root {
    min-height: 100vh;
  }

  #boot {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(180deg,#F5F5F7 0%,#EEF0F3 100%);
    flex-direction: column;
    gap: 16px;
    z-index: 9999;
  }

  #boot img {
    width: 72px;
    height: 72px;
    border-radius: 18px;
    box-shadow: 0 12px 28px rgba(10,132,255,0.3);
    animation: bp 1.5s ease-in-out infinite;
  }

  #boot .label {
    color: #86868B;
    font-size: 15px;
    font-weight: 500;
  }

  @keyframes bp {
    0%,100% {
      opacity: 1;
    }

    50% {
      opacity: 0.55;
    }
  }

  /* מסתיר רק את הפעמון הצף, לא את בקשת ההרשאה */
  .onesignal-bell-container,
  .onesignal-bell-launcher,
  #onesignal-bell-container {
    display: none !important;
    visibility: hidden !important;
    pointer-events: none !important;
  }

  #williamsPushLoginBox {
    position: fixed;
    left: 50%;
    bottom: max(22px, env(safe-area-inset-bottom));
    transform: translateX(-50%);
    z-index: 10000;
    display: none;
    width: calc(100% - 40px);
    max-width: 360px;
    pointer-events: none;
  }

  #williamsPushLoginButton {
    width: 100%;
    border: none;
    border-radius: 18px;
    padding: 14px 18px;
    font-size: 16px;
    font-weight: 800;
    font-family: inherit;
    cursor: pointer;
    color: #FFFFFF;
    background: linear-gradient(135deg, #0A84FF 0%, #0066CC 100%);
    box-shadow: 0 14px 32px rgba(10, 132, 255, 0.32);
    pointer-events: auto;
  }

  #williamsPushLoginButton.is-active {
    color: #0B5F2A;
    background: linear-gradient(135deg, #E8F8EF 0%, #D7F3E2 100%);
    box-shadow: 0 10px 24px rgba(52, 199, 89, 0.20);
    cursor: default;
  }

  #williamsPushLoginButton.is-blocked {
    color: #7A1D1D;
    background: linear-gradient(135deg, #FFECEC 0%, #FFDADA 100%);
    box-shadow: 0 10px 24px rgba(255, 59, 48, 0.16);
    cursor: default;
  }
</style>
</head>

<body>
<div id="root"></div>

<div id="boot">
  <img src="/icon-192.png" alt="בית ויליאמס">
  <div class="label">טוען...</div>
</div>

<div id="williamsPushLoginBox">
  <button id="williamsPushLoginButton" type="button">
    🔔 הפעל התראות
  </button>
</div>

<script>
  // Hard-coded API URL pointing to your Apps Script Web App
  window.WILLIAMS_API_URL = "https://script.google.com/macros/s/AKfycbxy-EfXnjrmv74gVzYzXOi0o75ypc9pCkmFwlSPsiXvVzWM6KLdFgi6O-spgP8cEn7L/exec";
</script>

<script src="/bundle.js"></script>

<script>
(function () {
  function mount() {
    if (!window.WilliamsApp || !window.WilliamsApp.React || !window.WilliamsApp.ReactDOM) {
      setTimeout(mount, 50);
      return;
    }

    var boot = document.getElementById('boot');
    if (boot && boot.parentNode) {
      boot.parentNode.removeChild(boot);
    }

    var R = window.WilliamsApp.React;
    var RD = window.WilliamsApp.ReactDOM;
    var App = window.WilliamsApp.App;

    var root = RD.createRoot(document.getElementById('root'));
    root.render(R.createElement(App));
  }

  mount();
})();
</script>

<script>
(function () {
  var box = null;
  var button = null;
  var lastVisibleState = null;

  function getPermissionStatus() {
    if (!("Notification" in window)) return "unsupported";
    return Notification.permission;
  }

  function isLoginScreen() {
    var passwordInput = document.querySelector('input[type="password"]');

    if (!passwordInput) {
      return false;
    }

    var bodyText = document.body ? document.body.innerText || "" : "";

    var hasLoginText =
      bodyText.indexOf("כניסה") !== -1 ||
      bodyText.indexOf("התחברות") !== -1 ||
      bodyText.indexOf("סיסמה") !== -1 ||
      bodyText.indexOf("שם משתמש") !== -1;

    var hasLoggedInText =
      bodyText.indexOf("התנתק") !== -1 ||
      bodyText.indexOf("תחזוקה") !== -1 ||
      bodyText.indexOf("משימות") !== -1 ||
      bodyText.indexOf("ניקיון") !== -1 ||
      bodyText.indexOf("בריכה") !== -1;

    return hasLoginText && !hasLoggedInText;
  }

  function updateButtonText() {
    if (!button) return;

    button.classList.remove("is-active");
    button.classList.remove("is-blocked");
    button.disabled = false;

    var status = getPermissionStatus();

    if (status === "granted") {
      button.textContent = "התראות פעילות ✅";
      button.classList.add("is-active");
      button.disabled = true;
      return;
    }

    if (status === "denied") {
      button.textContent = "התראות חסומות בדפדפן";
      button.classList.add("is-blocked");
      button.disabled = true;
      return;
    }

    if (status === "unsupported") {
      button.textContent = "הדפדפן לא תומך בהתראות";
      button.classList.add("is-blocked");
      button.disabled = true;
      return;
    }

    button.textContent = "🔔 הפעל התראות";
  }

  function syncVisibility() {
    if (!box || !button) return;

    var shouldShow = isLoginScreen();

    if (lastVisibleState !== shouldShow) {
      box.style.display = shouldShow ? "block" : "none";
      lastVisibleState = shouldShow;
    }

    if (shouldShow) {
      updateButtonText();
    }
  }

  function initLoginPushButton() {
    box = document.getElementById("williamsPushLoginBox");
    button = document.getElementById("williamsPushLoginButton");

    if (!box || !button) return;

    button.addEventListener("click", async function () {
      var currentStatus = getPermissionStatus();

      if (currentStatus === "granted" || currentStatus === "denied") {
        updateButtonText();
        return;
      }

      button.disabled = true;
      button.textContent = "מבקש הרשאה...";

      var result = await window.requestWilliamsPush();

      if (result && result.ok) {
        button.textContent = "התראות פעילות ✅";
        button.classList.add("is-active");
        button.disabled = true;
      } else {
        button.disabled = false;
        updateButtonText();
      }
    });

    syncVisibility();

    var observer = new MutationObserver(function () {
      syncVisibility();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    setInterval(syncVisibility, 1500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initLoginPushButton);
  } else {
    initLoginPushButton();
  }
})();
</script>
</body>
</html>
