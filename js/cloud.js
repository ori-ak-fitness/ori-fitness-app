/* ===================================================================
   cloud.js — סנכרון הנתונים בין המכשירים.

   הרעיון: המכשיר נשאר מקור האמת לשימוש היומיומי, והענן הוא עותק
   משותף. כך האפליקציה ממשיכה לעבוד מהר ובלי אינטרנט, ובכל זאת
   מה שנרשם בטלפון מופיע גם במחשב.

   מה עובר: אימונים, ארוחות, יעדים, תוכניות אימון, התפריט, שקילות
   והגדרות — כלומר כל מה שמוקלד באפליקציה.
   מה לא עובר: תמונות. הן כבדות, ואחסון קבצים בענן הוא החלק היחיד
   ב-Firebase שאינו חינם. הגיבוי נשאר רשת הביטחון היחידה עבורן.

   כלל ברזל: **תקלה בענן לעולם לא שוברת את האפליקציה.** כל קריאה כאן
   עטופה, וכישלון מסתיים בכתיבה ליומן בלבד — הנתונים המקומיים
   ממשיכים לעבוד בדיוק כמו לפני שהמודול הזה נולד.

   פתרון התנגשויות: לכל רשומה יש updatedAt. בהתנגשות מנצח החדש יותר.
   רוב הרשומות בכלל לא מתנגשות — לאימון ולארוחה יש מזהה ייחודי לכל
   מכשיר, ולכן שני מכשירים מתאחדים ולא דורסים זה את זה.
   =================================================================== */

import * as db from './db.js';
import { currentUser, fetchRecords, putRecords } from './auth.js';

/* מה מסונכרן. photos בכוונה אינו כאן */
const SYNCED_STORES = [
  db.STORES.workouts,
  db.STORES.meals,
  db.STORES.goals,
  db.STORES.routines,
  db.STORES.mealPlan,
  db.STORES.bodyWeight,
  db.STORES.settings,
];
const IS_SYNCED = new Set(SYNCED_STORES);

/* מתי כל רשומה עודכנה אצלנו — כדי לדעת אם הענן חדש יותר או ישן יותר */
const META_KEY = '__syncMeta';

/* הגדרות שאין טעם לסנכרן: מצב רגעי של המכשיר הזה, לא נתונים אישיים */
const LOCAL_ONLY_SETTINGS = new Set([
  'activeWorkout',   // אימון שרץ עכשיו על המכשיר הזה
  META_KEY,
]);

/*
 * שעונים של שני מכשירים לעולם אינם זהים לחלוטין. אם היינו מושכים
 * בדיוק ממה שראינו לאחרונה, רשומה שנכתבה בטלפון ששעונו מפגר מעט
 * הייתה נופלת בין הכיסאות ולא מגיעה למחשב לעולם. חלון של יממה
 * מכסה כל הפרש סביר, ומחירו קריאה חוזרת של יום אחד בלבד.
 */
const CLOCK_SLACK_MS = 24 * 60 * 60 * 1000;

let enabled = false;
let queue = new Map();   // recordId -> {store, key, value|null}
let flushTimer = null;

/*
 * מצב אחרון של הסנכרון, לתצוגה בהגדרות.
 * בלי זה כשל בענן הוא בלתי נראה: הכל ממשיך לעבוד מקומית, ומבחוץ
 * זה נראה פשוט כמו "הנתונים לא עוברים" בלי שום רמז למה.
 */
let status = { state: 'לא הופעל', reason: null, lastSyncAt: null, pulled: 0, pushed: 0 };

/** @returns {{state:string, reason:?string, lastSyncAt:?number, pulled:number, pushed:number, queued:number}} */
export function cloudStatus() {
  return { ...status, queued: queue.size };
}

function fail(state, err) {
  status.state = state;
  status.reason = err?.code || err?.message || 'שגיאה';
}

/* ---------- מפתחות ורשומות ---------- */

/** מזהה הרשומה בענן. מקודד כדי שמפתח עם תווים חריגים לא ישבור נתיב */
function recordId(store, key) {
  return `${store}__${encodeURIComponent(key)}`;
}

function isSyncable(store, key) {
  if (!IS_SYNCED.has(store)) return false;
  if (store === db.STORES.settings && LOCAL_ONLY_SETTINGS.has(key)) return false;
  return true;
}

/*
 * Firestore דוחה undefined בתוך אובייקט, וברשומות מקומיות יש שדות
 * שלא תמיד מולאו. מעבר דרך JSON מנקה אותם — וגם מוודא שמה שנשלח
 * הוא בדיוק מה שהגיבוי יודע לכתוב.
 */
function clean(value) {
  return value === undefined ? null : JSON.parse(JSON.stringify(value));
}

/* בהגדרות נשמר הערך עצמו (כך זה נשמר בענן מהיום הראשון); בשאר
   המאגרים נשמרת הרשומה השלמה, שכבר מכילה את המזהה שלה */
function payloadOf(store, value) {
  return store === db.STORES.settings ? clean(value?.value ?? value) : clean(value);
}

function rowFromPayload(store, key, payload) {
  return store === db.STORES.settings ? { key, value: payload } : payload;
}

/* ---------- מטא ---------- */

async function readMeta() {
  let meta;
  try { meta = await db.getSetting(META_KEY, null); }
  catch { meta = null; }
  if (!meta || typeof meta !== 'object') return { at: {}, lastPull: 0, seeded: false };

  // גרסה ראשונה החזיקה מפה שטוחה של הגדרות בלבד. ממירים אותה כדי
  // שמכשיר שכבר סונכרן לא יעלה מחדש את כל ההגדרות שלו
  if (!meta.at) {
    const at = {};
    for (const [key, ts] of Object.entries(meta)) {
      if (typeof ts === 'number') at[recordId(db.STORES.settings, key)] = ts;
    }
    return { at, lastPull: 0, seeded: false };
  }
  return { at: meta.at || {}, lastPull: meta.lastPull || 0, seeded: !!meta.seeded };
}

async function writeMeta(meta) {
  // putQuiet ולא setSetting: המטא הוא מצב מקומי של המכשיר הזה בלבד,
  // ואסור שיסתובב בענן ויחזור למכשיר אחר
  try { await db.putQuiet(db.STORES.settings, { key: META_KEY, value: meta }); }
  catch { /* לא קריטי */ }
}

/* ---------- דחיפה ---------- */

/*
 * שינויים נצברים ונשלחים יחד. בלי זה, מסך שמעדכן כמה רשומות ברצף
 * היה יורה סדרת כתיבות לרשת — וכתיבות הן המשאב המוגבל אצל Firebase.
 */
function scheduleFlush() {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => { flush().catch(() => {}); }, 900);
}

async function flush() {
  if (!enabled || !queue.size) return;
  const pending = queue;
  queue = new Map();

  const updatedAt = Date.now();
  const items = [];
  for (const [id, { store, key, value }] of pending) {
    items.push({
      id,
      // מחיקה נשמרת כמצבה ולא כהיעדר רשומה: מכשיר אחר חייב ללמוד
      // שהפריט נמחק, ולא רק "לא לראות אותו"
      data: value === null
        ? { store, key, deleted: true, updatedAt }
        : { store, key, value: payloadOf(store, value), updatedAt },
    });
  }

  try {
    await putRecords(items);
    const meta = await readMeta();
    for (const item of items) meta.at[item.id] = updatedAt;
    await writeMeta(meta);
    status.pushed += items.length;
    status.state = 'מסונכרן';
    status.reason = null;
    status.lastSyncAt = updatedAt;
  } catch (err) {
    console.warn('[Ori Fitness] שליחה לענן נכשלה:', err?.code || err);
    fail('שגיאה בשליחה', err);
    // מחזירים לתור כדי לנסות שוב, אלא אם כבר נכתב משהו חדש מאז
    for (const [id, entry] of pending) if (!queue.has(id)) queue.set(id, entry);
  }
}

/** נקרא מ-db.js בכל כתיבה ומחיקה */
function onLocalChange(store, key, value) {
  if (!enabled || !isSyncable(store, key)) return;
  queue.set(recordId(store, key), { store, key, value });
  scheduleFlush();
}

/* ---------- משיכה ---------- */

/**
 * מושך מהענן ומחיל רק מה שחדש ממה שיש כאן.
 * @returns {Promise<number>} כמה רשומות התעדכנו בפועל
 */
async function pull() {
  const meta = await readMeta();
  const since = meta.lastPull ? Math.max(0, meta.lastPull - CLOCK_SLACK_MS) : 0;
  const records = await fetchRecords(since);

  let applied = 0;
  let newest = meta.lastPull;

  for (const rec of records) {
    if (typeof rec.updatedAt !== 'number') continue;
    if (rec.updatedAt > newest) newest = rec.updatedAt;
    if (!rec.store || !rec.key || !isSyncable(rec.store, rec.key)) continue;

    // שווה בדיוק אינו "חדש יותר" — אחרת כל טעינה הייתה כותבת מחדש לחינם
    if (!(rec.updatedAt > (meta.at[rec.id] ?? 0))) continue;

    if (rec.deleted) await db.delQuiet(rec.store, rec.key);
    else await db.putQuiet(rec.store, rowFromPayload(rec.store, rec.key, rec.value));

    meta.at[rec.id] = rec.updatedAt;
    applied++;
  }

  meta.lastPull = newest;
  await writeMeta(meta);
  return applied;
}

/* ---------- העלאה ראשונית ---------- */

/**
 * מעלה בפעם הראשונה כל מה שכבר יושב במכשיר הזה. בלי זה, כל מה
 * שנרשם לפני שהסנכרון נולד היה נשאר תקוע במכשיר אחד.
 *
 * רץ רק אחרי משיכה מלאה מוצלחת, כדי שלא נעלה בחזרה רשומות שהרגע
 * ירדו מהענן.
 */
async function seed() {
  const meta = await readMeta();
  if (meta.seeded) return 0;

  let queued = 0;
  for (const store of SYNCED_STORES) {
    let rows;
    try { rows = await db.getAll(store); }
    catch { continue; }
    for (const row of rows) {
      const key = db.keyOf(store, row);
      if (key == null || !isSyncable(store, key)) continue;
      const id = recordId(store, key);
      if (meta.at[id]) continue;          // כבר מוכר לענן
      queue.set(id, { store, key, value: row });
      queued++;
    }
  }

  if (queued) await flush();
  // מסמנים רק אם באמת לא נשאר תלוי באוויר — אחרת ננסה שוב בפעם הבאה
  if (!queue.size) {
    const after = await readMeta();
    after.seeded = true;
    await writeMeta(after);
  }
  return queued;
}

/* ---------- הפעלה ---------- */

/**
 * מפעיל את הסנכרון. נקרא אחרי שהמשתמש אושר ומסד הנתונים נפתח.
 * @param {() => void} [onPulled] רענון מסכים אחרי שנמשכו שינויים
 * @returns {Promise<{ok: boolean, applied?: number, reason?: string}>}
 */
export async function initCloud(onPulled) {
  if (!currentUser()?.uid) {
    status = { ...status, state: 'לא מחובר', reason: 'אין משתמש' };
    return { ok: false, reason: 'לא מחובר' };
  }

  db.watchWrites(onLocalChange);
  enabled = true;

  // מה שנשאר בתור מכשל קודם ראוי לניסיון נוסף ברגע שיש רשת
  addEventListener('online', () => { flush().catch(() => {}); });

  try {
    const applied = await pull();
    status.state = 'מסונכרן';
    status.reason = null;
    status.lastSyncAt = Date.now();
    status.pulled += applied;
    if (applied) onPulled?.();

    await seed().catch(() => {});

    // חוזרים לאפליקציה — מושכים שוב, כי ייתכן ששינית משהו במכשיר אחר
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      pull().then((n) => {
        if (!n) return;
        status.pulled += n;
        status.lastSyncAt = Date.now();
        onPulled?.();
      }).catch(() => {});
    });

    return { ok: true, applied };
  } catch (err) {
    console.warn('[Ori Fitness] משיכה מהענן נכשלה:', err?.code || err);
    fail('שגיאה בקריאה', err);
    // נשארים פעילים: דחיפות עדיין ינוסו, והאפליקציה עובדת מקומית כרגיל
    return { ok: false, reason: err?.code || 'שגיאה' };
  }
}

/**
 * סנכרון יזום מההגדרות: שולח מה שממתין, מושך מה שיש, ומחזיר את המצב.
 * קיים כדי שאפשר יהיה לראות תקלה מיד ובמפורש, במקום לנחש למה
 * "הנתונים לא עוברים".
 */
export async function syncNow(onPulled) {
  if (!currentUser()?.uid) {
    status = { ...status, state: 'לא מחובר', reason: 'אין משתמש' };
    return cloudStatus();
  }
  db.watchWrites(onLocalChange);
  enabled = true;
  await flushNow();
  try {
    await seed().catch(() => {});
    const applied = await pull();
    status.state = 'מסונכרן';
    status.reason = null;
    status.lastSyncAt = Date.now();
    status.pulled += applied;
    if (applied) onPulled?.();
  } catch (err) {
    fail('שגיאה בקריאה', err);
  }
  return cloudStatus();
}

/** דחיפה מיידית של מה שממתין — לפני שהאפליקציה נסגרת */
export async function flushNow() {
  clearTimeout(flushTimer);
  await flush().catch(() => {});
}
