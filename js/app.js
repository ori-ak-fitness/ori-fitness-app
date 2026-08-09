/* ===================================================================
   app.js — נקודת הכניסה: ניווט בין מסכים, אתחול מודולים,
   ורישום Service Worker לעבודה אופליין.
   =================================================================== */

import * as db from './db.js';
import { $, $$, toast, initSheet, setAutoAdvanceMs, AUTO_ADVANCE_DEFAULT_MS, dateKey } from './ui.js';
import { initCardio, renderCardio, invalidateCardioCache } from './cardio.js';
import { initWorkouts, startWorkout, hasActiveWorkout, renderHistory, getAllWorkouts } from './workouts.js';
import { initNutrition, renderNutrition, invalidateGoalsCache, resetToToday } from './nutrition.js';
import {
  initDashboard, renderStats, renderQuote, renderGreeting, advanceRotation,
  currentQuote, renderGoals, invalidatePersonalGoalsCache,
} from './dashboard.js';
import { initProgress, renderProgress } from './progress.js';
import { initBodyWeight, renderBodyWeight, invalidateWeightCache, checkWeighInReminder } from './bodyweight.js';
import { renderChallengeWidget, invalidateChallengeCache } from './challenge.js';
import { initRoutines, renderPlan, invalidateRoutinesCache } from './routines.js';
import { initMealPlan, invalidatePlanCache } from './mealplan.js';
import { initBackup, renderBackupInfo } from './backup.js';
import { initSettingsScreen, renderSettings } from './settings.js';
import { initOnboarding, shouldRunWizard, openWizard, rerunWizard } from './onboarding.js';

const SCREENS = ['home', 'workout', 'nutrition', 'progress', 'settings'];
let currentScreen = 'home';

/* ---------- ניווט ---------- */

function showScreen(name) {
  if (!SCREENS.includes(name)) name = 'home';
  currentScreen = name;

  for (const s of SCREENS) {
    $(`#screen-${s}`).classList.toggle('hidden', s !== name);
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

  history.replaceState(null, '', '#' + name);
}

function initNav() {
  for (const tab of $$('.tab')) {
    tab.addEventListener('click', () => showScreen(tab.dataset.screen));
  }
  // צ'יפ הטיימר העליון מקפיץ למסך האימון
  $('#liveTimerChip').addEventListener('click', () => showScreen('workout'));
  $('#settingsBtn').addEventListener('click', () =>
    showScreen(currentScreen === 'settings' ? 'home' : 'settings'));

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
  await checkWeighInReminder();
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
  const saved = await db.getSetting(THEME_KEY, 'light');
  applyTheme(saved);

  const select = $('#themeSelect');
  select.value = saved;
  select.addEventListener('change', async () => {
    applyTheme(select.value);
    await db.setSetting(THEME_KEY, select.value);
    // הגרפים מציירים את הצבעים שלהם פעם אחת - צריך רינדור מחדש כדי שיתעדכנו
    if (currentScreen === 'progress') renderProgress();
  });
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
    await navigator.serviceWorker.register('sw.js');
  } catch (err) {
    console.warn('[Ori Fitness] רישום Service Worker נכשל:', err);
  }
}

/* ---------- אתחול ---------- */

async function main() {
  try {
    await db.openDB();
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
  checkWeighInReminder();

  initSettingsScreen({
    onRerun: () => rerunWizard(),
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

  registerSW();
}

document.addEventListener('DOMContentLoaded', main);
