/* ===================================================================
   sw.js — Service Worker: מטמון מלא לעבודה אופליין.
   העלה את CACHE_VERSION בכל שחרור גרסה כדי לרענן קבצים.
   =================================================================== */

const CACHE_VERSION = 'ori-fitness-v54';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './js/db.js',
  './js/ui.js',
  './js/charts.js',
  './js/workouts.js',
  './js/records.js',
  './js/nutrition.js',
  './js/dashboard.js',
  './js/progress.js',
  './js/bodyweight.js',
  './js/routines.js',
  './js/cardio.js',
  './js/mealplan.js',
  './js/backup.js',
  './js/settings.js',
  './js/onboarding.js',
  './js/challenge.js',
  './js/badges.js',
  './js/gate.js',
  './js/firebase-config.js',
  './js/auth.js',
  './js/admin.js',
  './js/barcode.js',
  './js/cloud.js',
  './js/snacks.js',
  './icons/logo.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // addAll נכשל אם קובץ אחד חסר — מוסיפים אחד-אחד כדי להיות עמידים
    await Promise.all(APP_SHELL.map((url) =>
      cache.add(new Request(url, { cache: 'reload' })).catch((err) =>
        console.warn('[SW] לא נטען למטמון:', url, err))));
    /*
     * אין כאן skipWaiting בכוונה. גרסה חדשה ממתינה עד שהמשתמש מאשר,
     * ואז app.js שולח SKIP_WAITING. אם היינו משתלטים מיד, החלפה של
     * קוד מתחת לדף שכבר רץ עלולה לתפוס אותו באמצע פעולה — למשל
     * באמצע אימון פעיל.
     */
  })());
});

// אישור מהמשתמש: מעכשיו הגרסה החדשה משתלטת, ו-app.js ירענן
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // בקשות חיצוניות (שלב 4) עוברות כרגיל

  /*
   * ניווטים: מהמטמון קודם, ורענון ברקע לפעם הבאה.
   *
   * קודם זה היה רשת-קודם, וזה מה שגרם לאפליקציה להיפתח לאט: כל פתיחה
   * חיכתה לרשת לפני שהוצג משהו, וברשת סלולרית זה שניות של מסך ריק
   * בכל פעם מחדש. גרסה חדשה לא הולכת לאיבוד בגלל זה — היא נכנסת דרך
   * מנגנון העדכון של ה-Service Worker ופס ה"יש גרסה חדשה".
   */
  if (req.mode === 'navigate') {
    /*
     * רק שורש האפליקציה נשמר כ-index.html.
     *
     * בלי הבדיקה הזו כל דף HTML אחר באותו דומיין — למשל קובץ האימות
     * של גוגל — היה נשמר תחת index.html ומוגש בפעם הבאה במקום
     * האפליקציה. זה קרה בפועל בבדיקה: פתיחת האפליקציה החזירה את
     * תוכן קובץ האימות.
     */
    const scope = new URL('./', self.location).pathname;
    const isAppRoot = url.pathname === scope || url.pathname === scope + 'index.html';
    if (!isAppRoot) return;   // דף אחר בדומיין — לא נוגעים בו בכלל

    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match('./index.html');
      const network = fetch(req).then((res) => {
        if (res && res.ok) cache.put('./index.html', res.clone());
        return res;
      }).catch(() => null);
      return cached || (await network)
        || new Response('אופליין', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    })());
    return;
  }

  /*
   * קוד האפליקציה (JS/CSS/JSON): מהמטמון של הגרסה הזו, בלי רשת בכלל.
   *
   * זה מה שהופך פתיחה למיידית — שלושים קבצי קוד שלא נמשכים שוב ברשת
   * בכל פעם. חשוב לא פחות: כל הקבצים מגיעים מאותה גרסה. ברשת-קודם
   * אפשר היה לקבל חצי קבצים חדשים וחצי ישנים באותה טעינה.
   * החלפת גרסה נעשית במקום אחד בלבד — התקנת Service Worker חדש.
   */
  const isCode = /\.(js|mjs|css|json|webmanifest)$/i.test(url.pathname);
  if (isCode) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(req);
      if (cached) return cached;
      // קובץ שאינו ב-APP_SHELL (או מטמון שנוקה) — פעם אחת מהרשת, ונשמר
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) cache.put(req, fresh.clone());
        return fresh;
      } catch {
        return new Response('', { status: 504 });
      }
    })());
    return;
  }

  // נכסים סטטיים (תמונות, אייקונים): מטמון קודם, ורענון ברקע
  event.respondWith((async () => {
    const cached = await caches.match(req);
    const network = fetch(req).then(async (res) => {
      if (res && res.ok) {
        const cache = await caches.open(CACHE_VERSION);
        cache.put(req, res.clone());
      }
      return res;
    }).catch(() => null);

    return cached || (await network) || new Response('', { status: 504 });
  })());
});
