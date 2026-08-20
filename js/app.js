/* ===================================================================
   app.js — נקודת הכניסה: ניווט בין מסכים, אתחול מודולים,
   ורישום Service Worker לעבודה אופליין.
   =================================================================== */

import * as db from './db.js';
import { $, $$, toast, initSheet, setAutoAdvanceMs, AUTO_ADVANCE_DEFAULT_MS, dateKey } from './ui.js';
import { initCardio, renderCardio, invalidateCardioCache } from './cardio.js';
import { initWorkouts, startWorkout, hasActiveWorkout, renderHistory, getAllWorkouts } from './workouts.js';
import {
  initNutrition, renderNutrition, invalidateGoalsCache, resetToToday, currentNutritionDate,
} from './nutrition.js';
import { initBarcode } from './barcode.js';
import { initSnacks, openSnacksSheet } from './snacks.js';
import {
  initDashboard, renderStats, renderQuote, renderGreeting, advanceRotation,
  currentQuote, renderGoals, invalidatePersonalGoalsCache,
} from './dashboard.js';
import { initProgress, renderProgress } from './progress.js';
import { initBodyWeight, renderBodyWeight, invalidateWeightCache, getWeightEntries } from './bodyweight.js';
import { initReminders, renderReminders } from './reminders.js';
import { renderChallengeWidget, invalidateChallengeCache } from './challenge.js';
import { initRoutines, renderPlan, invalidateRoutinesCache, getRoutines, getSchedule } from './routines.js';
import { initMealPlan, invalidatePlanCache } from './mealplan.js';
import { initBackup, renderBackupInfo } from './backup.js';
import { initSettingsScreen, renderSettings } from './settings.js';
import {
  initOnboarding, shouldRunWizard, openWizard, rerunWizard, closeWizardIfDone,
} from './onboarding.js';
import { initGate } from './gate.js';
import { initCloud, flushNow } from './cloud.js';

const SCREENS = ['home', 'workout', 'nutrition', 'progress', 'settings'];
let currentScreen = 'home';

/* ---------- ניווט ---------- */

/*
 * fromHistory=true כשההגעה היא מלחיצה על "חזור" של המכשיר — אז אסור לרשום
 * רשומה חדשה בהיסטוריה, אחרת נוצרת לולאה ואי אפשר לצאת מהמסך.
 */
function showScreen(name, fromHistory = false, slideFrom = null) {
  if (!SCREENS.includes(name)) name = 'home';
  currentScreen = name;

  for (const s of SCREENS) {
    $(`#screen-${s}`).classList.toggle('hidden', s !== name);
  }

  /*
   * המסך הנכנס מחליק מהכיוון שאליו האצבע זזה. זה קיים רק להחלקה
   * ולא ללחיצה על לשונית: בלחיצה אין כיוון, ואנימציה שרירותית שם
   * רק מאטה את המעבר.
   */
  const entering = $(`#screen-${name}`);
  entering.classList.remove('slide-left', 'slide-right');
  if (slideFrom) {
    // הפעלה מחדש של האנימציה גם כשמחליקים פעמיים לאותו כיוון
    void entering.offsetWidth;
    entering.classList.add(slideFrom === 'left' ? 'slide-left' : 'slide-right');
  }
  for (const tab of $$('.tab')) {
    tab.classList.toggle('active', tab.dataset.screen === name);
  }
  $('#settingsBtn').classList.toggle('is-active', name === 'settings');
  window.scrollTo({ top: 0 });

  // רענון תוכן שתלוי בנתונים ממסכים אחרים
  if (name === 'home') { renderStats(); renderGreeting(); renderChallengeWidget(); }
  if (name === 'workout' && !hasActiveWorkout()) { renderPlan(); renderCardio(); }
  if (name === 'nutrition') { renderNutrition(); }
  if (name === 'progress') { renderProgress(); renderBodyWeight(); }
  if (name === 'settings') { renderSettings(); renderBackupInfo(); }

  /*
   * מסך הבית הוא תמיד הבסיס: הוא מחליף את הרשומה הנוכחית, וכל מסך אחר
   * נדחף מעליו. כך "חזור" במכשיר מחזיר למסך הקודם ורק מהבית יוצא
   * מהאפליקציה — בדיוק כמו באפליקציה מותקנת, ולא סוגר אותה מכל מסך.
   */
  if (!fromHistory) {
    const entry = { screen: name };
    if (name === 'home') history.replaceState(entry, '', '#' + name);
    else history.pushState(entry, '', '#' + name);
  }
}

/* ---------- החלקה בין מסכים ---------- */

/*
 * סדר ההחלקה הוא סדר הלשוניות על המסך, לא סדר המערך SCREENS.
 * ההגדרות אינן ברשימה בכוונה: הן נפתחות מגלגל השיניים ואינן חלק
 * מהמסלול שעוברים בו באצבע.
 */
const SWIPE_ORDER = ['home', 'nutrition', 'workout', 'progress'];

/* מרחק מינימלי, ויחס מול התנועה האנכית — בלי היחס הזה כל גלילה
   אלכסונית של רשימה ארוכה הייתה מחליפה מסך בטעות */
const SWIPE_MIN_PX = 60;
const SWIPE_RATIO = 1.7;
const SWIPE_MAX_MS = 700;

/** מקומות שבהם החלקה אופקית שייכת למשהו אחר ואסור לחטוף אותה */
function swipeBlocked(target) {
  if (!(target instanceof Element)) return false;
  return !!target.closest(
    '#sheet, .bc-scanner, .wizard, .gate, input, textarea, select, .lightbox, [data-no-swipe]');
}

function initSwipeNav() {
  let x0 = 0, y0 = 0, t0 = 0, tracking = false;

  addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || swipeBlocked(e.target)) { tracking = false; return; }
    const t = e.touches[0];
    x0 = t.clientX; y0 = t.clientY; t0 = Date.now(); tracking = true;
  }, { passive: true });

  addEventListener('touchend', (e) => {
    if (!tracking) return;
    tracking = false;

    const t = e.changedTouches[0];
    const dx = t.clientX - x0;
    const dy = t.clientY - y0;
    if (Date.now() - t0 > SWIPE_MAX_MS) return;
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return;

    const i = SWIPE_ORDER.indexOf(currentScreen);
    if (i === -1) return;   // הגדרות או מסך שאינו במסלול

    /*
     * הממשק בעברית, ולכן הלשונית הראשונה יושבת מימין. החלקה שמאלה
     * מתקדמת ברשימה — כלומר לכיוון שאליו האצבע זזה, וזו ההתנהגות
     * שמרגישה נכונה ולא הפוכה.
     */
    const next = SWIPE_ORDER[dx < 0 ? i + 1 : i - 1];
    if (!next) return;

    showScreen(next, false, dx < 0 ? 'left' : 'right');
  }, { passive: true });
}

function initNav() {
  for (const tab of $$('.tab')) {
    tab.addEventListener('click', () => showScreen(tab.dataset.screen));
  }
  initSwipeNav();
  // צ'יפ הטיימר העליון מקפיץ למסך האימון
  $('#liveTimerChip').addEventListener('click', () => showScreen('workout'));
  $('#settingsBtn').addEventListener('click', () =>
    showScreen(currentScreen === 'settings' ? 'home' : 'settings'));

  // כפתור "חזור" של המכשיר — מנווט בין מסכים במקום לסגור את האפליקציה
  window.addEventListener('popstate', (e) => {
    const target = (e.state && e.state.screen) || location.hash.replace('#', '') || 'home';
    showScreen(target, true);
  });

  const fromHash = location.hash.replace('#', '');
  showScreen(SCREENS.includes(fromHash) ? fromHash : 'home');
}

/* ---------- מעבר יום ---------- */

/*
 * האפליקציה נשארת פתוחה ימים שלמים (חלון על שולחן העבודה, לשונית בטלפון).
 * בלי המעקב הזה "היום" נקבע פעם אחת בטעינה, וב-00:00 המסך היה ממשיך להציג
 * את התאריך של אתמול — כולל הווי-ים על הארוחות.
 */
let watchedDay = dateKey();

async function checkDayRollover() {
  const today = dateKey();
  if (today === watchedDay) return;
  watchedDay = today;

  await resetToToday();          // יומן התזונה חוזר להיום
  await renderPlan();            // האימון המשובץ ליום החדש
  await renderCardio();          // הסימונים של האירובי מתאפסים
  await advanceRotation();       // ציטוט ותמונה חדשים ליום חדש
  await renderQuote();
  await renderStats();
  await renderChallengeWidget(); // יום חדש = "יום X" חדש, וסימון ה-✓/✗ של אתמול לא תקף היום
  if (currentScreen === 'nutrition') await renderNutrition();
  if (currentScreen === 'progress') { await renderProgress(); await renderBodyWeight(); }
  await renderReminders();
}

function initDayWatcher() {
  // כשחוזרים לאפליקציה, וגם מדי דקה למקרה שהיא פשוט פתוחה על המסך
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDayRollover(); });
  window.addEventListener('focus', checkDayRollover);
  setInterval(checkDayRollover, 60000);
}

/* ---------- ערכת נושא ---------- */

const THEME_KEY = 'theme';

function applyTheme(value) {
  const root = document.documentElement;
  if (value === 'light' || value === 'dark') root.setAttribute('data-theme', value);
  else root.removeAttribute('data-theme');   // 'system' — הולך לפי המכשיר
  // צובעים את סרגלי המערכת (מד סטטוס וכו') בצבע הרקע הפעיל
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
  $('meta[name="theme-color"]')?.setAttribute('content', bg || '#f4efe4');
}

async function initThemeSetting() {
  /*
   * ברירת המחדל היא "לפי המכשיר" ולא "בהיר".
   *
   * קודם האפליקציה נפתחה בקרם בהיר גם בשתיים בלילה, כשכל שאר הטלפון
   * כבר במצב כהה — וזה אומר שכדי להתאמן בערב צריך לזכור להיכנס
   * להגדרות ולהחליף ידנית, ואז להחליף בחזרה בבוקר. הטלפון כבר יודע
   * אם עכשיו לילה; אין סיבה לשאול על זה שוב.
   *
   * מי שכבר בחר ידנית — הבחירה שלו שמורה וגוברת, כאן ובהמשך.
   */
  const saved = await db.getSetting(THEME_KEY, 'system');
  applyTheme(saved);

  const select = $('#themeSelect');
  select.value = saved;

  /*
   * כפתור הירח בראש המסך.
   *
   * ההגדרה כבר הייתה קיימת, אבל היא קבורה בתוך מסך ההגדרות — ובלילה,
   * כשרוצים להחשיך מסך, זה שלוש פעולות במקום אחת. הכפתור הזה הופך את
   * זה ללחיצה אחת מכל מסך, ומסונכרן עם הבורר בהגדרות לשני הכיוונים.
   */
  const themeBtn = $('#themeBtn');

  /** האם המסך כרגע כהה בפועל — כולל המקרה של "לפי המכשיר" */
  const isDarkNow = () => document.documentElement.getAttribute('data-theme') === 'dark'
    || (!document.documentElement.hasAttribute('data-theme')
        && matchMedia('(prefers-color-scheme: dark)').matches);

  function refreshThemeBtn() {
    if (!themeBtn) return;
    const dark = isDarkNow();
    // הכפתור מראה לאן הוא ייקח אותך, לא איפה אתה נמצא
    themeBtn.textContent = dark ? '☀️' : '🌙';
    themeBtn.setAttribute('aria-label', dark ? 'מצב יום' : 'מצב לילה');
  }

  async function setTheme(value) {
    applyTheme(value);
    select.value = value;
    refreshThemeBtn();
    await db.setSetting(THEME_KEY, value);
    // הגרפים מציירים את הצבעים שלהם פעם אחת - צריך רינדור מחדש כדי שיתעדכנו
    if (currentScreen === 'progress') renderProgress();
  }

  themeBtn?.addEventListener('click', () => setTheme(isDarkNow() ? 'light' : 'dark'));
  select.addEventListener('change', () => setTheme(select.value));

  // "לפי המכשיר" — הטלפון עובר ללילה וגם האפליקציה, בלי לרענן
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (select.value === 'system') { applyTheme('system'); refreshThemeBtn(); }
  });

  refreshThemeBtn();
}

/* ---------- הגדרות ---------- */

const AUTO_ADVANCE_KEY = 'autoAdvanceMs';

async function initBehaviourSettings() {
  const saved = await db.getSetting(AUTO_ADVANCE_KEY, AUTO_ADVANCE_DEFAULT_MS);
  setAutoAdvanceMs(saved);

  const select = $('#autoAdvanceSelect');
  select.value = String(saved);
  // אם הערך השמור לא ברשימה, נופלים לברירת המחדל כדי שהתפריט לא יופיע ריק
  if (!select.value) select.value = String(AUTO_ADVANCE_DEFAULT_MS);

  select.addEventListener('change', async () => {
    const ms = Number(select.value);
    setAutoAdvanceMs(ms);
    await db.setSetting(AUTO_ADVANCE_KEY, ms);
    toast(ms === 0 ? 'הקפיצה האוטומטית כבויה' : 'נשמר', 'ok');
  });
}

/* ---------- Service Worker ---------- */

async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  // file:// לא תומך ב-Service Worker — נדלג בשקט
  if (location.protocol === 'file:') {
    console.warn('[Ori Fitness] Service Worker לא נטען מ-file:// — הרץ דרך שרת מקומי או GitHub Pages');
    return;
  }
  // דומיין טאנל זמני (בדיקה מהנייד) — מדלגים בכוונה: המטמון רק עלול להקפיא גרסה
  // חלקית/שבורה אם הרשת נתקעת באמצע הבדיקה, וזה ממילא דומיין חד-פעמי.
  if (location.hostname.endsWith('.lhr.life')) {
    console.warn('[Ori Fitness] Service Worker דולג — דומיין טאנל זמני:', location.hostname);
    return;
  }
  try {
    const reg = await navigator.serviceWorker.register('sw.js');

    // גרסה שכבר סיימה להיטען וממתינה מרגע הפתיחה
    if (reg.waiting && navigator.serviceWorker.controller) showUpdateBar(reg.waiting);

    reg.addEventListener('updatefound', () => {
      const incoming = reg.installing;
      if (!incoming) return;
      incoming.addEventListener('statechange', () => {
        /*
         * התנאי על controller הוא מה שמונע את ההודעה בהתקנה הראשונה:
         * שם אין גרסה קודמת להחליף, ו"יש עדכון" היה סתם מבלבל.
         */
        if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
          showUpdateBar(incoming);
        }
      });
    });

    // בדיקה מחדש בכל חזרה לאפליקציה — אחרת גרסה חדשה מתגלה רק
    // בטעינה מלאה, וזה בדיוק המצב שבו נראה כאילו התיקון לא הגיע
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });

    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;   // controllerchange יכול לירות יותר מפעם אחת
      reloading = true;
      location.reload();
    });
  } catch (err) {
    console.warn('[Ori Fitness] רישום Service Worker נכשל:', err);
  }
}

/*
 * הודעת "יש גרסה חדשה".
 *
 * זמנית ומכוונת לתקופת הפיתוח: כשאני דוחף תיקון, האפליקציה המותקנת
 * ממשיכה להריץ את הגרסה השמורה עד סגירה ופתיחה מלאה — וזה נראה בדיוק
 * כמו תיקון שלא עבד. **כשהאפליקציה תהיה גמורה ותפסיק להשתנות כל יום,
 * להסיר את המקטע הזה ואת #updateBar.**
 */
function showUpdateBar(worker) {
  const bar = $('#updateBar');
  const btn = $('#updateBtn');
  if (!bar || !btn) return;
  bar.classList.remove('hidden');
  btn.onclick = () => {
    btn.disabled = true;
    btn.textContent = 'מרענן…';
    worker.postMessage({ type: 'SKIP_WAITING' });
  };
}

/* ---------- רענון אחרי סנכרון ---------- */

/*
 * נקרא כשהענן הביא נתונים ממכשיר אחר. כל מודול מחזיק מטמון משלו,
 * ולכן לא מספיק לצייר מחדש — צריך קודם לבטל את המטמונים, אחרת
 * המסך יצייר בדיוק את מה שהיה לפני.
 */
async function refreshFromCloud() {
  invalidateGoalsCache();
  invalidatePersonalGoalsCache();
  invalidateChallengeCache();
  invalidateRoutinesCache();
  invalidatePlanCache();
  invalidateCardioCache();
  invalidateWeightCache();

  await renderGreeting();
  await renderStats();
  await renderGoals();
  await renderChallengeWidget();
  await renderPlan();
  await renderCardio();
  await renderHistory();
  await renderNutrition();
  await renderBodyWeight();
  await renderProgress();
  if (currentScreen === 'settings') await renderSettings();
  await closeWizardIfDone();
}

/* ---------- אתחול ---------- */

async function main() {
  // נרשם לפני השער ולא בסוף: כך גם מסך הכניסה עצמו נשמר לאופליין.
  // אחרת משתמש שנתקע בלי רשת לפני שהתחבר לא היה מקבל כלום.
  registerSW();

  /*
   * מסד הנתונים המקומי מתחיל להיפתח כבר עכשיו, במקביל לשער ולא אחריו.
   * הוא לא תלוי בתשובת השרת, ואין סיבה שהמתנה לרשת תעכב עבודה
   * מקומית שיכולה לרוץ בינתיים. הנתונים עדיין לא מוצגים לפני אישור —
   * רק ההכנה מקדימה.
   */
  const dbReady = db.openDB();
  dbReady.catch(() => {});   // הטיפול בשגיאה נעשה למטה, אחרי השער

  const mayEnter = await initGate();
  if (!mayEnter) return;

  try {
    await dbReady;
  } catch (err) {
    console.error(err);
    // אחרי עדכון גרסה של מסד הנתונים, חלון ישן שנשאר פתוח מונע מהחלון
    // הזה לשדרג — ההודעה הספציפית (err.message) אומרת בדיוק את זה,
    // ולא כדאי לטשטש אותה בהודעה כללית
    toast(err.message || 'לא ניתן לפתוח את מסד הנתונים המקומי', 'err', 7000);
    return;
  }

  // מבקשים אחסון מתמיד כדי שהדפדפן לא ימחק נתונים בלחץ מקום
  db.requestPersistence().catch(() => {});

  initSheet();
  await initThemeSetting();
  await initBehaviourSettings();

  await initWorkouts({
    onSaved: () => {
      renderStats();
      renderPlan();
      if (currentScreen === 'progress') renderProgress();
    },
    getReminder: currentQuote,
  });
  initMealPlan({ onUpdate: () => renderNutrition() });
  await initNutrition({
    onUpdate: () => { if (currentScreen === 'home') renderStats(); },
  });
  // מוסיפים לתאריך שמוצג במסך התזונה, לא בהכרח היום — אפשר לרשום
  // מוצר גם כשגוללים אחורה ליום קודם
  const foodAdded = async () => {
    await renderNutrition();
    if (currentScreen === 'home') renderStats();
  };
  initBarcode({ currentDate: currentNutritionDate, onAdded: foodAdded });
  initSnacks({ currentDate: currentNutritionDate, onAdded: foodAdded });
  $('#snacksBtn')?.addEventListener('click', openSnacksSheet);
  await initRoutines({
    onStartWorkout: async (routine) => {
      showScreen('workout');
      if (!hasActiveWorkout()) await startWorkout(routine);
    },
    onUpdate: () => { if (currentScreen === 'home') renderStats(); },
    isDoneToday: async (routineId) => {
      const workouts = await getAllWorkouts();
      const today = dateKey();
      return workouts.some((w) => w.date === today && w.routineId === routineId);
    },
    isDoneOnDate: async (routineId, date) => {
      const workouts = await getAllWorkouts();
      return workouts.some((w) => w.date === date && w.routineId === routineId);
    },
  });
  initCardio({ onUpdate: () => { renderStats(); renderHistory(); } });
  await renderCardio();
  await initDashboard({
    // "התחל אימון" מהבית עובר למסך האימון ומציג בדיוק את מה שמוצג שם —
    // אימון פעיל אם יש, אחרת כרטיס הבחירה של היום (המשובץ, או רשימת
    // התוכניות אם לא שיבצת). לא מתחילים כלום מאחורי הגב.
    onStartWorkout: () => showScreen('workout'),
  });
  initBackup({
    onImported: async () => {
      // אחרי ייבוא צריך לרענן הכל — הנתונים השתנו מתחת לכל המסכים.
      // קודם מאפסים מטמונים, אחרת המסכים יציירו את המצב הישן.
      invalidateRoutinesCache();
      invalidatePlanCache();
      invalidateGoalsCache();
      invalidateCardioCache();
      invalidateWeightCache();
      invalidatePersonalGoalsCache();
      invalidateChallengeCache();
      await renderHistory();
      await renderPlan();
      await renderCardio();
      await renderNutrition();
      await renderStats();
      await renderBackupInfo();
      await renderSettings();
      await renderQuote();
      await renderGoals();
      await renderChallengeWidget();
      if (currentScreen === 'progress') { renderProgress(); renderBodyWeight(); }
    },
  });
  initProgress();
  initBodyWeight();

  initReminders({
    getWeightEntries,
    getRoutines,
    getSchedule,
    isDoneToday: async (routineId) => {
      const workouts = await getAllWorkouts();
      const today = dateKey();
      return workouts.some((w) => w.date === today && w.routineId === routineId);
    },
    startWorkout: async (routine) => {
      showScreen('workout');
      if (!hasActiveWorkout()) await startWorkout(routine);
    },
    goToWeighIn: () => {
      showScreen('progress');
      // ממקדים את שדה המשקל אחרי שהמסך כבר מוצג, אחרת אין למה למקד
      setTimeout(() => $('#weightInput')?.focus(), 150);
    },
  });
  await renderReminders();

  initSettingsScreen({
    onRerun: () => rerunWizard(),
    onCloudRefresh: refreshFromCloud,
  });
  initOnboarding({
    onDone: async () => {
      invalidateRoutinesCache();
      invalidatePlanCache();
      invalidateGoalsCache();
      invalidateCardioCache();
      await renderPlan();
      await renderCardio();
      await renderNutrition();
      await renderSettings();
      await renderStats();
      await renderGreeting();
      showScreen('workout');
    },
  });

  initNav();
  initDayWatcher();

  if (await shouldRunWizard()) openWizard();

  /*
   * הסנכרון עולה אחרון ובלי await לפניו: הוא תלוי ברשת, ואסור שהוא
   * יעכב את הצגת האפליקציה. אם הוא נכשל — לא קורה כלום, הכל מקומי.
   *
   * מכיוון שעכשיו יורדים גם אימונים וארוחות, ולא רק הגדרות, הרענון
   * חייב לגעת בכל המסכים — אחרת נתון חדש יושב במסד ולא על המסך.
   */
  initCloud(refreshFromCloud).then((res) => {
    if (res.ok && res.applied) toast(`התקבלו ${res.applied} עדכונים ממכשיר אחר`, 'ok');
  });

  // סגירת האפליקציה לא אמורה לאבד שינוי שנרשם שנייה קודם
  addEventListener('pagehide', () => { flushNow(); });
}

document.addEventListener('DOMContentLoaded', main);
