# ROOM_STATUS_VALIDATION_AUDIT

מצב עבודה: קריאה בלבד.

לא בוצע תיקון קוד, לא בוצע שינוי לוגיקה, לא בוצע שינוי UI, לא בוצע שינוי DB, לא הותקנו ספריות ולא נוצרו migrations.

הקובץ הזה הוא דוח בלבד.

## 1. מפת זרימת נתונים DB -> עיבוד -> תצוגה

מקור האמת בפועל הוא Google Sheets דרך Apps Script.

הזרימה המרכזית:

1. Google Sheets
   - הטאב המרכזי לחדרים הוא `turnovers`.
   - שדות חשובים:
     `id`, `room`, `date`, `status`, `gardenDone`, `reportSource`, `eventType`, `bookingId`, `arrivalDate`, `departureDate`, `reportMonth`.

2. Apps Script
   - `code.js`
   - `SHEETS.turnovers` מגדיר את מבנה העמודות.
   - `readSheet()` קורא את השורות מהשיטס.
   - `syncReportTurnovers()` כותב דוחות חדשים / מעדכן שורות / מוחק כפילויות דוח.
   - `validateSchema()` בודק אם הטאבים והעמודות קיימים.

3. Frontend API
   - `src/api.js`
   - `readAll()` קורא את כל המידע מה־Apps Script.
   - `readCachedData()` מעלה קודם מידע מקאש מקומי.
   - `saveCachedData()` שומר snapshot מקומי כדי שהאפליקציה תעלה מהר.
   - כתיבות מתבצעות דרך `addRecord`, `updateRecord`, `deleteRecord`, `syncReportTurnovers`.

4. State באפליקציה
   - `src/App.jsx`
   - `data.turnovers` הוא מאגר החדרים בפועל בצד לקוח.
   - `loadData()` מרענן מהשרת.
   - יש רענון רקע כל 5 דקות בערך, עם מינימום 90 שניות בין רענונים.
   - בזמן כתיבה ברקע, רענון רקע לא רץ.

5. עיבוד תצוגה
   - אין שדה יחיד בשם `display_status`.
   - סטטוס התצוגה מחושב בכמה פונקציות:
     - `reportEventType()`
     - `isArrivalEvent()`
     - `isPureArrivalEvent()`
     - `isDepartureEvent()`
     - `isSwapEvent()`
     - `reportRangeRows()`
     - `vacantRoomsForDate()`
     - `occupiedQuietRoomsForDate()`
     - `mergeScheduleListRows()`
     - `filterDepartureOnlyDisplayRows()`

6. תצוגות
   - `BookingsCalendar()` מציג יומן.
   - `BookingTurnoversPanel()` מציג ליִפעת היום / עתידי / דוחות / סידור עבודה.
   - `HouseTurnoversPanel()` מציג למשק בית היום / עתידי / יומן.
   - `MaintenancePanel()` מציג לעופר כניסות היום לגינה ומשימות.
   - Dashboard משתמש בחישוב דומה אבל לא זהה.

## 2. מפת חישוב סטטוס חדר

החישוב היום בנוי כך:

1. `reportEventType(row)`
   - אם יש `eventType`, הוא קובע.
   - אם ה־id מתחיל ב־`report-departure-`, זה נחשב `departure`.
   - אם ה־id מתחיל ב־`report-block-`, זה נחשב `block`.
   - אחרת, אם `isOccupied` אמת, זה נחשב `swap`.
   - אחרת, ברירת המחדל היא `arrival`.

2. כניסה
   - `isArrivalEvent()` מחזיר אמת עבור `arrival` וגם עבור `swap`.
   - `isPureArrivalEvent()` מחזיר אמת רק עבור `arrival`.

3. החלפה
   - `isSwapEvent()` מחזיר אמת רק עבור `swap`.
   - בעת ניתוח דוח אופטימה, החלפה מזוהה אם יש יציאה לאותו חדר באותו תאריך של הכניסה.

4. עזיבה
   - `isDepartureEvent()` מחזיר אמת עבור `departure`.

5. שהייה שקטה
   - `occupiedQuietRoomsForDate()` בודק טווחי `arrivalDate` עד `departureDate`.
   - החדר נחשב מאוכלס אם:
     `arrivalDate <= date && date < departureDate`
   - זה אומר שיום העזיבה עצמו לא נחשב יום שהייה, וזה נכון עסקית.

6. חדר ריק
   - `vacantRoomsForDate()` בודק:
     - חדרים עם checkout באותו יום.
     - חדרים בין הזמנות.
     - חדרים שסומנו כבוצעו ואין להם כניסה עוקבת.
   - הוא מוציא מהתוצאה חדרים שנחשבים busy / occupied / blocked.

7. אחזקה / חסימה
   - דוח אחזקה מייצר שורות עם:
     `eventType: "block"`
   - `isMaintenanceReportTurnover()` מזהה שורות שמתחילות ב־`report-maintenance-`.
   - כרגע כל דוח אחזקה מתורגם לחסימה, לא לכניסת בעלים / משפחה / חברים.

## 3. פערים מול החוק העסקי

### חוק 1
אם יש כניסה לחדר ביום מסוים והחדר לא היה מאוכלס לפני כן => כניסה רגילה.

מצב בפועל:
המערכת סופרת כניסה רגילה לפי `eventType: arrival`.
אבל אם שורה ישנה חסרה `eventType`, ברירת המחדל של `reportEventType()` היא `arrival`.

פער:
שורה ישנה או חסרה יכולה להפוך לכניסה רגילה גם אם היא לא באמת כניסה.

### חוק 2
אם יש יציאה וכניסה לאותו חדר באותו יום => החלפה.

מצב בפועל:
בדוח אופטימה ההחלפה מזוהה בזמן import לפי התאמה של חדר + תאריך כניסה מול תאריך יציאה.

פער:
אם זוג השורות לא מגיע מאותו דוח, או אם יש עריכה ידנית בלי `bookingId` / `arrivalDate` / `departureDate`, הזיהוי יכול להתפרק.

### חוק 3
אם אין כניסה/יציאה באותו יום אבל יש אורח בין check_in ל-check_out => מאוכלס.

מצב בפועל:
`occupiedQuietRoomsForDate()` עושה את זה נכון עקרונית.

פערים אפשריים:
אם `arrivalDate` או `departureDate` חסרים, החדר לא יופיע כמאוכלס.
אם טווח השהייה נמצא רק בשורה אחת שנמחקה/נדרסה, החישוב ייעלם.
אם השורה היא דוח ישן בלי שדות הטווח החדשים, תלויים ב־`reportRangeRows()` שינסה לזווג arrival/departure לפי `bookingId`.

### חוק 4
אם יש רק יציאה באותו יום => יציאה + משימת ניקיון + משימת גינה/אחזקה לפי הלוגיקה.

מצב בפועל:
היומן מסתיר עזיבות מתוך הפירוט בעזרת `selectedDayDisplayRows`.
הרשימה משתמשת ב־`filterDepartureOnlyDisplayRows()`, שמסירה שורות עזיבה בלבד כדי לא להציג אותן כמשימה רגילה.
במקביל `vacantRoomsForDate()` אמור לייצר שורת `vacant`.

פער:
אם `vacantRoomsForDate()` לא מזהה את החדר כריק, העזיבה מוסתרת וגם הריק לא מוצג.
זה החשוד המרכזי למקרים שבהם חדר עם יציאה בלבד נראה כאילו לא קיים.

### חוק 5
אם חדר מסומן באחזקה אבל לפי הערות/דוח הוא בעצם כניסת בעלים/משפחה/חברים => צריך להיחשב בסדר היום כמו כניסה/שהייה, אבל להיות מסומן בצבע אחר.

מצב בפועל:
דוח אחזקה הופך ל־`eventType: block`.
אין כרגע שכבת סיווג טקסטואלית שמבדילה בין:
אחזקה אמיתית,
בעלים,
משפחה,
חברים,
שהיית צוות.

פער:
כל מה שמגיע מדוח אחזקה נספר כחסימה/אחזקה, לא ככניסה/שהייה בצבע אחר.

### חוק 6
אסור שהתצוגה תציג פנוי אם יש שהייה פעילה.

מצב בפועל:
`vacantRoomsForDate()` מוציא חדרים שנמצאים ב־`occupiedRooms`.

פער אפשרי:
אם טווח השהייה חסר או לא נבנה, החדר יכול להיחשב ריק למרות שיש שהייה אמיתית.

### חוק 7
אסור שהחלפה תוצג ככניסה רגילה.

מצב בפועל:
`isArrivalEvent()` מתייחס גם ל־`swap` ככניסה.
`isPureArrivalEvent()` מבדיל בין כניסה רגילה להחלפה.

פער:
לא כל המסכים משתמשים תמיד באותה פונקציה.
אם מסך משתמש ב־`isArrivalEvent()` במקום `isPureArrivalEvent()`, החלפה יכולה להיכנס לספירת כניסות.

## 4. חשודים מרכזיים

1. אין מקור יחיד ל־display status
   - אין פונקציה אחת שמחזירה `arrival / swap / departure / occupied / vacant / block`.
   - כל תצוגה עושה חלק מהחישוב בעצמה.
   - זה מגדיל סיכון לפער בין יומן, רשימה, משק בית, אחזקה ודשבורד.

2. `reportEventType()` משתמש בברירת מחדל מסוכנת
   - כל שורה בלי `eventType` וללא id של departure/block הופכת ל־`arrival`.
   - זה יכול להסביר חדר שמופיע ככניסה רגילה למרות שהוא בפועל עזיבה/שהייה/נתון ישן.

3. `isOccupied` משמש גם כ"החלפה"
   - השם `isOccupied` נשמע כמו "מאוכלס", אבל בפועל משמש גם כסימון החלפה.
   - זה עלול לגרום לבלבול בין שהייה פעילה לבין החלפה.

4. `filterDepartureOnlyDisplayRows()` מסתיר עזיבות
   - ההסתרה נכונה לפי החלטות UI קודמות.
   - אבל אם יצירת `vacant` נכשלת, אין גיבוי להצגה.

5. `vacantRoomsForDate()` מורכב מדי
   - הוא מחבר כמה מקורות:
     checkout,
     between bookings,
     completed stay,
     busy rooms,
     occupied rooms,
     blocked rooms.
   - כל חוסר בשדה `arrivalDate/departureDate/bookingId/eventType/status` יכול לשנות את התוצאה.

6. `reportRangeRows()` עלול ליצור כפילות מושגית
   - אם כבר יש שורות עם `arrivalDate/departureDate`, הן נכנסות.
   - בנוסף, הוא יכול לבנות שורות מזווגות מתוך arrival/departure.
   - אם אין דה־דופליקציה מספקת ברמת טווח, אותו booking יכול להשפיע פעמיים על חישובים.

7. סינון לפי חודש ב־`BookingsCalendar()`
   - `monthRows` נבנה לפי `row.date` של אותו חודש.
   - שהייה שהתחילה בחודש קודם וממשיכה לחודש הנוכחי לא תופיע כ־row רגיל של החודש.
   - `occupiedQuietRoomsForDate()` מקבל את כל `rows`, ולכן יש ניסיון לכסות את זה, אבל לא כל הסיכומים משתמשים באותו בסיס.

8. דוח אחזקה משולב כ־block בלבד
   - אין זיהוי של "בעלים / משפחה / חברים" מתוך הערות.
   - לכן הוא לא עומד במלוא חוק 5.

9. קאש מקומי ורענון רקע
   - האפליקציה עולה קודם מקאש.
   - אם write נכשל או deploy ישן רץ, אפשר לראות מצב שלא תואם לשיטס.
   - `loadData()` לא רץ בזמן `pendingWritesRef.current > 0`.

10. כתיבה אופטימית
   - `actions.update/add/remove/syncReports` מעדכנים קודם את ה־state והקאש ורק אחר כך כותבים לשיטס ברקע.
   - אם הכתיבה נכשלת, נעשה `loadData()`, אבל עד אז המשתמש יכול לראות מצב זמני לא אמיתי.

## 5. נקודות לוג מומלצות

לא ליישם עכשיו. אלה נקודות מומלצות אם יוחלט להוסיף Audit בעתיד.

1. אחרי `readAll()`
   - מספר שורות turnovers.
   - מספר שורות report/manual.
   - מספר שורות בלי `eventType`.
   - מספר שורות בלי `arrivalDate/departureDate`.

2. בתוך `reportEventType(row)`
   - רק במצב debug:
     id, room, date, eventType raw, isOccupied, resolvedType.

3. בתוך `reportRangeRows(rows)`
   - כמה rangeRows קיימות.
   - כמה pairedRows נוצרו.
   - bookingIds כפולים.
   - bookingIds בלי arrival/departure מלאים.

4. בתוך `vacantRoomsForDate(date, rows)`
   - date.
   - roomsWithCheckout.
   - occupiedRooms.
   - blockedRooms.
   - sameDayBusyRooms.
   - finalVacantRooms.

5. בתוך `occupiedQuietRoomsForDate(date, rows)`
   - date.
   - candidate ranges.
   - rooms שנפסלו בגלל sameDayActive.
   - finalOccupiedQuietRooms.

6. בתוך `mergeScheduleListRows(rows)`
   - key room|date.
   - eventTypes לכל key.
   - איזה row נבחר כ־editRow.

7. ב־`TurnoverEditForm`
   - row.id.
   - bookingId.
   - old date / arrivalDate / departureDate.
   - new date / arrivalDate / departureDate.
   - related rows count.

8. ב־`syncReportTurnovers()` בצד Apps Script
   - newRows.
   - changedRows.
   - removedRows.
   - manualOverrides.
   - duplicateCurrentRows.

## 6. הצעת Audit Script עתידי ללא שינוי נתונים

מטרת הסקריפט:
לקרוא את `turnovers` בלבד, לחשב סטטוס צפוי לכל חדר בכל תאריך, ולהוציא דוח סטטי בלי לכתוב לשיטס.

קלט:
- מערך rows מתוך `data.turnovers`.
- טווח תאריכים, למשל חודש נוכחי.
- רשימת חדרים קבועה:
  קרון, יורט, ראג'ה, עדי, שיטה.

פלט מוצע:

```json
{
  "date": "2026-05-23",
  "room": "שיטה",
  "rawRows": [
    {
      "id": "...",
      "eventType": "departure",
      "date": "2026-05-23",
      "arrivalDate": "2026-05-19",
      "departureDate": "2026-05-23"
    }
  ],
  "expectedStatus": "vacant_after_departure",
  "displayedStatus": "arrival",
  "risk": "mismatch",
  "reason": "row without eventType fell back to arrival"
}
```

בדיקות שהסקריפט צריך לעשות:

1. האם יש יותר משורה אחת לאותו `id`.
2. האם יש יותר מ־booking אחד לאותו חדר באותו יום עם אותו סוג אירוע.
3. האם יש שורות בלי `eventType`.
4. האם יש שורות בלי `bookingId`.
5. האם יש שורות report בלי `arrivalDate/departureDate`.
6. האם check_out מופיע כיום שהייה.
7. האם יש יציאה בלבד שלא מייצרת vacant.
8. האם יש swap שמוצג גם כ־arrival.
9. האם יש block/maintenance עם הערות שמרמזות בעלים/משפחה/חברים.
10. האם תצוגת יומן ורשימת היום מקבלות תוצאה שונה לאותו room/date.

## 7. 10 בדיקות ידניות מומלצות

1. 23/05/2026, חדר שיטה
   - לבדוק בשיטס את כל השורות של שיטה.
   - לוודא אם יש רק departure או גם arrival.
   - לוודא `eventType`, `bookingId`, `arrivalDate`, `departureDate`.

2. 23/05/2026, חדר ראג'ה
   - לבדוק אם row מסומן `swap` אבל בפועל יש רק עזיבה.
   - לבדוק אם יש כניסה עוקבת באותו תאריך.

3. 20/05/2026
   - לבדוק חדרים שאמורים להיות ריקים אחרי יציאה.
   - לוודא שהחדרים מופיעים ב־`vacantRoomsForDate`.

4. יום עם שהייה שקטה
   - לבחור חדר שנכנס ב־18/05 ויוצא ב־24/05.
   - לבדוק יום 20/05.
   - הציפייה: מאוכלס, לא כניסה.

5. יום עזיבה
   - אותו חדר ביום 24/05.
   - הציפייה: לא מאוכלס, כן ריק/משימת ניקיון.

6. יום החלפה אמיתי
   - חדר שיש לו departure ו־arrival באותו יום.
   - הציפייה: החלפה, לא כניסה רגילה.

7. דוח אחזקה
   - לבחור שורת אחזקה עם הערה של בעלים/משפחה/חברים.
   - הציפייה העסקית: שהייה/כניסה בצבע אחר.
   - המצב הנוכחי הצפוי: block.

8. עריכה ידנית
   - לערוך תאריך כניסה ותאריך עזיבה להזמנה עם bookingId.
   - לבדוק שגם arrival row וגם departure row עודכנו.

9. רשימה מול יומן
   - עבור אותו room/date להשוות:
     יומן,
     היום,
     עתידי,
     משק בית,
     אחזקה.

10. קאש
   - לפתוח אחרי ניקוי cache / hard refresh.
   - להשוות מול פתיחה רגילה.
   - אם יש פער, הקאש או deploy הם חשוד.

## 8. איזה תיקון הייתי בודק ראשון, בלי ליישם

התיקון הראשון לבדיקה בלבד:

לבנות פונקציה אחת מרכזית שמחזירה סטטוס מחושב לחדר/תאריך:

```js
getRoomDayStatus(room, date, rows)
```

היא תחזיר אובייקט אחד:

```js
{
  room,
  date,
  status: "arrival" | "swap" | "departure" | "vacant" | "occupied" | "block" | "owner_stay",
  sourceRows: [],
  reason: "",
  warnings: []
}
```

כל התצוגות יקראו את אותה פונקציה.

למה זה הראשון:
- כרגע הבעיה נראית כמו פיזור חישוב בין כמה מסכים.
- יומן, רשימה, משק בית ואחזקה לא צריכים לחשב סטטוס בעצמם.
- ברגע שיש מקור חישוב אחד, אפשר לבדוק אותו מול 10 תרחישים ידניים בלי לשבור UI.

לא הייתי מתחיל מעיצוב, לא מקאש, ולא מכתיבה לשיטס.
הייתי מתחיל מהפרדת "אמת עסקית" מתצוגה.

## 9. סיכום קצר

הבעיה המרכזית אינה רק "שורה לא נכונה".

הבעיה היא שיש כמה שכבות שמנסות להסיק מצב חדר:

- שורות דוח.
- שורות ידניות.
- טווחי שהייה.
- שורות עזיבה.
- שורות אחזקה.
- שורות שנוצרו לתצוגה בלבד כמו `vacant`.
- קאש מקומי.
- סינון לפי מסך.

החשודים הכי חזקים:

1. שורות בלי `eventType` שנופלות ל־`arrival`.
2. עזיבות שמוסתרות לפני שנוצר להן `vacant`.
3. טווחי שהייה חסרים או לא מזווגים.
4. ערבוב בין `isOccupied` כהחלפה לבין "מאוכלס".
5. חוסר פונקציה אחת מרכזית לסטטוס חדר.

לפי הבדיקה, `check_out` עצמו מחושב נכון כיום שאינו יום שהייה כאשר קיימים `arrivalDate` ו־`departureDate`.
הסיכון הוא לא עצם הנוסחה, אלא מצב שבו השדות חסרים, לא מסונכרנים, או נדרסים.
