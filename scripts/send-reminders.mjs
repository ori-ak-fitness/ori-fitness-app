/* ===================================================================
   send-reminders.mjs — שולח את התראות הדחיפה בפועל.

   רץ אך ורק בתוך GitHub Action (ראה
   .github/workflows/push-reminders.yml), לא באפליקציה ולא במחשב של
   אורי. זה החלק היחיד בפרויקט שדורש Node ו-npm — בכוונה מחוץ לאפליקציה
   עצמה, כדי לא לשבור את הכלל "בלי build step" שלה.

   הלוגיקה כאן במתכוון פשוטה יותר משל reminders.js (הגרסה שבתוך
   האפליקציה, שמופיעה כשפותחים אותה) — אין כאן צורך בהתאמה מושלמת
   בין השתיים, רק בלתת תזכורת סבירה כשהאפליקציה עצמה לא נפתחה.

   מה זה קורא: users/{uid}/records — אותו מבנה בדיוק שהאפליקציה
   כותבת אליו דרך cloud.js. שום דבר כאן לא כותב נתוני אימון/תזונה,
   רק קורא אותם ומחליט אם לשלוח.

   תזמון: ה-workflow מריץ את זה כל שעה עגולה (לא בשעה קבועה אחת),
   והסקריפט עצמו משווה את השעה המקומית בישראל מול שעות שאורי בחר
   בהגדרות האפליקציה (weighInReminderHour/workoutReminderHour).
   ככה שינוי שעה הוא שינוי הגדרה רגיל באפליקציה — לא עריכת קובץ כאן.
   =================================================================== */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldPath } from 'firebase-admin/firestore';
import webpush from 'web-push';

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const APP_URL = 'https://ori-ak-fitness.github.io/ori-fitness-app/';
// workflow_dispatch (הפעלה ידנית מהלשונית Actions) שולח תמיד הודעת
// בדיקה אחת מיידית, בלי תלות בשעה או בתנאים — זו הדרך לבדוק שהצינור
// עובד קצה-לקצה בלי לחכות לזמן האמיתי
const IS_MANUAL_TEST = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch';

const DEFAULT_WEIGH_IN_HOUR = 5;
const DEFAULT_WORKOUT_HOUR = 18;

webpush.setVapidDetails(`mailto:${process.env.VAPID_CONTACT_EMAIL || 'noreply@example.com'}`, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/** תאריך/שעה נכונים לישראל, לא לשעון ה-UTC של ה-runner */
function israelNow() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const weekdayIdx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return {
    dateKey: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: weekdayIdx,
    hour: Number(get('hour')) % 24, // "24" בפורמט הזה מייצג חצות — מנרמלים ל-0
  };
}

/** יום ראשון של השבוע הנוכחי (בישראל), כ-dateKey */
function sundayOf(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
}

/* מזהה הרשומה בפיירסטור - חייב להתאים בול לפורמט ב-cloud.js (recordId),
   כדי שנוכל לקרוא הגדרה ספציפית לפי מזהה בלי לסרוק אותה */
function settingRecordId(key) {
  return `settings__${encodeURIComponent(key)}`;
}

/* רק המפתחות שהתזכורות באמת צריכות - לא כל ההגדרות */
const NEEDED_SETTING_KEYS = [
  'weighInReminderHour', 'workoutReminderHour',
  'weekSchedule', 'cardioWeekSchedule',
];

/* מנויי Push: 'pushSub_<מזהה מכשיר>' לכל מכשיר, ועוד המפתח הישן
   'pushSubscription' (תאימות לאחור). שניהם מתחילים ב-'settings__pushSub',
   ולכן טווח מזהי מסמכים אחד תופס את כולם בלי לסרוק את שאר ההגדרות */
const SUB_ID_PREFIX = 'settings__pushSub';

/*
 * רק שירותי ה-push האמיתיים של הדפדפנים (Chrome/אנדרואיד, Firefox, Safari/אפל,
 * Edge). ה-endpoint נשמר ע"י המשתמש בחשבון שלו, ולכן משתמש מאושר יכול לכתוב
 * לשם כתובת של שרת משלו: הריצה השעתית (עם מפתח Firebase Admin ומפתח ה-VAPID
 * בסביבה) הייתה שולחת אליו בקשות, ואם הוא פשוט לא עונה - נתקעת על כל המשתמשים
 * שאחריו. רשימה סגורה של דומיינים סוגרת את זה.
 */
const ALLOWED_PUSH_HOSTS = ['googleapis.com', 'mozilla.com', 'push.apple.com', 'notify.windows.com'];
const MAX_SUBSCRIPTIONS_PER_USER = 5;

function isAllowedEndpoint(endpoint) {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:'
      && ALLOWED_PUSH_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h));
  } catch { return false; }
}

/** צורה מינימלית תקינה של מנוי — אחרת web-push זורק, ומנוי פגום לא צריך לתקוע אחרים */
function isValidSubscription(s) {
  return s && typeof s === 'object'
    && typeof s.endpoint === 'string' && isAllowedEndpoint(s.endpoint)
    && s.keys && typeof s.keys.p256dh === 'string' && typeof s.keys.auth === 'string';
}

/*
 * במקור זה קרא את כל הרשומות של המשתמש - כולל ארוחות, מטרות ותפריט,
 * שהתזכורות בכלל לא נוגעות בהן - בכל הרצה, כל שעה, 24 פעם ביום. אצל
 * משתמש פעיל עם שנה של נתונים זה לבד יכול לצרוך עשרות אלפי קריאות
 * ביום ולגמור את המכסה החינמית של פיירבייס עם רק כמה משתמשים פעילים.
 * עכשיו: שאילתה אחת ממוקדת לאימונים/שקילות/תוכניות, ובנוסף רק חמש
 * הגדרות ספציפיות לפי מזהה - לא כל ה-settings.
 */
async function loadRecords(uid) {
  const recordsRef = db.collection('users').doc(uid).collection('records');

  const [bulkSnap, settingDocs, subSnap] = await Promise.all([
    recordsRef.where('store', 'in', ['workouts', 'bodyWeight', 'routines']).get(),
    Promise.all(NEEDED_SETTING_KEYS.map((key) => recordsRef.doc(settingRecordId(key)).get())),
    recordsRef
      .where(FieldPath.documentId(), '>=', SUB_ID_PREFIX)
      .where(FieldPath.documentId(), '<', SUB_ID_PREFIX + '')
      .limit(20)   // משתמש לא אמור להחזיק יותר; מגן מהצפה של מסמכי מנוי
      .get(),
  ]);

  // כל מכשיר של המשתמש, בלי כפילויות: אותו endpoint יכול להופיע גם במפתח
  // הישן וגם במפתח החדש של אותו טלפון — ואז הוא היה מקבל כל הודעה פעמיים
  const subscriptions = [];
  const seenEndpoints = new Set();
  for (const doc of subSnap.docs) {
    const rec = doc.data();
    if (rec.deleted || !isValidSubscription(rec.value)) continue;
    if (seenEndpoints.has(rec.value.endpoint)) continue;
    seenEndpoints.add(rec.value.endpoint);
    subscriptions.push({ docId: doc.id, subscription: rec.value });
    if (subscriptions.length >= MAX_SUBSCRIPTIONS_PER_USER) break;
  }

  const bySettingKey = {};
  const bodyWeight = [];
  const workouts = [];
  const cardioTemplates = [];

  for (const doc of bulkSnap.docs) {
    const rec = doc.data();
    if (rec.deleted) continue;
    if (rec.store === 'bodyWeight') bodyWeight.push(rec.value);
    else if (rec.store === 'workouts') workouts.push(rec.value);
    // תבניות אירובי חיות באותו מאגר routines כמו תוכניות כוח, מסומנות kind
    else if (rec.store === 'routines' && rec.value?.kind === 'cardio') cardioTemplates.push(rec.value);
  }
  for (const doc of settingDocs) {
    if (!doc.exists) continue;
    const rec = doc.data();
    if (rec.deleted) continue;
    bySettingKey[rec.key] = rec.value;
  }

  return { bySettingKey, bodyWeight, workouts, cardioTemplates, subscriptions };
}

async function markSent(uid, field, dateKey) {
  await db.collection('pushLog').doc(uid).set({ [field]: dateKey }, { merge: true });
}

async function clearSubscription(uid, docId) {
  // אותה צורת רשומה בדיוק שהאפליקציה כותבת (מצבה) — כך שהמכשיר הזה
  // גם ילמד שהמנוי נעלם, ורק המנוי הפגום נמחק, לא של מכשירים אחרים
  const key = decodeURIComponent(docId.slice('settings__'.length));
  await db.collection('users').doc(uid).collection('records').doc(docId)
    .set({ store: 'settings', key, deleted: true, updatedAt: Date.now() });
}

/** שולח לכל מכשירי המשתמש. מחזיר true אם לפחות אחד קיבל */
async function send(uid, subscriptions, payload) {
  let anyOk = false;
  for (const { docId, subscription } of subscriptions) {
    try {
      // timeout: שרת שלא עונה לא יכול לתקוע את הריצה השעתית של כולם
      await webpush.sendNotification(subscription, JSON.stringify(payload), { timeout: 10000, TTL: 3600 });
      anyOk = true;
    } catch (err) {
      // רק קוד הסטטוס, לא err.message - זה ריפו ציבורי ולוגים של
      // Actions גלויים לכל אחד; אין סיבה שפרטי endpoint/subscription
      // ידלפו לשם, גם אם זה רק לצורך דיבוג
      console.warn('שליחה נכשלה, קוד:', err.statusCode ?? 'לא ידוע');
      if (err.statusCode === 404 || err.statusCode === 410) {
        try { await clearSubscription(uid, docId); } catch { /* לא קריטי, ננסה בהרצה הבאה */ }
      }
    }
  }
  return anyOk;
}

async function run() {
  const now = israelNow();
  // רק מאושרים, ובלי לשלוף את שאר השדות של מסמך המשתמש (מייל, תמונה, ...):
  // גם מחסך קריאות מיותרות של משתמשים ממתינים/חסומים/ספאם בכל ריצה שעתית
  const usersSnap = await db.collection('users').where('status', '==', 'approved').select().get();
  let sent = 0;

  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;

    /*
     * לפני התיקון: רק send() עצמה הייתה עטופה ב-try/catch. שגיאה בכל
     * קריאת Firestore אחרת כאן (loadRecords, pushLog, markSent) הייתה
     * קורסת מחוץ ללולאה כולה - משתמש אחד עם תקלה חוסם את התזכורות
     * לכל שאר המשתמשים שבתור אחריו, בכל ריצה שעתית.
     */
    try {
      await processUser(userDoc, now, (n) => { sent += n; });
    } catch (err) {
      // בלי uid: הלוגים של הריפו הציבורי גלויים לכולם
      console.warn('עיבוד משתמש נכשל, ממשיך לבא:', err.code ?? 'לא ידוע');
    }
  }

  // הספירה רק בהרצה ידנית - בהרצות השעתיות היא הייתה חושפת בלוג ציבורי
  // כמה התראות יצאו בכל שעה (כלומר מתי המשתמשים פעילים)
  if (IS_MANUAL_TEST) console.log(`נשלחו ${sent} התראות.`);
}

async function processUser(userDoc, now, addSent) {
  const uid = userDoc.id;
  const { bySettingKey, bodyWeight, workouts, cardioTemplates, subscriptions } = await loadRecords(uid);
  if (!subscriptions.length) return;

  if (IS_MANUAL_TEST) {
    const ok = await send(uid, subscriptions, {
      title: 'בדיקה 🔔', body: 'אם זה הגיע — ההתראות עובדות.', url: APP_URL,
    });
    if (ok) addSent(1);
    return;
  }

  const pushLogSnap = await db.collection('pushLog').doc(uid).get();
  const pushLog = pushLogSnap.exists ? pushLogSnap.data() : {};

  // ---- תזכורת שקילה: יום שלישי, בשעה שנבחרה, אם לא נשקל השבוע ----
  const weighInHour = Number(bySettingKey.weighInReminderHour ?? DEFAULT_WEIGH_IN_HOUR);
  if (now.weekday === 2 && now.hour === weighInHour && pushLog.weighIn !== now.dateKey) {
    const sunday = sundayOf(now.dateKey);
    const weighedThisWeek = bodyWeight.some((e) => e?.date >= sunday && e?.date <= now.dateKey);
    if (!weighedThisWeek) {
      const ok = await send(uid, subscriptions, {
        title: 'שקילה שבועית', body: 'יום שלישי — עוד לא נשקלת השבוע.', url: APP_URL,
      });
      if (ok) { await markSent(uid, 'weighIn', now.dateKey); addSent(1); }
    }
  }

  // ---- תזכורת אימון: בשעה שנבחרה, אם יש אימון מתוכנן להיום ולא בוצע ----
  const workoutHour = Number(bySettingKey.workoutReminderHour ?? DEFAULT_WORKOUT_HOUR);
  if (now.hour === workoutHour && pushLog.workout !== now.dateKey) {
    const schedule = Array.isArray(bySettingKey.weekSchedule) ? bySettingKey.weekSchedule : [];
    const routineId = schedule[now.weekday];
    if (routineId) {
      const doneToday = workouts.some((w) => w?.date === now.dateKey && w?.routineId === routineId);
      if (!doneToday) {
        const ok = await send(uid, subscriptions, {
          title: 'האימון של היום', body: `יום ${DAY_NAMES[now.weekday]} — עוד לא סימנת שהתאמנת היום.`, url: APP_URL,
        });
        if (ok) { await markSent(uid, 'workout', now.dateKey); addSent(1); }
      }
    }
  }

  // ---- תזכורת אירובי: נפרדת מתזכורת האימון בכוונה — יום עם שניהם
  // צריך שתי תזכורות, לא אחת שמסתירה את השנייה (אותה שעה: workoutHour) ----
  if (now.hour === workoutHour && pushLog.cardio !== now.dateKey) {
    const cardioSchedule = Array.isArray(bySettingKey.cardioWeekSchedule) ? bySettingKey.cardioWeekSchedule : [];
    const templateId = cardioSchedule[now.weekday];
    const template = templateId ? cardioTemplates.find((t) => t.id === templateId) : null;
    if (template) {
      const doneToday = workouts.some((w) => w?.kind === 'cardio' && w?.date === now.dateKey && w?.templateId === templateId);
      if (!doneToday) {
        const ok = await send(uid, subscriptions, {
          title: 'האירובי של היום', body: `${template.name} עוד לא סומן היום.`, url: APP_URL,
        });
        if (ok) { await markSent(uid, 'cardio', now.dateKey); addSent(1); }
      }
    }
  }
}

run().catch((err) => { console.error(err); process.exit(1); });
