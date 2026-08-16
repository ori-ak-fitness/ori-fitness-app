/* ===================================================================
   cloud.js — סנכרון הנתונים בין המכשירים.

   הרעיון: המכשיר נשאר מקור האמת לשימוש היומיומי, והענן הוא עותק
   משותף. כך האפליקציה ממשיכה לעבוד מהר ובלי אינטרנט, ובכל זאת
   מה שנרשם בטלפון מופיע גם במחשב.

   מה עובר: הגדרות (שם, יעדים, אתגר, תוכניות).
   מה לא עובר: תמונות — הן כבדות, ואחסון קבצים בענן הוא החלק היחיד
   ב-Firebase שאינו חינם.

   כלל ברזל: **תקלה בענן לעולם לא שוברת את האפליקציה.** כל קריאה כאן
   עטופה, וכישלון מסתיים בכתיבה ליומן בלבד — הנתונים המקומיים
   ממשיכים לעבוד בדיוק כמו לפני שהמודול הזה נולד.

   פתרון התנגשויות: לכל רשומה יש updatedAt. בהתנגשות מנצח החדש יותר.
   =================================================================== */

import * as db from './db.js';
import { currentUser, fetchRecords, putRecord } from './auth.js';

/* מתי כל מפתח עודכן אצלנו — כדי לדעת אם הענן חדש יותר או ישן יותר */
const META_KEY = '__syncMeta';

/* הגדרות שאין טעם לסנכרן: מצב רגעי של המכשיר הזה, לא נתונים אישיים */
const LOCAL_ONLY = new Set([
  'activeWorkout',   // אימון שרץ עכשיו על המכשיר הזה
  META_KEY,
]);

let enabled = false;
let queue = new Map();   // key -> value שממתין לדחיפה
let flushTimer = null;

/* ---------- עזר ---------- */

async function readMeta() {
  try { return (await db.getSetting(META_KEY, null)) || {}; }
  catch { return {}; }
}

async function writeMeta(meta) {
  try { await db.put(db.STORES.settings, { key: META_KEY, value: meta }); }
  catch { /* לא קריטי */ }
}

/** מזהה הרשומה בענן. מקודד כדי שמפתח עם תווים חריגים לא ישבור נתיב */
function recordId(key) {
  return 'settings__' + encodeURIComponent(key);
}

/* ---------- דחיפה ---------- */

/*
 * שינויים נצברים ונשלחים יחד. בלי זה, מסך שמעדכן כמה הגדרות ברצף
 * היה יורה סדרת כתיבות לרשת — וכתיבות הן המשאב המוגבל אצל Firebase.
 */
function scheduleFlush() {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, 900);
}

async function flush() {
  if (!enabled || !queue.size) return;
  const pending = queue;
  queue = new Map();

  const meta = await readMeta();
  for (const [key, value] of pending) {
    const updatedAt = Date.now();
    try {
      await putRecord(recordId(key), { store: 'settings', key, value, updatedAt });
      meta[key] = updatedAt;
    } catch (err) {
      console.warn('[Ori Fitness] סנכרון לענן נכשל:', key, err?.code || err);
      // מחזירים לתור כדי לנסות שוב בהזדמנות הבאה, אלא אם כבר נכתב מאז
      if (!queue.has(key)) queue.set(key, value);
    }
  }
  await writeMeta(meta);
}

/** נקרא מ-db.js בכל שמירת הגדרה */
function onLocalChange(key, value) {
  if (!enabled || LOCAL_ONLY.has(key)) return;
  queue.set(key, value);
  scheduleFlush();
}

/* ---------- משיכה ---------- */

/**
 * מושך מהענן ומחיל רק מה שחדש ממה שיש כאן.
 * @returns {Promise<number>} כמה הגדרות התעדכנו בפועל
 */
async function pull() {
  const records = await fetchRecords();
  const meta = await readMeta();
  let applied = 0;

  for (const rec of records) {
    if (rec.store !== 'settings' || !rec.key || LOCAL_ONLY.has(rec.key)) continue;
    const localAt = meta[rec.key] ?? 0;
    // שווה בדיוק אינו "חדש יותר" — אחרת כל טעינה הייתה כותבת מחדש לחינם
    if (!(rec.updatedAt > localAt)) continue;
    await db.put(db.STORES.settings, { key: rec.key, value: rec.value });
    meta[rec.key] = rec.updatedAt;
    applied++;
  }

  await writeMeta(meta);
  return applied;
}

/* ---------- הפעלה ---------- */

/**
 * מפעיל את הסנכרון. נקרא אחרי שהמשתמש אושר ומסד הנתונים נפתח.
 * @param {() => void} [onPulled] רענון מסכים אחרי שנמשכו שינויים
 * @returns {Promise<{ok: boolean, applied?: number, reason?: string}>}
 */
export async function initCloud(onPulled) {
  if (!currentUser()?.uid) return { ok: false, reason: 'לא מחובר' };

  db.watchSettings(onLocalChange);
  enabled = true;

  try {
    const applied = await pull();
    if (applied) onPulled?.();

    // חוזרים לאפליקציה — מושכים שוב, כי ייתכן ששינית משהו במכשיר אחר
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      pull().then((n) => { if (n) onPulled?.(); }).catch(() => {});
    });

    return { ok: true, applied };
  } catch (err) {
    console.warn('[Ori Fitness] משיכה מהענן נכשלה:', err?.code || err);
    // נשארים פעילים: דחיפות עדיין ינוסו, והאפליקציה עובדת מקומית כרגיל
    return { ok: false, reason: err?.code || 'שגיאה' };
  }
}

/** דחיפה מיידית של מה שממתין — לפני שהאפליקציה נסגרת */
export async function flushNow() {
  clearTimeout(flushTimer);
  await flush().catch(() => {});
}
