/* ===================================================================
   sw.js — Service Worker: מטמון מלא לעבודה אופליין.
   העלה את CACHE_VERSION בכל שחרור גרסה כדי לרענן קבצים.
   =================================================================== */

const CACHE_VERSION = 'ori-fitness-v35';

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
    self.skipWaiting();
  })());
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

  // ניווטים: רשת קודם, ואם אין אינטרנט — index.html מהמטמון
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_VERSION);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch {
        const cached = await caches.match('./index.html');
        return cached || new Response('אופליין', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }

  // קוד האפליקציה (JS/CSS/JSON): רשת קודם, כדי שעדכון גרסה ייכנס מיד.
  // אם אין רשת — מהמטמון, כך שהאפליקציה עדיין עובדת אופליין.
  const isCode = /\.(js|mjs|css|json|webmanifest)$/i.test(url.pathname);
  if (isCode) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
          const cache = await caches.open(CACHE_VERSION);
          cache.put(req, fresh.clone());
        }
        return fresh;
      } catch {
        const cached = await caches.match(req);
        return cached || new Response('', { status: 504 });
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
