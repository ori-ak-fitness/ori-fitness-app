/* ===================================================================
   dashboard.js — מסך הבית: ציטוט מוטיבציה, גלריית מוטיבציה וסטטיסטיקות.
   =================================================================== */

import * as db from './db.js';
import {
  $, el, toast, dateKey, shiftDateKey, fmtNum, blobUrl,
  resizeImage, pickFileOnce, openSheet, guard, formatFullDateHe,
} from './ui.js';
import { getAllWorkouts } from './workouts.js';
import { totalsForDate, goalForDate } from './nutrition.js';
import { weeklyCardioSummary, getCardioSchedule, getCardioTemplates } from './cardio.js';
import { renderWeekStrip, getRoutines, getSchedule } from './routines.js';

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
        const parts = textInput.value.split(/[,\n]/).map((p) => p.trim()).filter(Boolean);
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

  if (showWorkouts) {
    const workouts = await getAllWorkouts();

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

    // אותו לוח שבוע (עם וי על ימים שבוצעו) שיש במסך האימון, גם כאן בבית
    const [hsRoutines, hsSchedule, hsCardioSchedule, hsCardioTemplates] = await Promise.all([
      getRoutines(), getSchedule(), getCardioSchedule(), getCardioTemplates(),
    ]);
    await renderWeekStrip(hsRoutines, hsSchedule, new Date().getDay(), 'hsWeekStrip', hsCardioSchedule, hsCardioTemplates);
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
