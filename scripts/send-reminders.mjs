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

   תזמון: ה-workflow מריץ את זה כל רבע שעה (לא בשעה קבועה אחת), כדי
   לצמצם את האיחור שגיטהאב עצמו מוסיף להפעלת cron בשעות עגולות.
   הסקריפט עצמו משווה את השעה המקומית בישראל מול שעות שאורי בחר
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
const WEEKLY_RECAP_HOUR = 20;

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

function shiftKey(dateKey, days) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/* מזהה הרשומה בפיירסטור - חייב להתאים בול לפורמט ב-cloud.js (recordId),
   כדי שנוכל לקרוא הגדרה ספציפית לפי מזהה בלי לסרוק אותה */
function settingRecordId(key) {
  return `settings__${encodeURIComponent(key)}`;
}

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
 * מכסת הקריאות של Firebase החינמי היא 50,000 ליום, והסקריפט הזה רץ כל שעה
 * לכל משתמש. בגרסה הקודמת כל ריצה שלפה את *כל* האימונים והשקילות של
 * המשתמש - גם כשאין מה לשלוח - כלומר קריאות לפי גודל ההיסטוריה × 24:
 * משתמש עם חודשיים של נתונים ~2,000 קריאות ביום, עם שנה ~10,000, עם שלוש
 * שנים ~35,000. עם 5 משתמשים ותיקים המכסה נגמרת, ומהרגע הזה גם הסנכרון של
 * האפליקציה עצמה מתחיל להיכשל אצל כולם עד חצות.
 *
 * עכשיו העלות אינה תלויה בגודל ההיסטוריה:
 *   1. כל שעה, לכל משתמש: מסמך אחד בלבד - שעת התזכורת.
 *   2. רק אם עכשיו באמת שעה של תזכורת: שאר ההחלטה (מנוי, יומן שליחה,
 *      לוח שבועי) ושאילתה אחת על מה שנרשם מתחילת השבוע.
 * השאילתה משתמשת בשדה בודד (value.date) - Firestore יוצר לו אינדקס לבד,
 * בלי שום הגדרה בקונסולה.
 */

/** האם שאילתת התאריך עבדה בפעם האחרונה — לדיווח בהרצה ידנית (ראה run) */
let dateQueryWorks = null;

/** התו הגבוה ביותר - סוף טווח של "כל מה שמתחיל בקידומת". כתוב כקוד ולא כתו
    בלתי נראה, כדי שעורך טקסט לא ימחק אותו בשקט */
const PREFIX_END = '\uf8ff';

/** ערך הגדרה בודדת לפי מזהה (קריאה אחת), או undefined אם אין/נמחקה */
async function readSetting(recordsRef, key) {
  const doc = await recordsRef.doc(settingRecordId(key)).get();
  if (!doc.exists) return undefined;
  const rec = doc.data();
  return rec.deleted ? undefined : rec.value;
}

/** כל מכשיר של המשתמש, בלי כפילויות: אותו endpoint יכול להופיע גם במפתח
    הישן וגם במפתח החדש של אותו טלפון — ואז הוא היה מקבל כל הודעה פעמיים */
async function loadSubscriptions(recordsRef) {
  const subSnap = await recordsRef
    .where(FieldPath.documentId(), '>=', SUB_ID_PREFIX)
    .where(FieldPath.documentId(), '<', SUB_ID_PREFIX + PREFIX_END)
    .limit(20)   // משתמש לא אמור להחזיק יותר; מגן מהצפה של מסמכי מנוי
    .get();

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
  return subscriptions;
}

/** אימונים ושקילות מהתאריך הנתון והלאה (רשומות שנמחקו אין להן value, ולכן לא חוזרות) */
async function loadRecordsSince(recordsRef, fromKey) {
  let docs;
  try {
    docs = (await recordsRef.where('value.date', '>=', fromKey).get()).docs;
    dateQueryWorks = true;
  } catch (err) {
    // רשת ביטחון: אם משום מה השאילתה החדשה נדחית (למשל אינדקס), חוזרים לשליפה
    // המלאה הישנה - יקר יותר, אבל התזכורות ממשיכות לצאת. רק הקוד, בלי פרטים
    console.warn('שאילתת התאריך נכשלה, חוזר לשליפה מלאה. קוד:', err.code ?? 'לא ידוע');
    dateQueryWorks = false;
    docs = (await recordsRef.where('store', 'in', ['workouts', 'bodyWeight']).get()).docs;
  }
  const bodyWeight = [];
  const workouts = [];
  for (const doc of docs) {
    const rec = doc.data();
    if (rec.deleted) continue;
    if (rec.store === 'bodyWeight') bodyWeight.push(rec.value);
    else if (rec.store === 'workouts') workouts.push(rec.value);
  }
  return { bodyWeight, workouts };
}

/** תבנית אירובי בודדת לפי מזהה — מסמך אחד, לא כל התוכניות. המזהה באותו
    פורמט של recordId ב-cloud.js */
async function loadCardioTemplate(recordsRef, templateId) {
  const doc = await recordsRef.doc(`routines__${encodeURIComponent(templateId)}`).get();
  if (!doc.exists) return null;
  const rec = doc.data();
  return !rec.deleted && rec.value?.kind === 'cardio' ? rec.value : null;
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
  if (IS_MANUAL_TEST) {
    console.log(`נשלחו ${sent} התראות.`);
    console.log(dateQueryWorks === null ? 'שאילתת התאריך לא נבדקה (אין משתמשים מאושרים).'
      : dateQueryWorks ? 'שאילתת התאריך: תקינה ✅' : 'שאילתת התאריך: נכשלה ⚠️ — נופל לשליפה המלאה הישנה');
  }
}

async function processUser(userDoc, now, addSent) {
  const uid = userDoc.id;
  const recordsRef = db.collection('users').doc(uid).collection('records');

  if (IS_MANUAL_TEST) {
    // בהרצה ידנית בודקים גם את שאילתת התאריך (בלי לשלוח כלום ממנה), כדי
    // שאפשר יהיה לראות בלוג של ה-Action שהיא עובדת מול Firestore האמיתי
    await loadRecordsSince(recordsRef, sundayOf(now.dateKey));
    const subscriptions = await loadSubscriptions(recordsRef);
    if (!subscriptions.length) return;
    const ok = await send(uid, subscriptions, {
      title: 'בדיקה 🔔', body: 'אם זה הגיע — ההתראות עובדות.', url: APP_URL,
    });
    if (ok) addSent(1);
    return;
  }

  /*
   * הריצה הזו קורית כל שעה לכל משתמש, ורוב הפעמים אין מה לשלוח. לכן קודם
   * קוראים רק את שעת התזכורת (מסמך אחד) ומחליטים אם בכלל משהו יכול לצאת
   * עכשיו - ורק אז שולפים עוד. שעת השקילה נקראת רק בימי שלישי.
   */
  const workoutHour = Number((await readSetting(recordsRef, 'workoutReminderHour')) ?? DEFAULT_WORKOUT_HOUR);
  const weighInHour = now.weekday === 2
    ? Number((await readSetting(recordsRef, 'weighInReminderHour')) ?? DEFAULT_WEIGH_IN_HOUR)
    : null;
  const weighInDue = weighInHour !== null && now.hour === weighInHour;
  const workoutDue = now.hour === workoutHour;               // גם אימון וגם אירובי - אותה שעה
  const weeklyDue = now.weekday === 6 && now.hour === WEEKLY_RECAP_HOUR;
  if (!weighInDue && !workoutDue && !weeklyDue) return;

  const pushLogSnap = await db.collection('pushLog').doc(uid).get();
  const pushLog = pushLogSnap.exists ? pushLogSnap.data() : {};
  const weighInTodo = weighInDue && pushLog.weighIn !== now.dateKey;
  const weeklyTodo = weeklyDue && pushLog.weekly !== now.dateKey;
  const workoutTodo = workoutDue && pushLog.workout !== now.dateKey;
  const cardioTodo = workoutDue && pushLog.cardio !== now.dateKey;
  if (!weighInTodo && !weeklyTodo && !workoutTodo && !cardioTodo) return;

  const subscriptions = await loadSubscriptions(recordsRef);
  if (!subscriptions.length) return;

  const sunday = sundayOf(now.dateKey);
  const monthAgo = shiftKey(now.dateKey, -28);
  // נשלף רק כשצריך, ופעם אחת: כל מה שנרשם מתחילת השבוע (או 28 ימים אחורה
  // לסיכום השבועי, שצריך גם לדעת אם המשתמש פעיל בכלל)
  let recordsCache = null;
  const records = async () => (recordsCache ??= await loadRecordsSince(recordsRef, weeklyTodo ? monthAgo : sunday));

  // ---- תזכורת שקילה: יום שלישי, בשעה שנבחרה, אם לא נשקל השבוע ----
  if (weighInTodo) {
    const { bodyWeight } = await records();
    const weighedThisWeek = bodyWeight.some((e) => e?.date >= sunday && e?.date <= now.dateKey);
    if (!weighedThisWeek) {
      const ok = await send(uid, subscriptions, {
        title: 'שקילה שבועית', body: 'יום שלישי — עוד לא נשקלת השבוע.', url: APP_URL,
      });
      if (ok) { await markSent(uid, 'weighIn', now.dateKey); addSent(1); }
    }
  }

  // ---- הסיכום השבועי: מוצאי שבת, 20:00 — אותה שעה שבה הכרטיס מופיע
  // באפליקציה (RECAP_HOUR ב-weekly.js). מי שלא התאמן כבר חודש לא מקבל
  // "השבוע היה שקט" כל שבוע — זה היה הופך לנדנוד ----
  if (weeklyTodo) {
    const { workouts } = await records();
    const count = workouts.filter((w) => w?.date >= sunday && w?.date <= now.dateKey).length;
    const activeLately = count > 0 || workouts.some((w) => w?.date >= monthAgo);
    if (activeLately) {
      const ok = await send(uid, subscriptions, {
        title: 'הסיכום השבועי שלך 📊',
        body: count === 0 ? 'שבוע של מנוחה — הסיכום וההצצה לשבוע הבא מחכים לך.'
          : count === 1 ? 'אימון אחד השבוע. בוא תראה איך היה השבוע.'
          : `${count} אימונים השבוע 💪 בוא תראה איך היה השבוע.`,
        url: APP_URL + '#recap',
      });
      if (ok) { await markSent(uid, 'weekly', now.dateKey); addSent(1); }
    }
  }

  // ---- תזכורת אימון: בשעה שנבחרה, אם יש אימון מתוכנן להיום ולא בוצע ----
  if (workoutTodo) {
    const scheduleRaw = await readSetting(recordsRef, 'weekSchedule');
    const schedule = Array.isArray(scheduleRaw) ? scheduleRaw : [];
    const routineId = schedule[now.weekday];
    if (routineId) {
      // כל אימון כוח היום נחשב, כמו באפליקציה — גם חופשי או תוכנית אחרת.
      // אחרת מי שעשה אימון חופשי קיבל "עוד לא התאמנת" אחרי שכבר התאמן
      const { workouts } = await records();
      const doneToday = workouts.some((w) => w?.date === now.dateKey && (w?.kind ?? 'strength') === 'strength');
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
  if (cardioTodo) {
    const cardioRaw = await readSetting(recordsRef, 'cardioWeekSchedule');
    const cardioSchedule = Array.isArray(cardioRaw) ? cardioRaw : [];
    const templateId = cardioSchedule[now.weekday];
    const template = templateId ? await loadCardioTemplate(recordsRef, templateId) : null;
    if (template) {
      const { workouts } = await records();
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
