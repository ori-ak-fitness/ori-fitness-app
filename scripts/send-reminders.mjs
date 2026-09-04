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
import { getFirestore } from 'firebase-admin/firestore';
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
  'pushSubscription', 'weighInReminderHour', 'workoutReminderHour',
  'weekSchedule', 'cardioWeekSchedule',
];

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

  const [bulkSnap, settingDocs] = await Promise.all([
    recordsRef.where('store', 'in', ['workouts', 'bodyWeight', 'routines']).get(),
    Promise.all(NEEDED_SETTING_KEYS.map((key) => recordsRef.doc(settingRecordId(key)).get())),
  ]);

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

  return { bySettingKey, bodyWeight, workouts, cardioTemplates };
}

async function markSent(uid, field, dateKey) {
  await db.collection('pushLog').doc(uid).set({ [field]: dateKey }, { merge: true });
}

async function clearSubscription(uid) {
  // אותה צורת רשומה בדיוק שהאפליקציה כותבת — כך שהיא גם תלמד שהמנוי נעלם
  await db.collection('users').doc(uid).collection('records').doc('settings__pushSubscription')
    .set({ store: 'settings', key: 'pushSubscription', deleted: true, updatedAt: Date.now() });
}

async function send(uid, subscription, payload) {
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return true;
  } catch (err) {
    console.warn(`[${uid}] שליחה נכשלה:`, err.statusCode || err.message);
    if (err.statusCode === 404 || err.statusCode === 410) await clearSubscription(uid);
    return false;
  }
}

async function run() {
  const now = israelNow();
  const usersSnap = await db.collection('users').get();
  let sent = 0;

  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    if (userDoc.data()?.status !== 'approved') continue;

    const { bySettingKey, bodyWeight, workouts, cardioTemplates } = await loadRecords(uid);
    const subscription = bySettingKey.pushSubscription;
    if (!subscription) continue;

    if (IS_MANUAL_TEST) {
      const ok = await send(uid, subscription, {
        title: 'בדיקה 🔔', body: 'אם זה הגיע — ההתראות עובדות.', url: APP_URL,
      });
      if (ok) sent++;
      continue;
    }

    const pushLogSnap = await db.collection('pushLog').doc(uid).get();
    const pushLog = pushLogSnap.exists ? pushLogSnap.data() : {};

    // ---- תזכורת שקילה: יום שלישי, בשעה שנבחרה, אם לא נשקל השבוע ----
    const weighInHour = Number(bySettingKey.weighInReminderHour ?? DEFAULT_WEIGH_IN_HOUR);
    if (now.weekday === 2 && now.hour === weighInHour && pushLog.weighIn !== now.dateKey) {
      const sunday = sundayOf(now.dateKey);
      const weighedThisWeek = bodyWeight.some((e) => e?.date >= sunday && e?.date <= now.dateKey);
      if (!weighedThisWeek) {
        const ok = await send(uid, subscription, {
          title: 'שקילה שבועית', body: 'יום שלישי — עוד לא נשקלת השבוע.', url: APP_URL,
        });
        if (ok) { await markSent(uid, 'weighIn', now.dateKey); sent++; }
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
          const ok = await send(uid, subscription, {
            title: 'האימון של היום', body: `יום ${DAY_NAMES[now.weekday]} — עוד לא סימנת שהתאמנת היום.`, url: APP_URL,
          });
          if (ok) { await markSent(uid, 'workout', now.dateKey); sent++; }
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
          const ok = await send(uid, subscription, {
            title: 'האירובי של היום', body: `${template.name} עוד לא סומן היום.`, url: APP_URL,
          });
          if (ok) { await markSent(uid, 'cardio', now.dateKey); sent++; }
        }
      }
    }
  }

  console.log(`נשלחו ${sent} התראות.`);
}

run().catch((err) => { console.error(err); process.exit(1); });
