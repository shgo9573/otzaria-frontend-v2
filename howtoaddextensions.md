# איך לחבר תוספים (Plugins) למיים חיים

מסמך בדיקה. **עדיין לא מימשתי כלום מזה** — זו תוכנית, אחרי בדיקה של איך אוצריא עושה את זה בפועל.

---

## 1. איך זה עובד באוצריא (מה שמצאתי)

אוצריא היא אפליקציית Flutter, ומערכת התוספים שלה כבר קיימת ועובדת. הממצאים:

**מקורות שבדקתי**
- התיעוד הרשמי: `https://otzaria.org/docs/plugins`
- תוסף אמיתי: [otzaria-marker-plugin](https://github.com/mmichaelush/otzaria-marker-plugin)
- תוסף נוסף: [otzaria-zim-plugin](https://github.com/zevisvei/otzaria-zim-plugin)
- באג פתוח שמסגיר את המימוש הפנימי: [Issue #2258](https://github.com/Otzaria/otzaria/issues/2258) — מזכיר את `plugin_system_bloc.dart`

**מה שעולה מזה**

| נושא | איך זה בנוי |
|---|---|
| פורמט | קובץ `.otzplugin` (ארכיון), משויך לתוכנה ב-Windows/Linux |
| תוכן התוסף | **HTML + CSS + JS רגילים** — `index.html` כנקודת כניסה |
| ריצה | בתוך WebView מבודד בתוך האפליקציה |
| הצהרה | `manifest.json` עם הרשאות ו-`contributes` |
| רקע | `background.html` — דף בלי UI שרץ ברקע |
| אבטחה | אין גישה לקבצים בלי בחירה מפורשת; רשת מוגבלת ל-allowlist במניפסט |
| התקנה | חנות רשמית, לחיצה כפולה על הקובץ, או "התקן תוסף חדש" מפאנל התוספים |

**החדשה הטובה:** התוספים כתובים ב-HTML/JS, לא ב-Dart. כלומר הם **ניתנים להרצה בדפדפן** עקרונית, בלי לכתוב אותם מחדש.

### `manifest.json` אמיתי (מתוך תוסף המרקר)

```json
{
  "schemaVersion": 1,
  "id": "com.otzaria-marker",
  "name": "מרקר",
  "version": "0.9.6",
  "entrypoint": "index.html",
  "minAppVersion": "0.9.97",
  "sdkVersion": "1.x",
  "permissions": [
    "reader.context_menu", "reader.highlight", "reader.open", "reader.toolbar",
    "navigation.write", "settings.read", "app.shortcuts", "app.open_url",
    "fs.user_files.read", "fs.user_files.write",
    "events.subscribe:reader.selection_changed",
    "events.subscribe:reader.current_ref_changed"
  ],
  "network": { "enabled": false, "allowlist": [] },
  "contributes": {
    "toolTab": { "title": "מרקר", "order": 300, "defaultPinned": true },
    "background": { "entrypoint": "background.html" },
    "startup": {
      "contextMenuItems": [ /* פריטי תפריט ימני */ ],
      "toolbarItems":     [ /* כפתורים בסרגל הקורא */ ],
      "shortcuts":        [ /* קיצורי מקלדת */ ]
    }
  }
}
```

---

## 2. מה צריך לבנות אצלנו

כדי להריץ את אותם תוספים באתר, צריך שלושה דברים:

### א. ארגז חול (sandbox)

כל תוסף רץ ב-`<iframe sandbox>` נפרד:

```html
<iframe
  src="blob:...index.html"
  sandbox="allow-scripts"
  referrerpolicy="no-referrer">
</iframe>
```

- **בלי** `allow-same-origin` — כך התוסף לא יכול לגעת ב-`localStorage`, בעוגיות או ב-DOM שלנו.
- התקשורת היחידה: `postMessage`.
- `Content-Security-Policy` על ה-iframe חוסם רשת שלא ב-allowlist.

### ב. גשר SDK (`postMessage`)

קובץ `src/plugins/bridge.ts` — מקבל הודעות, בודק הרשאה, מבצע, מחזיר תשובה:

```ts
// בקשה מהתוסף
{ id: "req-1", method: "reader.getCurrentRef", params: {} }
// תשובה מאיתנו
{ id: "req-1", ok: true, result: { bookId: 1, line: 42, heRef: "בראשית א׳:א׳" } }
// או
{ id: "req-1", ok: false, error: "PERMISSION_DENIED: reader.read" }
```

**מיפוי ההרשאות למה שכבר קיים אצלנו:**

| הרשאה | מה היא מקבלת | קיים? |
|---|---|---|
| `reader.read` | `lines`, `heRef`, מיקום נוכחי | ✅ `BookViewer` |
| `reader.open` | פתיחת ספר בשורה | ✅ `openBook()` |
| `reader.highlight` | הדגשת טווח מילים | ✅ `highlightWords()` |
| `reader.toolbar` | כפתור בסרגל הקורא | ✅ צריך רק נקודת הרחבה |
| `reader.context_menu` | פריט בתפריט הבחירה | ✅ יש כבר תפריט בחירה |
| `navigation.write` | מעבר מסך / פתיחת לשונית | ✅ `setScreen`, `openBookInNewTab` |
| `settings.read` | ערכת נושא, גופן, גודל | ✅ `settings` |
| `plugin.storage.*` | אחסון פרטי לתוסף | ⚠️ צריך `/api/user/plugin-data` |
| `network.access` | fetch לכתובות מה-allowlist | ⚠️ צריך proxy בשרת (CORS) |
| `fs.user_files.*` | קריאה/כתיבה של קבצים | ⚠️ File System Access API — Chrome בלבד |
| `app.background_keep_alive` | מנוע רקע | ⚠️ Web Worker / iframe מוסתר |

### ג. פאנל ניהול

מסך בתוך "כלים": התקנה מקובץ `.otzplugin`, מתג לכל הרשאה, השבתה, הצמדה לסרגל, מחיקה.

---

## 3. מה יעבוד, מה לא

| תוסף | יעבוד בדפדפן? | למה |
|---|---|---|
| **מרקר** (הדגשות) | ✅ כן | הכול UI + אחסון |
| **קורא ZIM** | ⚠️ חלקית | libzim ב-WASM עובד; בחירת קובץ דרך File Picker |
| **בר אילן** | ❌ לא | דורש `.exe` מקומי שמדבר על `127.0.0.1` |
| תוספים עם `fs.user_files` | ⚠️ Chrome בלבד | Firefox/Safari לא תומכים ב-File System Access |

**המגבלה המרכזית:** דפדפן לא יכול להריץ תוכנות מקומיות. כל תוסף שמדבר עם עוד תוכנה במחשב לא יעבוד, נקודה.

---

## 4. תוכנית מימוש מדורגת

**שלב 1 — תשתית (2–3 ימים)**
1. `src/plugins/types.ts` — טיפוסי מניפסט והרשאות
2. `src/plugins/sandbox.tsx` — רכיב iframe + `postMessage`
3. `src/plugins/bridge.ts` — ראוטר שבודק הרשאות
4. פאנל ניהול בסיסי ב"כלים"

**שלב 2 — API של הקורא (2 ימים)**
5. `reader.getCurrentRef`, `reader.getLines`, `reader.open`
6. `reader.highlight` — צינור הדגשות שהתוסף רושם
7. אירועים: `reader.current_ref_changed`, `reader.selection_changed`

**שלב 3 — הרחבות UI (2 ימים)**
8. `contributes.toolTab` → לשונית חדשה ב"כלים"
9. `contributes.toolbarItems` → כפתור בסרגל הקורא
10. `contributes.contextMenuItems` → תפריט הבחירה הקיים
11. `app.shortcuts` → קיצורי מקלדת

**שלב 4 — אחסון ורשת (2 ימים)**
12. `plugin.storage` מול הגדרות המשתמש או endpoint ייעודי
13. `network.access` דרך proxy עם allowlist

**סה"כ: כשבוע וחצי עבודה.**

---

## 5. מה צריך ממך (שרת)

```
POST /api/plugins/install      { manifest, files }  → שמירה לפי משתמש
GET  /api/plugins                                   → רשימת התוספים שלי
DELETE /api/plugins/:id
GET  /api/plugins/:id/file/*                        → הגשת קובצי התוסף
GET/POST /api/user/plugin-data/:pluginId            → אחסון פרטי
POST /api/plugins/proxy       { url, pluginId }     → fetch מול allowlist
```

**הערת אבטחה חשובה:** `/api/plugins/proxy` חייב לאמת את הכתובת מול ה-allowlist שבמניפסט **בצד השרת**. אחרת כל תוסף יוכל להשתמש בשרת שלך כ-open proxy.

---

## 6. ההמלצה שלי

אל תתחיל מזה עכשיו. הסיבות:

1. **אין עדיין אימות אמיתי** — בלי `/api/auth/*` תוסף זדוני יכול לגשת לנתוני משתמשים אחרים.
2. **יש באגים פתוחים יותר דחופים** — צורת הדף חסומה, החיפוש לא מחזיר `offset`.
3. **ה-SDK של אוצריא לא מתועד רשמית** — אין מפרט `sdkVersion: "1.x"` פומבי. אצטרך לעשות reverse engineering מקוד התוספים, וכל שינוי אצלם ישבור אצלנו.

**אם בכל זאת רוצים להתחיל:** הכי הגיוני לממש רק את תוסף המרקר כפיצ'ר מובנה (הדגשות בצבעים), ולא לבנות מערכת תוספים שלמה. זה יום עבודה במקום שבוע וחצי, ונותן 90% מהערך.

**אם המטרה תאימות מלאה:** כדאי לפנות ל-[@mmichaelush](https://github.com/mmichaelush) או לפתוח Issue ב-Otzaria ולבקש את מפרט ה-SDK. בלי זה אני מנחש.

---

## מקורות

- https://otzaria.org/docs/plugins
- https://github.com/mmichaelush/otzaria-marker-plugin
- https://github.com/mmichaelush/otzaria-responsa-plugin
- https://github.com/zevisvei/otzaria-zim-plugin
- https://github.com/Otzaria/otzaria/issues/2258
