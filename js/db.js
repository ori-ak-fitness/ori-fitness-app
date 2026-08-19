/* ===================================================================
   db.js — שכבת IndexedDB. המכשיר הוא מקור האמת לשימוש היומיומי.

   כל כתיבה ומחיקה מדווחות ל-cloud.js דרך watchWrites, וכך הנתונים
   מגיעים גם למכשירים האחרים. תמונות נשארות מקומיות בלבד.
   =================================================================== */

const DB_NAME = 'ori-fitness';
const DB_VERSION = 3;

export const STORES = {
  workouts:   'workouts',    // אימונים שהסתיימו
  photos:     'photos',      // גלריית מוטיבציה
  meals:      'meals',       // ארוחות
  goals:      'goals',       // יעדי תזונה לפי תאריך תחילה
  settings:   'settings',    // key/value כללי (כולל האימון הפעיל ולוח השבוע)
  routines:   'routines',    // תוכניות אימון בשם (אימון A, אימון B...)
  mealPlan:   'mealPlan',    // תפריט יומי קבוע
  bodyWeight: 'bodyWeight',  // יומן שקילות — רשומה אחת ליום (keyPath: date)
};

/*
 * שדה המזהה של כל מאגר. הסנכרון חייב לדעת איך קוראים לרשומה כדי
 * להתאים בין מכשירים, ואי אפשר להסיק את זה מהרשומה עצמה.
 */
export const KEY_FIELD = {
  [STORES.workouts]:   'id',
  [STORES.photos]:     'id',
  [STORES.meals]:      'id',
  [STORES.goals]:      'id',
  [STORES.settings]:   'key',
  [STORES.routines]:   'id',
  [STORES.mealPlan]:   'id',
  [STORES.bodyWeight]: 'date',
};

/** המזהה של רשומה במאגר נתון */
export function keyOf(store, value) {
  return value?.[KEY_FIELD[store] || 'id'];
}

let dbPromise = null;

function upgrade(db, oldVersion) {
  if (oldVersion < 1) {
    const workouts = db.createObjectStore(STORES.workouts, { keyPath: 'id' });
    workouts.createIndex('date', 'date');
    workouts.createIndex('endedAt', 'endedAt');

    const photos = db.createObjectStore(STORES.photos, { keyPath: 'id' });
    photos.createIndex('createdAt', 'createdAt');

    const meals = db.createObjectStore(STORES.meals, { keyPath: 'id' });
    meals.createIndex('date', 'date');

    const goals = db.createObjectStore(STORES.goals, { keyPath: 'id' });
    goals.createIndex('effectiveFrom', 'effectiveFrom');

    db.createObjectStore(STORES.settings, { keyPath: 'key' });
  }

  if (oldVersion < 2) {
    const routines = db.createObjectStore(STORES.routines, { keyPath: 'id' });
    routines.createIndex('order', 'order');

    const mealPlan = db.createObjectStore(STORES.mealPlan, { keyPath: 'id' });
    mealPlan.createIndex('order', 'order');
  }

  if (oldVersion < 3) {
    // keyPath הוא התאריך עצמו — שקילה נוספת באותו יום דורסת את הקודמת,
    // וגם נותנת סדר כרונולוגי חינם מ-getAll בלי צורך באינדקס נפרד
    db.createObjectStore(STORES.bodyWeight, { keyPath: 'date' });
  }
  // גרסאות עתידיות ייכנסו כאן עם oldVersion < 4 וכו'
}

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => upgrade(req.result, e.oldVersion);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('מסד הנתונים חסום — סגור לשוניות אחרות של האפליקציה'));
  });
  return dbPromise;
}

function tx(store, mode) {
  return openDB().then((db) => db.transaction(store, mode).objectStore(store));
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/* ---------- הודעה על שינוי ---------- */

/*
 * מודול הסנכרון נרשם כאן כדי לדעת על כל כתיבה ומחיקה.
 * db.js לא מייבא אותו בכוונה — כך האחסון המקומי נשאר עצמאי לגמרי,
 * וכשאין ענן (או שהוא נופל) שום דבר כאן לא משתנה.
 */
let onWrite = null;

/** @param {(store:string, key:string, value:any|null) => void} fn */
export function watchWrites(fn) { onWrite = fn; }

function notify(store, key, value) {
  if (!onWrite || key == null) return;
  // כישלון בסנכרון לעולם לא מפיל שמירה מקומית
  try { onWrite(store, key, value); } catch { /* לא קריטי */ }
}

/* ---------- פעולות בסיסיות ---------- */

export async function put(store, value) {
  const os = await tx(store, 'readwrite');
  await wrap(os.put(value));
  notify(store, keyOf(store, value), value);
  return value;
}

export async function get(store, key) {
  const os = await tx(store, 'readonly');
  return wrap(os.get(key));
}

export async function del(store, key) {
  const os = await tx(store, 'readwrite');
  const res = await wrap(os.delete(key));
  notify(store, key, null);
  return res;
}

/*
 * כתיבה ומחיקה שאינן מודיעות לסנכרון. מיועדות אך ורק להחלת מה שהגיע
 * מהענן — אחרת כל משיכה הייתה נדחפת מיד בחזרה, בלולאה אינסופית.
 */
export async function putQuiet(store, value) {
  const os = await tx(store, 'readwrite');
  await wrap(os.put(value));
  return value;
}

export async function delQuiet(store, key) {
  const os = await tx(store, 'readwrite');
  return wrap(os.delete(key));
}

export async function getAll(store) {
  const os = await tx(store, 'readonly');
  return wrap(os.getAll());
}

/** כל הרשומות לפי אינדקס וטווח, ממוינות עולה */
export async function getAllByIndex(store, indexName, query) {
  const os = await tx(store, 'readonly');
  return wrap(os.index(indexName).getAll(query ?? null));
}

export async function clearStore(store) {
  /*
   * המפתחות נאספים לפני המחיקה כדי שהסנכרון ירשום מחיקה לכל אחד.
   * בלי זה, איפוס נתונים במכשיר אחד היה נמחק כאן ומיד חוזר מהענן
   * בפתיחה הבאה — כלומר איפוס שלא מאפס.
   */
  const keys = await wrap((await tx(store, 'readonly')).getAllKeys());
  const os = await tx(store, 'readwrite');
  const res = await wrap(os.clear());
  for (const key of keys) notify(store, key, null);
  return res;
}

/* ---------- settings (key/value) ---------- */

export async function getSetting(key, fallback = null) {
  const row = await get(STORES.settings, key);
  return row ? row.value : fallback;
}

export async function setSetting(key, value) {
  return put(STORES.settings, { key, value });
}

export async function delSetting(key) {
  return del(STORES.settings, key);
}

/* ---------- עזר ---------- */

export function uid() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
}

/** בקשה לאחסון מתמיד כדי שהדפדפן לא ימחק את הנתונים */
export async function requestPersistence() {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}
