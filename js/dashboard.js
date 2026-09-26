/* ===================================================================
   dashboard.js — מסך הבית: ציטוט מוטיבציה, גלריית מוטיבציה וסטטיסטיקות.
   =================================================================== */

import * as db from './db.js';
import {
  $, el, toast, dateKey, shiftDateKey, fmtNum, blobUrl,
  resizeImage, pickFileOnce, openSheet, guard, formatFullDateHe, heCount, formatDurationHe,
} from './ui.js';
import { getAllWorkouts } from './workouts.js';
import { totalsForDate, goalForDate } from './nutrition.js';
import { weeklyCardioSummary, getCardioSchedule, getCardioTemplates } from './cardio.js';
import { getRoutines, getSchedule, DAY_SHORT, DAY_NAMES } from './routines.js';

const QUOTES = [
  // הציטוטים שאורי בחר
  { text: 'האגו שלי לא יקבל אפשרות להפסיד. אתה יכול לנסות להתאמן כמוני, אבל המשמעת שלי היא מה שמפריד ביני לבין כולם.', author: 'קובי ברייאנט' },
  { text: 'המוח שלך יישבר אלף פעמים לפני שהגוף שלך באמת יישבר. כשאתה חושב שאתה ב-40%, אתה אפילו לא התחלת.', author: 'דייוויד גוגינס' },
  { text: 'הכוח אינו מגיע מהניצחונות שלך במכון. המאבקים שלך עם המשקל והכישלון הם שפותחים את הגבולות שלך מחדש.', author: 'ארנולד שוורצנגר' },
  { text: 'שנאתי כל רגע באימונים, אבל אמרתי לעצמי: סבול עכשיו במכון, ותחיה את שאר היום כאלופים.', author: 'מוחמד עלי' },
  { text: 'אין דבר כזה כישרון טבעי בברזל. אתה עובד כמו משוגע בשביל כל קילו, ואלופים לא נולדים במנוחה — הם נבנים בזיעה.', author: 'קונור מקגרגור' },
  { text: 'נכשלתי פעם אחר פעם אחר פעם בחיים שלי ובאימונים שלי. וזו בדיוק הסיבה שאני עומד בתוצאה שאני רוצה.', author: 'מייקל ג\'ורדן' },
  { text: 'אף אחד לא בא להציל אותך. תפסיק לרחם על עצמך, תרים את המשקל, ותבנה את הגוף והאופי שמגיעים לך.', author: 'דייוויד גוגינס' },
  { text: 'אנשים אומרים שאתה משקיע יותר מדי. האמת היא שהם פשוט מתאמצים מעט מדי ביחס למה שהמטרה שלהם דורשת.', author: 'קובי ברייאנט' },
  { text: 'הגוף שלך יעשה בדיוק מה שהמוח שלך ירשה לו. אם תגיד לעצמך שאתה עייף, הפסדת עוד לפני שנגעת במוט.', author: 'ארנולד שוורצנגר' },

  { text: 'ההצלחה היא סכום של מאמצים קטנים שחוזרים על עצמם יום אחר יום.', author: 'רוברט קולייר' },
  { text: 'אל תספור את הימים — תגרום לימים להיחשב.', author: 'מוחמד עלי' },
  { text: 'משמעת היא הגשר בין מטרות להישגים.', author: 'ג\'ים רון' },
  { text: 'תתחיל איפה שאתה, תשתמש במה שיש לך, תעשה מה שאתה יכול.', author: 'ארתור אש' },
  { text: 'אתה לא צריך להיות מעולה כדי להתחיל, אבל צריך להתחיל כדי להיות מעולה.', author: 'זיג זיגלר' },

  { text: 'הכישרון מנצח במשחק אחד. עבודת צוות ומשמעת מנצחות אליפויות.', author: 'מייקל ג\'ורדן' },
  { text: 'אני לא מפחד מהאדם שתרגל אלף בעיטות פעם אחת. אני מפחד מהאדם שתרגל בעיטה אחת אלף פעמים.', author: 'ברוס לי' },
  { text: 'ההבדל בין הבלתי אפשרי לאפשרי טמון בנחישות של אדם.', author: 'טומי לסורדה' },
  { text: 'לא חייבים להיות גדולים כדי להתחיל, אבל חייבים להתחיל כדי להיות גדולים.', author: 'זיג זיגלר' },
  { text: 'הגוף שלך שומע כל מה שהמוח שלך אומר. תפסיק להתלונן.', author: 'נעמי ג\'אד' },
  { text: 'הכאב הוא זמני. אם אני מפסיק, הוא נשאר לנצח.', author: 'לאנס ארמסטרונג' },
  { text: 'החלום שלך לא עובד עד שאתה עובד.', author: 'ג\'ון מקסוול' },
  { text: 'אלוף הוא מי שקם כשהוא לא יכול.', author: 'ג\'ק דמפסי' },
  { text: 'אין קיצורי דרך למקום ששווה להגיע אליו.', author: 'בבה רות\'' },
];

let onNavigateWorkout = null;

/* ---------- הצגה/הסתרה של מקטעי מסך הבית, נשלט מהגדרות ---------- */

const SHOW_GOALS_KEY = 'showGoalsCard';
const SHOW_NUTRITION_KEY = 'showNutritionCard';
const SHOW_WORKOUTS_KEY = 'showWorkoutsCard';

export async function getShowGoalsCard() { return db.getSetting(SHOW_GOALS_KEY, true); }
export async function setShowGoalsCard(show) { await db.setSetting(SHOW_GOALS_KEY, show); }

export async function getShowNutritionCard() { return db.getSetting(SHOW_NUTRITION_KEY, true); }
export async function setShowNutritionCard(show) { await db.setSetting(SHOW_NUTRITION_KEY, show); }

export async function getShowWorkoutsCard() { return db.getSetting(SHOW_WORKOUTS_KEY, true); }
export async function setShowWorkoutsCard(show) { await db.setSetting(SHOW_WORKOUTS_KEY, show); }

/* ---------- ציטוטים ---------- */

/** רשימת הציטוטים — לתצוגה בעמוד ההגדרות, בלי אפשרות עריכה */
export function getBuiltinQuotes() {
  return QUOTES;
}

/* ---------- מטרות אישיות ---------- */

// רשימה קבועה וגלויה במסך הבית — בשונה מהציטוט המתחלף, כל המטרות
// מוצגות יחד תמיד, ממוספרות
const GOALS_KEY = 'personalGoals';
let goalsCache = null;

/** נדרש אחרי ייבוא גיבוי, כדי שהמטמון לא יישאר עם הרשימה הישנה */
export function invalidatePersonalGoalsCache() { goalsCache = null; }

async function loadGoals() {
  if (!goalsCache) goalsCache = await db.getSetting(GOALS_KEY, []);
  return goalsCache;
}

export async function getGoals() {
  return loadGoals();
}

async function addGoal(text) {
  const clean = text.trim();
  if (!clean) return;
  const list = await loadGoals();
  goalsCache = [...list, { id: db.uid(), text: clean }];
  await db.setSetting(GOALS_KEY, goalsCache);
}

async function deleteGoal(id) {
  const list = await loadGoals();
  goalsCache = list.filter((g) => g.id !== id);
  await db.setSetting(GOALS_KEY, goalsCache);
}

export async function renderGoals() {
  const show = await getShowGoalsCard();
  $('#homeGoalsSection').classList.toggle('hidden', !show);
  if (!show) return;

  const goals = await loadGoals();
  const host = $('#goalsCard');
  if (!goals.length) {
    host.replaceChildren(el('p', { class: 'muted' },
      'עוד לא הגדרת מטרות. אפשר להוסיף דרך ההגדרות.'));
    return;
  }
  host.replaceChildren(...goals.map((g, i) => el('div', { class: 'goal-row' },
    el('span', { class: 'goal-num' }, String(i + 1)),
    el('span', { class: 'goal-text' }, g.text),
  )));
}

export function openGoalsEditor() {
  const listHost = el('div', { class: 'list' });

  const renderEditList = async () => {
    const goals = await loadGoals();
    listHost.replaceChildren(...(goals.length
      ? goals.map((g, i) => el('div', { class: 'list-item weight-row' },
          el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, `${i + 1}. ${g.text}`)),
          el('button', {
            class: 'icon-btn', 'aria-label': 'מחק',
            onclick: guard(async (e) => {
              e.stopPropagation();
              await deleteGoal(g.id);
              await renderGoals();
              await renderEditList();
            }),
          }, '🗑'),
        ))
      : [el('p', { class: 'muted' }, 'עוד לא הוספת מטרות.')]));
  };

  const textInput = el('textarea', {
    rows: 4,
    placeholder: 'אפשר כמה מטרות בבת אחת, מופרדות בפסיק או בשורה חדשה — ' +
      'לדוגמה: 100 ק"ג בסקוואט, לרדת ל-78 ק"ג, 4 אימונים בשבוע',
  });

  const body = el('div', {},
    listHost,
    el('div', { class: 'section-head', style: 'margin-top:18px' }, el('h2', {}, 'מטרה חדשה')),
    el('div', { class: 'field' }, textInput),
    el('button', {
      class: 'btn btn-primary btn-block',
      onclick: guard(async () => {
        // פסיק בין ספרות ("82,5 ק"ג") הוא עשרוני ולא מפריד בין מטרות
        const parts = textInput.value.split(/\n|,(?!\d)/).map((p) => p.trim()).filter(Boolean);
        if (!parts.length) { toast('כתוב משהו קודם', 'err'); return; }
        for (const part of parts) await addGoal(part);
        await renderGoals();
        textInput.value = '';
        await renderEditList();
        toast(parts.length === 1 ? 'נוספה' : `נוספו ${parts.length} מטרות`, 'ok');
      }),
    }, 'הוסף'),
  );

  renderEditList();
  openSheet('המטרות שלי', body);
}

/* ---------- ברכה לפי שעה ---------- */

const USER_NAME_KEY = 'userName';

function timeGreeting(hour) {
  if (hour >= 5 && hour < 12) return 'בוקר טוב';
  if (hour >= 12 && hour < 18) return 'צהריים טובים';
  if (hour >= 18 && hour < 22) return 'ערב טוב';
  return 'לילה טוב';
}

export async function renderGreeting() {
  const name = (await db.getSetting(USER_NAME_KEY, '')).trim();
  const greeting = timeGreeting(new Date().getHours());
  $('#greetingText').textContent = name ? `${greeting}, ${name}` : greeting;
  $('#homeDateText').textContent = formatFullDateHe();
}

/* ---------- ציטוט יומי ---------- */

const ROTATION_KEY = 'quoteRotation';

/*
 * הציטוט והתמונה מתחלפים בכל כניסה לאפליקציה, לא פעם ביום.
 * המונה נשמר, כך שרואים את כל הרשימה לפי הסדר ולא חוזרים על אותו אחד.
 */
let rotationIndex = 0;

/** מקדם את המונה — נקרא פעם אחת בפתיחת האפליקציה */
export async function advanceRotation() {
  const saved = await db.getSetting(ROTATION_KEY, -1);
  rotationIndex = (Number(saved) + 1) % 100000;
  await db.setSetting(ROTATION_KEY, rotationIndex);
}

/** ראשי תיבות לתג שליד הציטוט: "דייוויד גוגינס" -> "דג" */
function initials(name) {
  if (!name) return '';
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('');
}

/** הציטוט/הבטחה שמוצג כרגע — נדרש גם במסך האימון, לא רק בבית */
export function currentQuote() {
  const d = rotationIndex;
  return QUOTES[((d % QUOTES.length) + QUOTES.length) % QUOTES.length];
}

/* ---------- הצגת כרטיס הציטוט בבית — נשלט מהגדרות, ברירת מחדל מוסתר ---------- */

const SHOW_QUOTE_KEY = 'showQuoteCard';

export async function getShowQuoteCard() {
  return db.getSetting(SHOW_QUOTE_KEY, true);
}

export async function setShowQuoteCard(show) {
  await db.setSetting(SHOW_QUOTE_KEY, show);
}

export async function renderQuote() {
  const card = $('#quoteCard');
  const show = await getShowQuoteCard();
  card.classList.toggle('hidden', !show);
  if (!show) return;

  const q = await currentQuote();

  // גרשיים סביב הטקסט, ומרוכז בכרטיס (ראו .quote-body ב-CSS)
  $('#quoteText').textContent = `„${q.text}”`;
  $('#quoteAuthor').textContent = q.author || '';
  $('#quoteBadge').textContent = initials(q.author);

  // התמונה שברקע מגיעה מהתמונות שהוספת, ומתחלפת יחד עם הציטוט
  const photoEl = $('#quotePhoto');
  const photos = await db.getAll(db.STORES.photos);

  if (!photos.length) {
    card.classList.remove('has-photo');
    photoEl.style.backgroundImage = '';
    photoEl.onclick = null;
    return;
  }

  photos.sort((a, b) => a.createdAt - b.createdAt);
  const pick = photos[((rotationIndex % photos.length) + photos.length) % photos.length];
  card.classList.add('has-photo');
  photoEl.style.backgroundImage = `url("${blobUrl(pick.image || pick.thumb)}")`;
  // לחיצה על התמונה עצמה פותחת אותה לצפייה/מחיקה
  photoEl.onclick = () => openLightbox(pick);
}

/* ---------- תמונות מוטיבציה (הרקע מאחורי הציטוט) ---------- */

/** לתצוגה במקומות נוספים (למשל "דף מנטלי" בהגדרות), לא רק בבית */
export async function getPhotos() {
  return (await db.getAll(db.STORES.photos)).sort((a, b) => b.createdAt - a.createdAt);
}

export async function addPhotos(files) {
  let added = 0;
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    try {
      const [image, thumb] = await Promise.all([
        resizeImage(file, 1920, 0.9),
        resizeImage(file, 400, 0.75),
      ]);
      await db.put(db.STORES.photos, {
        id: db.uid(), image, thumb, caption: '', createdAt: Date.now(),
      });
      added++;
    } catch {
      toast('תמונה אחת לא נטענה', 'err');
    }
  }
  if (added) {
    await renderQuote();
    toast(added === 1 ? 'התמונה נוספה' : `נוספו ${added} תמונות`, 'ok');
  }
}

// טיימר האיפוס של אישור המחיקה — ברמת המודול, כך שפתיחת לייטבוקס חדש
// תמיד מבטלת טיימר תלוי-ותלוי מפתיחה קודמת (אחרת תמונה חדשה עלולה
// "להתבטל" מבחינה ויזואלית ע"י טיימר ישן בזמן שהיא בפועל עדיין מאושרת)
let lightboxResetTimer = null;

export function openLightbox(photo, onClosed) {
  const box = $('#lightbox');
  $('#lightboxImg').src = blobUrl(photo.image || photo.thumb);
  box.classList.remove('hidden');

  // אישור מחיקה בתוך הלייטבוקס עצמו (לא דרך #sheet המשותף) —
  // הגיליון המשותף מוצג מתחת ללייטבוקס (z-index נמוך יותר), כך שאישור
  // שם היה בלתי נראה/בלתי לחיץ. לחיצה כפולה על אותו כפתור במקום זאת.
  const deleteBtn = $('#lightboxDelete');
  let confirming = false;
  const reset = () => {
    confirming = false;
    deleteBtn.textContent = 'מחק תמונה';
    deleteBtn.classList.remove('confirming');
  };
  clearTimeout(lightboxResetTimer);
  reset();
  deleteBtn.onclick = async () => {
    if (!confirming) {
      confirming = true;
      deleteBtn.textContent = 'לחץ שוב כדי לאשר מחיקה';
      deleteBtn.classList.add('confirming');
      clearTimeout(lightboxResetTimer);
      lightboxResetTimer = setTimeout(reset, 3000);
      return;
    }
    clearTimeout(lightboxResetTimer);
    await db.del(db.STORES.photos, photo.id);
    box.classList.add('hidden');
    await renderQuote();
    await onClosed?.();
    toast('התמונה נמחקה');
  };
}

/* ---------- סטטיסטיקות ---------- */

/* ---------- יעד אימונים שבועי ---------- */

const WEEKLY_GOAL_KEY = 'weeklyWorkoutGoal';
const DEFAULT_WEEKLY_GOAL = 4;

export async function getWeeklyWorkoutGoal() {
  return db.getSetting(WEEKLY_GOAL_KEY, DEFAULT_WEEKLY_GOAL);
}

export async function setWeeklyWorkoutGoal(n) {
  await db.setSetting(WEEKLY_GOAL_KEY, Math.max(1, Math.round(n) || DEFAULT_WEEKLY_GOAL));
}

export async function renderStats() {
  const [showWorkouts, showNutrition] = await Promise.all([getShowWorkoutsCard(), getShowNutritionCard()]);
  $('#homeWorkoutsSection').classList.toggle('hidden', !showWorkouts);
  $('#homeNutritionSection').classList.toggle('hidden', !showNutrition);

  const workouts = await getAllWorkouts();

  /* אחרי שהתאמנת היום הכפתור הגדול כבר לא קורא "התחל אימון" — הוא
     אומר שזה בוצע, בשקט (בלי המילוי הזוהר של כפתור ראשי). לחיצה עדיין
     מובילה למסך האימון, למי שרוצה עוד אימון. */
  const trainedToday = workouts.some((w) => w.date === dateKey() && (w.kind ?? 'strength') === 'strength');
  const homeBtn = $('#homeWorkoutBtn');
  homeBtn.classList.toggle('btn-primary', !trainedToday);
  homeBtn.classList.toggle('is-done-today', trainedToday);
  homeBtn.textContent = trainedToday ? '✓ האימון של היום בוצע' : 'התחל אימון';

  if (showWorkouts) {

    // 7 הימים האחרונים כולל היום
    const from = shiftDateKey(dateKey(), -6);
    const week = workouts.filter((w) => w.date >= from);
    const weeklyGoal = await getWeeklyWorkoutGoal();

    $('#hsWorkoutsCount').textContent = String(week.length);
    $('#hsWorkoutsGoal').textContent = String(weeklyGoal);

    // אירובי עם יעד שבועי מוגדר — אותו תקציר שמופיע במסך האימון, גם כאן.
    // בלי אירובי מוגדר הכרטיס מוסתר לגמרי, אחרת נשארה כאן קופסה ריקה
    // עם מסגרת ובלי שום תוכן בתוכה.
    const cardioSummary = await weeklyCardioSummary();
    $('#hsCardioList').replaceChildren(...cardioSummary.map((c) => el('div', { class: 'hs-cardio-row' },
      el('span', {}, `${c.icon} ${c.name}`),
      el('b', {}, `${c.count}/${c.goal}`),
    )));
    $('#hsCardioCard').classList.toggle('hidden', cardioSummary.length === 0);

    await renderHomeWeek(workouts);
  }

  if (showNutrition) {
    const [todayGoal, todayTotals] = await Promise.all([goalForDate(dateKey()), totalsForDate(dateKey())]);
    $('#hsKcalEaten').textContent = fmtNum(Math.round(todayTotals.calories));
    $('#hsKcalGoal').textContent = fmtNum(todayGoal.calories);
    $('#hsProtein').textContent = fmtNum(Math.round(todayTotals.protein));
    $('#hsProteinGoal').textContent = fmtNum(todayGoal.protein);
    $('#hsCarbs').textContent = fmtNum(Math.round(todayTotals.carbs));
    $('#hsCarbsGoal').textContent = fmtNum(todayGoal.carbs);
    $('#hsFat').textContent = fmtNum(Math.round(todayTotals.fat));
    $('#hsFatGoal').textContent = fmtNum(todayGoal.fat);
  }
}

/* ---------- השבוע בבית: עיגולים + שורה אחת ----------
 *
 * במסך הבית רק מבט של שנייה: עיגול לכל יום שאומר מה המצב, בלי שמות
 * בתוך העיגולים (שם נחתכו ל"כתפיים וב…" באריחים הקודמים). השמות יושבים
 * בשורה אחת מתחת. במסך האימון נשארו האריחים — שם בוחרים מה לעשות.
 *
 * "בוצע" כאן נדיב בכוונה: כל אימון כוח באותו יום נחשב, גם אם עשית
 * אימון חופשי במקום התוכנית, וגם יום מנוחה שהתאמנת בו נצבע ירוק.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgIcon(build) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'wk-ico');
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of build) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    svg.appendChild(node);
  }
  return svg;
}

// צבע מ-currentColor, כך שאותו אייקון יוצא טורקיז, לבן או אפור לפי המצב
const ICONS = {
  strength: () => svgIcon([
    ['line', { x1: 7, y1: 12, x2: 17, y2: 12 }],
    ['rect', { x: 4.5, y: 7, width: 3, height: 10, rx: 1 }],
    ['rect', { x: 16.5, y: 7, width: 3, height: 10, rx: 1 }],
    ['line', { x1: 2, y1: 12, x2: 4.5, y2: 12 }],
    ['line', { x1: 19.5, y1: 12, x2: 22, y2: 12 }],
  ]),
  cardio: () => svgIcon([['polyline', { points: '2,12 7,12 10,5 14,19 17,12 22,12' }]]),
  check: () => svgIcon([['polyline', { points: '5,12.5 10,17.5 19,7' }]]),
};

const fmtDay = (key) => { const [, m, d] = key.split('-').map(Number); return `${d}/${m}`; };

export async function renderHomeWeek(workouts) {
  const host = $('#hsWeekStrip');
  const line = $('#hsWeekLine');
  if (!host) return;

  const [routines, schedule, cardioSchedule, cardioTemplates] = await Promise.all([
    getRoutines(), getSchedule(), getCardioSchedule(), getCardioTemplates(),
  ]);
  const todayIdx = new Date().getDay();
  const todayKey = dateKey();
  const sunday = shiftDateKey(todayKey, -todayIdx);

  const days = DAY_SHORT.map((short, i) => {
    const key = shiftDateKey(sunday, i);
    const routine = schedule[i] ? routines.find((r) => r.id === schedule[i]) : null;
    const cardio = cardioSchedule[i] ? cardioTemplates.find((c) => c.id === cardioSchedule[i]) : null;
    const logged = workouts.filter((w) => w.date === key);
    const strengthDone = logged.some((w) => (w.kind ?? 'strength') === 'strength');
    const cardioDone = logged.some((w) => w.kind === 'cardio');
    return {
      i, short, key, routine, cardio, strengthDone, cardioDone, logged,
      name: [routine?.name, cardio?.name].filter(Boolean).join(' + '),
      planned: !!(routine || cardio),
      done: strengthDone || cardioDone,
      // הכל מה שתוכנן בוצע (יום בלי תוכנית: עצם האימון)
      complete: (!routine || strengthDone) && (!cardio || cardioDone) && (strengthDone || cardioDone),
      isToday: i === todayIdx,
      isPast: key < todayKey,
    };
  });

  host.replaceChildren(...days.map((d) => {
    let state;
    if (d.done) state = 'is-done';
    else if (!d.planned) state = d.isToday ? 'is-rest is-today-rest' : 'is-rest';
    else if (d.isToday) state = 'is-now';
    else if (d.isPast) state = 'is-missed';
    else state = 'is-planned';

    // האייקון הראשי: וי כשבוצע כוח, דופק כשבוצע רק אירובי, אחרת לפי התוכנית
    let icon;
    if (d.done) icon = d.strengthDone || !d.cardioDone ? ICONS.check() : ICONS.cardio();
    else if (d.routine) icon = ICONS.strength();
    else if (d.cardio) icon = ICONS.cardio();
    else icon = el('span', { class: 'wk-dash' }, '–');

    // תג פינה: יום עם כוח וגם אירובי. מלא = בוצע/מתוכנן, חלול = עוד חסר
    let badge = null;
    if (d.routine && d.cardio && !(d.done && !d.strengthDone)) {
      badge = el('span', { class: `wk-badge${d.done && !d.cardioDone ? ' is-hollow' : ''}` }, ICONS.cardio());
    } else if (d.done && d.cardioDone && !d.strengthDone && d.routine) {
      badge = el('span', { class: 'wk-badge is-hollow' }, ICONS.strength());
    }

    const status = d.done ? (d.complete ? 'בוצע' : 'בוצע חלקית') : d.planned ? (d.isPast ? 'לא סומן' : 'מתוכנן') : 'מנוחה';
    // לחיצה על עיגול מראה בשורה מתחת מה באותו יום; לחיצה שנייה (או על היום) חוזרת להיום
    return el('button', {
      type: 'button',
      class: `wk-day${d.isToday ? ' is-today' : ''}`,
      'aria-pressed': 'false',
      'aria-label': `${d.isToday ? 'היום, ' : ''}יום ${d.short}' ${fmtDay(d.key)}: ${d.name || 'מנוחה'} — ${status}`,
      onclick: () => selectDay(selectedDay === d.i || d.isToday ? null : d.i),
    },
      el('span', { class: 'wk-letter' }, d.short),
      el('span', { class: `wk-dot ${state}` }, icon, badge),
      el('span', { class: 'wk-date' }, String(Number(d.key.slice(8)))),
    );
  }));

  let selectedDay = null;
  const selectDay = (i) => {
    selectedDay = i;
    host.querySelectorAll('.wk-day').forEach((b, j) => {
      b.classList.toggle('is-selected', j === i);
      b.setAttribute('aria-pressed', String(j === i));
    });
    if (line) i === null ? renderTodayLine(line, days, todayIdx) : renderDayLine(line, days[i]);
  };
  selectDay(null);
}

/** השורה מתחת לעיגולים כשנבחר יום מסוים: "שישי 25/9: כתפיים ובטן + ריצה" */
function renderDayLine(line, d) {
  const strengthLog = d.logged.find((w) => (w.kind ?? 'strength') === 'strength');
  const cardioLog = d.logged.find((w) => w.kind === 'cardio');
  const name = d.name || (strengthLog ? (strengthLog.routineName || 'אימון חופשי') : cardioLog ? (cardioLog.name || 'אירובי') : 'מנוחה');

  const parts = [];
  if (strengthLog) {
    parts.push([strengthLog.totalSets ? heCount(strengthLog.totalSets, 'סט', 'סטים') : null,
      strengthLog.durationSec ? formatDurationHe(strengthLog.durationSec) : null].filter(Boolean).join(' · ') + ' ✓');
  } else if (d.routine) {
    const n = d.routine.exercises?.length ?? 0;
    parts.push(`${n ? heCount(n, 'תרגיל', 'תרגילים') : d.routine.name}${d.isPast || d.done ? ' — לא סומן' : ''}`);
  }
  if (cardioLog) {
    parts.push(`${Math.round((cardioLog.durationSec ?? 0) / 60)} דק׳ ${cardioLog.name || 'אירובי'} ✓`);
  } else if (d.cardio) {
    parts.push(`${d.cardio.minutes || 30} דק׳ ${d.cardio.name}${d.isPast || d.done ? ' — עוד לא' : ''}`);
  }

  const dayName = DAY_NAMES[d.i];
  line.replaceChildren(
    el('div', { class: 'wk-line-title' },
      el('b', {}, `${dayName} ${fmtDay(d.key)}:`), ` ${name}`,
      d.complete ? el('span', { class: 'wk-ok' }, ' ✓ בוצע') : null),
    el('div', { class: 'wk-line-sub' }, parts.length ? parts.join(' · ') : 'יום מנוחה 😌'),
  );
}

/** השורה מתחת לעיגולים כברירת מחדל — מה היום ומה בא אחריו */
function renderTodayLine(line, days, todayIdx) {
  const today = days[todayIdx];
  const upcoming = days.filter((d) => d.i > todayIdx && d.planned);
  const next = upcoming[0];
  const nextText = next
    ? `הבא: ${next.i === todayIdx + 1 ? 'מחר, ' : ''}${next.short}' ${fmtDay(next.key)} — ${next.name}`
    : 'זה היה האחרון לשבוע הזה 💪';
  const plannedDays = days.filter((d) => d.planned);

  let title, sub;
  if (!plannedDays.length) {
    title = [el('b', {}, 'אין עדיין תוכנית שבועית')];
    sub = 'שבץ אימונים לימים בהגדרות ⚙️ — והעיגולים יתמלאו';
  } else if (plannedDays.every((d) => d.complete)) {
    title = [el('b', {}, 'כל האימונים של השבוע בוצעו'), ' 🎉'];
    sub = 'במוצ״ש מחכה לך הסיכום השבועי';
  } else if (!today.planned) {
    title = [el('b', {}, 'היום:'), ' מנוחה 😌'];
    sub = next ? nextText : 'ובמוצ״ש מחכה לך הסיכום השבועי';
  } else if (today.complete) {
    title = [el('b', {}, 'היום:'), ` ${today.name} `, el('span', { class: 'wk-ok' }, '✓ בוצע')];
    sub = nextText;
  } else {
    title = [el('b', {}, 'היום:'), ` ${today.name}`];
    sub = upcoming.length
      ? `אחר כך: ${upcoming.slice(0, 3).map((d) => `${d.short}' ${d.name}`).join(' · ')}`
      : 'האחרון לשבוע הזה — יאללה 💪';
  }
  line.replaceChildren(
    el('div', { class: 'wk-line-title' }, ...title),
    el('div', { class: 'wk-line-sub' }, sub),
  );
}

/* ---------- אתחול ---------- */

export async function initDashboard({ onStartWorkout } = {}) {
  onNavigateWorkout = onStartWorkout;

  await renderGreeting();
  await advanceRotation();
  await renderQuote();

  $('#homeWorkoutBtn').addEventListener('click', () => onNavigateWorkout?.());

  const input = $('#galleryInput');
  $('#quotePhotoBtn').addEventListener('click', () => pickFileOnce(input));
  input.addEventListener('change', async () => {
    const files = Array.from(input.files || []);
    input.value = '';
    if (files.length) await addPhotos(files);
  });

  $('#lightboxClose').addEventListener('click', () => $('#lightbox').classList.add('hidden'));
  $('#lightbox').addEventListener('click', (e) => {
    if (e.target.id === 'lightbox') $('#lightbox').classList.add('hidden');
  });

  await renderGoals();

  await renderStats();
}
