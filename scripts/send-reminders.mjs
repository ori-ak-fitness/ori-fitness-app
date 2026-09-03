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
   =================================================================== */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import webpush from 'web-push';

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const APP_URL = 'https://ori-ak-fitness.github.io/ori-fitness-app/';

webpush.setVapidDetails(`mailto:${process.env.VAPID_CONTACT_EMAIL || 'noreply@example.com'}`, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const WORKOUT_REMINDER_HOUR = 18; // תואם WORKOUT_REMINDER_HOUR ב-reminders.js

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
    hour: Number(get('hour')),
  };
}

/** יום ראשון של השבוע הנוכחי (בישראל), כ-dateKey */
function sundayOf(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
}

async function loadRecords(uid) {
  const snap = await db.collection('users').doc(uid).collection('records').get();
  const bySettingKey = {};
  const bodyWeight = [];
  const workouts = [];
  for (const doc of snap.docs) {
    const rec = doc.data();
    if (rec.deleted) continue;
    if (rec.store === 'settings') bySettingKey[rec.key] = rec.value;
    else if (rec.store === 'bodyWeight') bodyWeight.push(rec.value);
    else if (rec.store === 'workouts') workouts.push(rec.value);
  }
  return { bySettingKey, bodyWeight, workouts };
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

    const { bySettingKey, bodyWeight, workouts } = await loadRecords(uid);
    const subscription = bySettingKey.pushSubscription;
    if (!subscription) continue;

    const pushLogSnap = await db.collection('pushLog').doc(uid).get();
    const pushLog = pushLogSnap.exists ? pushLogSnap.data() : {};

    // ---- תזכורת שקילה: יום שלישי, אם לא נשקל השבוע ----
    if (now.weekday === 2 && pushLog.weighIn !== now.dateKey) {
      const sunday = sundayOf(now.dateKey);
      const weighedThisWeek = bodyWeight.some((e) => e?.date >= sunday && e?.date <= now.dateKey);
      if (!weighedThisWeek) {
        const ok = await send(uid, subscription, {
          title: 'שקילה שבועית', body: 'יום שלישי — עוד לא נשקלת השבוע.', url: APP_URL,
        });
        if (ok) { await markSent(uid, 'weighIn', now.dateKey); sent++; }
      }
    }

    // ---- תזכורת אימון: אחרי השעה שנקבעה, אם יש אימון מתוכנן להיום ולא בוצע ----
    if (now.hour >= WORKOUT_REMINDER_HOUR && pushLog.workout !== now.dateKey) {
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
  }

  console.log(`נשלחו ${sent} התראות.`);
}

run().catch((err) => { console.error(err); process.exit(1); });
