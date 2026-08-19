/* ===================================================================
   settings.js — מסך ההגדרות: המקום היחיד שבו משנים את הדברים הקבועים
   (תוכניות אימון, שיבוץ שבועי, סוגי אירובי, תפריט, יעדים).
   מסכי היומיום נשארים לביצוע בלבד.
   =================================================================== */

import * as db from './db.js';
import {
  $, el, guard, heCount, fmtNum, num, toast,
  openSheet, closeSheet, confirmSheet, dateKey, blobUrl, pickFileOnce,
} from './ui.js';
import { getRoutines, getSchedule, openRoutinesListSheet, openScheduleSheet, DAY_SHORT } from './routines.js';
import { getCardioTemplates, openCardioEditor, openCardioScheduleSheet, getCardioSchedule } from './cardio.js';
import { getPlan, openPlanEditor } from './mealplan.js';
import { goalForDate, openGoalSheet, openCalorieCalculatorSheet } from './nutrition.js';
import {
  renderGreeting, getWeeklyWorkoutGoal, setWeeklyWorkoutGoal, renderStats,
  getBuiltinQuotes, getGoals, openGoalsEditor, getPhotos, addPhotos, openLightbox,
  getShowQuoteCard, setShowQuoteCard, renderQuote, renderGoals,
  getShowGoalsCard, setShowGoalsCard, getShowNutritionCard, setShowNutritionCard,
  getShowWorkoutsCard, setShowWorkoutsCard,
} from './dashboard.js';
import { getChallenge, challengeStatus, openChallengeSettings } from './challenge.js';
import { getBadgeStatus, openBadgesSheet } from './badges.js';
import { getUserHeightCm, setUserHeightCm, renderBodyWeight } from './bodyweight.js';
import { isConfigured } from './firebase-config.js';
import { isAdminUser, openUsersSheet, usersSummary } from './admin.js';
import { cloudStatus, syncNow } from './cloud.js';

let onRerunSetup = null;

/*
 * רענון כל המסכים אחרי שהענן הביא נתונים. מוזרק מ-app.js ולא מיובא
 * ממנו — app.js כבר מייבא את הקובץ הזה, וייבוא הדדי היה סוגר מעגל.
 */
let onCloudPulled = null;

const NAME_SETTING_KEY = 'userName';

/* ---------- פרופיל ---------- */

function openNameSheet() {
  const input = el('input', {
    type: 'text', placeholder: 'איך קוראים לך?', autocomplete: 'off',
  });

  const save = guard(async () => {
    const name = input.value.trim();
    await db.setSetting(NAME_SETTING_KEY, name);
    await renderGreeting();
    await renderSettings();
    closeSheet();
    toast(name ? `נעים להכיר, ${name}!` : 'השם הוסר', 'ok');
  });

  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });

  const body = el('div', {},
    el('div', { class: 'field' }, el('label', {}, 'השם שלך'), input),
    el('p', { class: 'muted', style: 'font-size:.8rem;margin-bottom:14px' },
      'נשתמש בו כדי לברך אותך בבית ולחגוג איתך בסוף אימון. אפשר להשאיר ריק כדי לבטל את זה.'),
    el('button', { class: 'btn btn-primary btn-block', onclick: save }, 'שמור'),
  );

  openSheet('השם שלי', body);
  db.getSetting(NAME_SETTING_KEY, '').then((v) => { input.value = v || ''; input.focus(); });
}

async function openHeightSheet() {
  const current = await getUserHeightCm();
  const input = el('input', {
    type: 'number', inputmode: 'numeric', min: '0', max: '260', placeholder: '170', value: current ?? '',
  });

  const save = guard(async () => {
    await setUserHeightCm(num(input.value, 0));
    await renderSettings();
    await renderBodyWeight();
    closeSheet();
    toast('נשמר', 'ok');
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });

  const body = el('div', {},
    el('div', { class: 'field' }, el('label', {}, 'גובה (ס"מ)'), input),
    el('p', { class: 'muted', style: 'font-size:.8rem;margin-bottom:14px' },
      'נדרש כדי לחשב BMI במסך ההתקדמות. אפשר להשאיר ריק כדי לבטל את זה.'),
    el('button', { class: 'btn btn-primary btn-block', onclick: save }, 'שמור'),
  );

  openSheet('גובה', body);
  setTimeout(() => input.focus(), 120);
}

/* ---------- מצב הסנכרון ---------- */

/*
 * כשל בענן אינו שובר כלום, ולכן הוא גם בלתי נראה — מבחוץ זה נראה
 * פשוט כמו "הנתונים לא עוברים". המסך הזה הופך את זה למשהו שאפשר
 * לקרוא ולדווח עליו, במקום לנחש.
 */
function syncLine(st) {
  if (st.state === 'מסונכרן' && st.lastSyncAt) {
    const mins = Math.round((Date.now() - st.lastSyncAt) / 60000);
    return `✅ מסונכרן · ${mins < 1 ? 'הרגע' : `לפני ${mins} דק׳`}`;
  }
  if (st.reason) return `⚠️ ${st.state} (${st.reason})`;
  return st.state;
}

function renderCloudRow() {
  const sub = $('#cloudStatusSub');
  if (sub) sub.textContent = syncLine(cloudStatus());
}

async function openCloudSheet() {
  const body = el('div', {});
  const draw = (st) => body.replaceChildren(
    el('p', { class: 'muted', style: 'margin-bottom:14px' },
      'האימונים, התזונה, המשקל, התוכניות וההגדרות שלך נשמרים גם בענן, ' +
      'כדי שיופיעו בכל מכשיר שתיכנס בו לאותו חשבון. ' +
      'תמונות הגלריה נשארות במכשיר בלבד — לכן חשוב להמשיך לייצא גיבוי.'),
    el('div', { class: 'list' },
      el('div', { class: 'list-item is-static' },
        el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, 'מצב'),
          el('div', { class: 'li-sub' }, syncLine(st)))),
      el('div', { class: 'list-item is-static' },
        el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, 'נשלחו לענן'),
          el('div', { class: 'li-sub' }, `${st.pushed} פריטים`))),
      el('div', { class: 'list-item is-static' },
        el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, 'התקבלו מהענן'),
          el('div', { class: 'li-sub' }, `${st.pulled} פריטים`))),
      ...(st.queued ? [el('div', { class: 'list-item is-static' },
        el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, 'ממתין לשליחה'),
          el('div', { class: 'li-sub' }, `${st.queued} — ייסגר בסנכרון הבא`)))] : []),
    ),
    el('button', {
      class: 'btn btn-primary btn-block', style: 'margin-top:16px',
      onclick: guard(async function () {
        this.textContent = 'מסנכרן…';
        const res = await syncNow(async () => {
          if (onCloudPulled) await onCloudPulled();
          else { await renderGreeting(); await renderStats(); }
        });
        draw(res);
        renderCloudRow();
        toast(res.state === 'מסונכרן' ? 'סונכרן ✓' : `לא הצליח: ${res.reason || res.state}`,
          res.state === 'מסונכרן' ? 'ok' : 'err');
      }),
    }, 'סנכרן עכשיו'),
  );

  draw(cloudStatus());
  openSheet('☁️ מצב הסנכרון', body);
}

/* ---------- יעד אימונים שבועי ---------- */

async function openWeeklyGoalSheet() {
  const current = await getWeeklyWorkoutGoal();

  const input = el('input', {
    type: 'number', inputmode: 'numeric', min: '1', max: '14', value: current,
  });

  const save = guard(async () => {
    await setWeeklyWorkoutGoal(num(input.value, current));
    await renderStats();
    await renderSettings();
    closeSheet();
    toast('נשמר', 'ok');
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });

  const body = el('div', {},
    el('p', { class: 'muted', style: 'margin-bottom:14px' },
      'כמה אימונים בשבוע אתה שואף אליהם — מוצג בבית כ"X מתוך Y".'),
    el('div', { class: 'field' }, el('label', {}, 'אימונים בשבוע'), input),
    el('button', { class: 'btn btn-primary btn-block', onclick: save }, 'שמור'),
  );

  openSheet('יעד אימונים שבועי', body);
  setTimeout(() => input.focus(), 120);
}

/* ---------- מסך הבית: אילו מקטעים מוצגים ---------- */

const HOME_SECTIONS = [
  { name: 'דף מנטלי', get: getShowQuoteCard, set: setShowQuoteCard, render: renderQuote },
  { name: 'מטרות', get: getShowGoalsCard, set: setShowGoalsCard, render: renderGoals },
  { name: 'תזונה היום', get: getShowNutritionCard, set: setShowNutritionCard, render: renderStats },
  { name: 'אימונים השבוע', get: getShowWorkoutsCard, set: setShowWorkoutsCard, render: renderStats },
];

async function openHomeScreenSheet() {
  const rows = await Promise.all(HOME_SECTIONS.map(async (section) => {
    const select = el('select', {},
      el('option', { value: 'off' }, 'מוסתר'),
      el('option', { value: 'on' }, 'מוצג'),
    );
    select.value = (await section.get()) ? 'on' : 'off';
    select.addEventListener('change', guard(async () => {
      await section.set(select.value === 'on');
      await section.render();
    }));
    return el('label', { class: 'setting-row' },
      el('span', {}, el('b', {}, section.name)),
      select,
    );
  }));

  const body = el('div', {},
    el('p', { class: 'muted', style: 'margin-bottom:14px' },
      'בוחרים אילו מקטעים מופיעים במסך הבית.'),
    el('div', { class: 'card' }, ...rows),
  );

  openSheet('מסך בית', body);
}

/* ---------- דף מנטלי: תמונות רקע + ציטוטים ---------- */

async function openQuotesSheet() {
  // תמונות הרקע שמתחלפות מאחורי הציטוט — ניהול נוסף כאן, בנוסף לכפתור
  // 📷 הקבוע על כרטיס הציטוט עצמו בבית
  const photoStrip = el('div', { class: 'mental-photo-strip' });
  const photoInput = el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });

  const renderPhotoStrip = async () => {
    const photos = await getPhotos();
    photoStrip.replaceChildren(...(photos.length
      ? photos.map((p) => el('img', {
          src: blobUrl(p.thumb || p.image), alt: '', class: 'mental-photo-thumb',
          onclick: () => openLightbox(p, renderPhotoStrip),
        }))
      : [el('p', { class: 'muted', style: 'font-size:.8rem' }, 'עוד לא הוספת תמונות רקע.')]));
  };
  await renderPhotoStrip();

  photoInput.addEventListener('change', async () => {
    const files = Array.from(photoInput.files || []);
    photoInput.value = '';
    if (files.length) { await addPhotos(files); await renderPhotoStrip(); }
  });

  const builtinQuotes = getBuiltinQuotes();

  const body = el('div', {},
    el('div', { class: 'section-head' },
      el('h2', {}, 'תמונות רקע'),
      el('div', { class: 'head-actions' },
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => pickFileOnce(photoInput) }, '+ הוסף')),
    ),
    photoStrip,
    photoInput,

    el('div', { class: 'section-head', style: 'margin-top:18px' },
      el('h2', {}, `ציטוטים (${builtinQuotes.length})`)),
    el('p', { class: 'muted', style: 'font-size:.8rem;margin-bottom:10px' },
      'הרשימה שמתחלפת במסך הבית, לפי הסדר.'),
    el('div', { class: 'list' }, ...builtinQuotes.map((q, i) => el('div', { class: 'list-item weight-row' },
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title' }, `${i + 1}. ${q.text}`),
        q.author ? el('div', { class: 'li-sub' }, q.author) : null,
      ),
    ))),
  );

  openSheet('דף מנטלי', body);
}

/** שורות התקציר מתחת לכל פריט בהגדרות */
/* ---------- חשבון ---------- */

/*
 * מוצג רק כשיש התחברות בפועל. בלי המקטע הזה אין שום דרך לראות עם איזה
 * חשבון נכנסת או להתנתק — וזה בדיוק מה שגרם לתחושה ש"הוא לא שואל כלום":
 * Firebase זוכר את ההתחברות, ובלי כפתור יציאה אי אפשר היה לראות זאת.
 */
function renderAccount() {
  const section = $('#accountSection');
  if (!section) return;

  if (!isConfigured()) { section.classList.add('hidden'); return; }

  let state = null;
  try { state = JSON.parse(localStorage.getItem('oriFitnessAuthState') || 'null'); }
  catch { state = null; }

  if (!state) { section.classList.add('hidden'); return; }

  section.classList.remove('hidden');
  $('#accountName').textContent = state.name || state.email || 'מחובר';
  const role = state.isAdmin ? 'מנהל' : ({
    approved: 'מאושר', pending: 'ממתין לאישור', blocked: 'הגישה הוסרה',
  }[state.status] || state.status);
  $('#accountSub').textContent = `${state.email || ''} · ${role}`;

  // רשימת המשתמשים נטענת מהרשת, ולכן התקציר מתעדכן אחרי שהמסך כבר מוצג
  const usersBtn = $('#setUsersBtn');
  if (!usersBtn) return;
  if (!isAdminUser()) { usersBtn.classList.add('hidden'); return; }
  usersBtn.classList.remove('hidden');
  usersSummary().then((text) => { $('#setUsersSub').textContent = text; });
}

export async function renderSettings() {
  const [name, routines, schedule, cardio, plan, goal, weeklyGoal, personalGoals] = await Promise.all([
    db.getSetting(NAME_SETTING_KEY, ''), getRoutines(), getSchedule(), getCardioTemplates(), getPlan(), goalForDate(dateKey()),
    getWeeklyWorkoutGoal(), getGoals(),
  ]);

  renderAccount();
  renderCloudRow();
  $('#setNameSub').textContent = name ? name : 'לא הוגדר — לחץ כדי להוסיף';
  const height = await getUserHeightCm();
  $('#setHeightSub').textContent = height ? `${height} ס"מ` : 'לא הוגדר — לחץ כדי להוסיף';
  $('#setWeeklyGoalSub').textContent = `${weeklyGoal} אימונים בשבוע`;

  $('#setGoalsSub').textContent = personalGoals.length
    ? heCount(personalGoals.length, 'מטרה', 'מטרות', true)
    : 'עדיין לא הגדרת מטרות';

  const showQuote = await getShowQuoteCard();
  $('#setQuotesSub').textContent =
    `${heCount(getBuiltinQuotes().length, 'ציטוט', 'ציטוטים')} · ${showQuote ? 'מוצג בבית' : 'מוסתר מהבית'}`;

  const homeShown = (await Promise.all(HOME_SECTIONS.map((s) => s.get()))).filter(Boolean).length;
  $('#setHomeScreenSub').textContent = `${homeShown} מתוך ${HOME_SECTIONS.length} מוצגים`;

  const challenge = await getChallenge();
  $('#setChallengeSub').textContent = challenge
    ? (challengeStatus(challenge).isFinished ? 'הסתיים — לחץ להתחיל חדש' : `יום ${challengeStatus(challenge).dayIndex} מתוך ${challenge.days}`)
    : 'אין אתגר פעיל — לחץ כדי להתחיל';

  const badges = await getBadgeStatus();
  $('#setBadgesSub').textContent = `${badges.filter((b) => b.earned).length} מתוך ${badges.length} הושגו`;

  $('#setRoutinesSub').textContent = routines.length
    ? routines.map((r) => r.name).join(' · ')
    : 'עדיין לא הגדרת תוכניות';

  const assigned = schedule.filter(Boolean).length;
  const days = schedule.map((id, i) => (id ? DAY_SHORT[i] : null)).filter(Boolean).join(', ');
  $('#setScheduleSub').textContent = assigned
    ? `${assigned === 1 ? 'יום אחד משובץ' : `${assigned} ימים משובצים`} · ${days}`
    : 'לא שיבצת אימונים לימים';

  $('#setCardioSub').textContent = cardio.length
    ? cardio.map((c) => c.name).join(' · ')
    : 'לא הגדרת סוגי אירובי';

  const cardioSchedule = await getCardioSchedule();
  const cardioAssigned = cardioSchedule.filter(Boolean).length;
  $('#setCardioScheduleSub').textContent = cardioAssigned
    ? `${cardioAssigned === 1 ? 'יום אחד משובץ' : `${cardioAssigned} ימים משובצים`}`
    : 'לא שיבצת אירובי לימים';

  const planKcal = plan.reduce((s, m) => s + num(m.calories, 0), 0);
  $('#setMealPlanSub').textContent = plan.length
    ? `${heCount(plan.length, 'ארוחה', 'ארוחות', true)} · ${fmtNum(planKcal)} קק"ל`
    : 'לא בנית תפריט קבוע';

  $('#setGoalSub').textContent =
    `${fmtNum(goal.calories)} קק"ל · ח ${fmtNum(goal.protein)} · פ ${fmtNum(goal.carbs)} · ש ${fmtNum(goal.fat)}`;
}

/* ---------- איפוס נתונים ---------- */

// מאגרים שמכילים תוכן שהמשתמש הזין — נמחקים באיפוס
const RESET_STORES = [
  db.STORES.workouts, db.STORES.photos, db.STORES.meals,
  db.STORES.goals, db.STORES.routines, db.STORES.mealPlan, db.STORES.bodyWeight,
];
// מפתחות ב-settings שקשורים לתוכן שנמחק (לא להעדפות תצוגה כמו ערכת נושא)
const RESET_SETTING_KEYS = [
  'onboardingDone', 'weekSchedule', 'cardioWeekSchedule', 'activeWorkout', 'quoteRotation',
  'personalGoals', 'activeChallenge', 'challengesCompletedCount', 'lastWeighInReminderDate',
];

const CONFIRM_PHRASE = 'מחק הכל';

function openResetConfirm() {
  let match = false;

  const input = el('input', {
    class: 'reset-confirm-input', type: 'text', autocomplete: 'off',
    placeholder: CONFIRM_PHRASE,
    oninput: (e) => {
      match = e.target.value.trim() === CONFIRM_PHRASE;
      confirmBtn.disabled = !match;
    },
  });

  const confirmBtn = el('button', {
    class: 'btn btn-danger btn-block', style: 'margin-top:14px',
    disabled: true,
    onclick: guard(async () => {
      if (!match) return;
      await performReset();
      closeSheet();
      // הדרך הכי בטוחה לנקות את כל המטמונים בכל המודולים בבת אחת
      location.reload();
    }),
  }, 'מחק את כל הנתונים לצמיתות');

  const body = el('div', {},
    el('p', { class: 'muted', style: 'margin-bottom:10px' },
      'זה ימחק את כל האימונים, התוכניות, התפריט, היעדים ותמונות הגלריה. ' +
      'אין דרך לשחזר את זה — אלא אם ייצאת גיבוי קודם.'),
    el('p', { class: 'muted', style: 'font-size:.82rem;margin-bottom:4px' },
      `כדי לאשר, הקלד בדיוק: "${CONFIRM_PHRASE}"`),
    input,
    confirmBtn,
  );

  openSheet('איפוס נתונים', body);
  setTimeout(() => input.focus(), 120);
}

async function performReset() {
  for (const store of RESET_STORES) await db.clearStore(store);
  for (const key of RESET_SETTING_KEYS) await db.delSetting(key);
}

export function initSettingsScreen({ onRerun, onCloudRefresh } = {}) {
  onRerunSetup = onRerun;
  onCloudPulled = onCloudRefresh || null;

  $('#signOutBtn').addEventListener('click', guard(async () => {
    const ok = await confirmSheet('התנתקות',
      'תצא מהחשבון במכשיר הזה ותחזור למסך ההתחברות. הנתונים שלך נשארים שמורים.',
      'התנתק');
    if (!ok) return;
    const auth = await import('./auth.js');
    await auth.signOutUser();
  }));

  $('#setUsersBtn').addEventListener('click', guard(openUsersSheet));
  $('#cloudStatusBtn').addEventListener('click', guard(openCloudSheet));

  $('#setNameBtn').addEventListener('click', guard(openNameSheet));
  $('#setHeightBtn').addEventListener('click', guard(openHeightSheet));
  $('#setHomeScreenBtn').addEventListener('click', guard(openHomeScreenSheet));
  $('#setQuotesBtn').addEventListener('click', guard(openQuotesSheet));
  $('#setGoalsBtn').addEventListener('click', guard(openGoalsEditor));
  $('#setChallengeBtn').addEventListener('click', guard(openChallengeSettings));
  $('#setBadgesBtn').addEventListener('click', guard(openBadgesSheet));
  $('#setRoutinesBtn').addEventListener('click', guard(openRoutinesListSheet));
  $('#setWeeklyGoalBtn').addEventListener('click', guard(openWeeklyGoalSheet));
  $('#setScheduleBtn').addEventListener('click', guard(openScheduleSheet));
  $('#setCardioBtn').addEventListener('click', guard(openCardioEditor));
  $('#setCardioScheduleBtn').addEventListener('click', guard(openCardioScheduleSheet));
  $('#setMealPlanBtn').addEventListener('click', guard(openPlanEditor));
  $('#setGoalBtn').addEventListener('click', guard(openGoalSheet));
  $('#setCalcBtn').addEventListener('click', guard(openCalorieCalculatorSheet));
  $('#rerunSetupBtn').addEventListener('click', () => onRerunSetup?.());
  $('#resetDataLink').addEventListener('click', guard(openResetConfirm));
}

export { db };
