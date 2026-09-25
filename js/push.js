/* ===================================================================
   push.js — הרשמה להתראות דחיפה (Web Push).

   מה שקורה כאן: מבקשים הרשאה, ונרשמים אצל הדפדפן לקבלת push עם
   המפתח הציבורי (VAPID). המנוי שחוזר מהדפדפן נשמר כהגדרה רגילה —
   ולכן הוא כבר מסתנכרן לענן דרך אותו מנגנון שכל שאר ההגדרות
   משתמשות בו (cloud.js), בלי קוד סנכרון נוסף.

   מה שלא קורה כאן: שום שליחה בפועל. זה קורה מחוץ לאפליקציה לגמרי —
   ב-GitHub Action מתוזמן (ראה .github/workflows/push-reminders.yml
   וה-script שהוא מריץ) שקורא את אותו מנוי מהענן ושולח כשיש מה
   להזכיר. בלי שרת משלנו, וזה החלק היחיד שבאמת דרש אחד.

   המפתח הפרטי המתאים לא נמצא כאן ולא בשום קובץ בריפו — הוא חי רק
   כ-secret ב-GitHub Actions. המפתח הציבורי מותר וצריך להיות גלוי.
   =================================================================== */

import * as db from './db.js';
import { toast } from './ui.js';

export const VAPID_PUBLIC_KEY =
  'BLA57QxQ4QDnk1fVsCw2cKpQhrB2ntI039LVIIFDHroKcYCJOIxuwB4VwND-Kaq5UPxCAV60utogpMd9P0jU3lI';

/*
 * מנוי נפרד לכל מכשיר, ומסתנכרן לענן — הסקריפט ב-GitHub Action קורא
 * אותו משם. ההיסטוריה של זה: קודם היה מפתח יחיד ('pushSubscription')
 * שהסתנכרן, וכך מכשיר ב' שנכנס להגדרות "גנב" או מחק את המנוי של
 * מכשיר א'. הפתרון הראשון (להפוך אותו למקומי בלבד) שבר את השליחה
 * בכלל: הסקריפט לא מוצא מנוי בענן. לכן: מפתח לכל מכשיר, כך שאף מכשיר
 * לא נוגע במנוי של אחר, והכל עדיין עולה לענן.
 * המפתח הישן נשאר רק כתאימות לאחור — הסקריפט עדיין קורא אותו.
 */
const SUB_PREFIX = 'pushSub_';

let memoryDeviceId = null;   // כש-localStorage חסום: מזהה ייחודי לריצה הזו, לא קבוע משותף
/** מזהה קבוע למכשיר/דפדפן הזה. לא מסתנכרן — זה בדיוק העניין */
function deviceId() {
  try {
    let id = localStorage.getItem('oriDeviceId');
    if (!id) { id = db.uid(); localStorage.setItem('oriDeviceId', id); }
    return id;
  } catch {
    // מזהה קבוע ('nodevice') היה משותף לכל מכשיר כזה בחשבון, והם היו
    // דורסים ומוחקים זה לזה את המנוי - בדיוק מה שהמפתח לכל מכשיר בא למנוע
    return memoryDeviceId ??= db.uid();
  }
}
const subKey = () => SUB_PREFIX + deviceId();

export function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function pushPermission() {
  return isPushSupported() ? Notification.permission : 'unsupported';
}

export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isInstalledApp = () => navigator.standalone === true
  || matchMedia('(display-mode: standalone)').matches;

/**
 * מצב ההתראות במכשיר הזה, במקום אחד לכל מי שצריך להציג אותו (כרטיס הבית,
 * הגיליון של הכניסה הראשונה, שלב בשאלון):
 *  'ios-install' - אייפון בלשונית ספארי, צריך להוסיף למסך הבית
 *  'unsupported' - דפדפן שלא תומך בכלל
 *  'denied'      - נחסם, אי אפשר לבקש שוב מתוך האפליקציה
 *  'subscribed'  - כבר מופעל
 *  'available'   - אפשר להפעיל עכשיו (לחיצה => חלון אישור)
 */
export async function pushStatus() {
  if (!isPushSupported()) return isIOS() && !isInstalledApp() ? 'ios-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return (await hasPushSubscription()) ? 'subscribed' : 'available';
}

/** VAPID דורש את המפתח כ-Uint8Array, לא כמחרוזת */
function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(safe);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function hasPushSubscription() {
  return !!(await db.getSetting(subKey(), null));
}

/**
 * מיישר את מה ששמור אצלנו עם מה שהדפדפן באמת מחזיק, בכל פתיחה:
 * - יש מנוי בדפדפן ואין שמור (מכשיר שהופעל עוד לפני המפתח לכל מכשיר,
 *   או ניקוי נתונים) — שומרים, וזה גם מעלה אותו לענן.
 * - יש שמור ואין בדפדפן (המערכת ביטלה) — מוחקים, כדי שלא נציג "פעיל"
 *   על משהו שלא קיים.
 * לא מבקש הרשאה בשום מקרה — רק מסתכל.
 */
export async function syncPushSubscription() {
  if (!isPushSupported() || Notification.permission !== 'granted') return;
  try {
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, rej) => setTimeout(() => rej(new Error('sw-timeout')), 4000)),
    ]);
    const sub = await reg.pushManager.getSubscription();
    const saved = await db.getSetting(subKey(), null);
    if (sub) {
      /*
       * כותבים גם כשכבר שמור מקומית, אם ה-endpoint הזה עוד לא הועלה מהמכשיר
       * הזה: גרסאות קודמות שמרו את המפתח לפני שהסנכרון התחיל, והכתיבה לא
       * נכנסה לתור. הסימון ב-localStorage מונע כתיבה בכל פתיחה. וגם אם
       * מכשיר אחר איפס את הנתונים (מחק את הרשומה בענן ומכאן גם כאן) - חסר
       * `saved`, ונכתב מחדש.
       */
      let uploaded = null;
      try { uploaded = localStorage.getItem('pushSubUploaded'); } catch { /* חסום */ }
      if (!saved || uploaded !== sub.endpoint) {
        await db.setSetting(subKey(), sub.toJSON());
        try { localStorage.setItem('pushSubUploaded', sub.endpoint); } catch { /* לא קריטי */ }
      }
    } else if (saved) {
      await db.delSetting(subKey());
    }
  } catch { /* אין Service Worker פעיל (למשל בבדיקות) — לא קריטי */ }
}

export async function subscribeToPush() {
  if (!isPushSupported()) { toast('הדפדפן הזה לא תומך בהתראות', 'err'); return false; }

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    toast(perm === 'denied' ? 'ההרשאה נחסמה בדפדפן' : 'ההרשאה לא אושרה', 'err');
    return false;
  }

  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    await db.setSetting(subKey(), sub.toJSON());
    toast('התראות פועלות', 'ok');
    return true;
  } catch {
    toast('לא הצלחתי להפעיל התראות', 'err');
    return false;
  }
}

export async function unsubscribeFromPush() {
  if (!isPushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
  } catch { /* גם אם הביטול בדפדפן נכשל, מוחקים את המנוי מהצד שלנו */ }
  // delSetting ולא setSetting(null): מחיקה אמיתית יוצרת מצבה בענן, וכך
  // הסקריפט מפסיק לשלוח למכשיר הזה (null היה נשמר כרשומה "קיימת" ריקה)
  await db.delSetting(subKey());
  toast('התראות כבויות');
}
