/* ===================================================================
   progress.js — גרפי התקדמות: משקל מקסימלי לכל תרגיל לאורך זמן,
   ונפח כולל לכל אימון.
   =================================================================== */

import { $, el, num, fmtNum, shortDate, formatDateHe } from './ui.js';
import { lineChart, barChart } from './charts.js';
import { getAllWorkouts, calcVolume } from './workouts.js';
import { isSetDone } from './records.js';

let selected = null;
let selectedExerciseType = 'all';
let selectedVolumeType = 'all';

// דפדוף בגרפים: 0 = החלון החדש ביותר, מספר גבוה יותר = כמה "עמודים" אחורה
// בהיסטוריה. הסטטיסטיקות (שיא/שינוי) תמיד על כל ההיסטוריה, לא רק החלון הנראה.
const PAGE_SIZE = 12;
let exOffset = 0;
let volOffset = 0;

/** חותך "חלון" של עד PAGE_SIZE פריטים, offset עמודים אחורה מהסוף */
function paginate(arr, offset) {
  const end = Math.max(0, arr.length - offset * PAGE_SIZE);
  const start = Math.max(0, end - PAGE_SIZE);
  return { window: arr.slice(start, end), start, end };
}

function maxOffset(len) {
  return len > 0 ? Math.ceil(len / PAGE_SIZE) - 1 : 0;
}

/** מחבר את כפתורי הניווט + תווית הטווח לגרף אחד */
function wireChartNav(olderBtnId, newerBtnId, rangeId, offset, setOffset, total, start, end, rerender) {
  const olderBtn = $(`#${olderBtnId}`);
  const newerBtn = $(`#${newerBtnId}`);
  const range = $(`#${rangeId}`);
  const mo = maxOffset(total);

  olderBtn.disabled = offset >= mo;
  newerBtn.disabled = offset <= 0;
  range.textContent = total ? `${start + 1}–${end} מתוך ${total}` : '';

  olderBtn.onclick = () => { setOffset(Math.min(mo, offset + 1)); rerender(); };
  newerBtn.onclick = () => { setOffset(Math.max(0, offset - 1)); rerender(); };
}

/** תווית סוג האימון — שם התוכנית, או "אימון חופשי" לאימון בלי תוכנית */
function workoutTypeLabel(w) { return w.routineName || 'אימון חופשי'; }

/**
 * בונה מפה: שם תרגיל -> [{date, maxWeight, volume, bestSet}] ממוין כרונולוגית.
 * אם היו כמה אימונים באותו יום, נלקח המקסימום של היום.
 */
function buildExerciseSeries(workouts) {
  const map = new Map();

  for (const w of [...workouts].sort((a, b) => a.startedAt - b.startedAt)) {
    for (const ex of w.exercises) {
      const name = ex.name;
      let maxWeight = 0, volume = 0, bestReps = 0;
      for (const s of ex.sets) {
        // רק סטים שבוצעו בפועל — משקל מתוכנן שלא סומן לא ייחשב כשיא
        if (!isSetDone(s)) continue;
        const weight = num(s.weight, 0), reps = num(s.reps, 0);
        if (weight > 0 && reps > 0) volume += weight * reps;
        if (weight > maxWeight) { maxWeight = weight; bestReps = reps; }
      }
      if (maxWeight <= 0 && volume <= 0) continue;

      if (!map.has(name)) map.set(name, []);
      const arr = map.get(name);
      const last = arr[arr.length - 1];
      if (last && last.date === w.date) {
        last.maxWeight = Math.max(last.maxWeight, maxWeight);
        last.volume += volume;
        if (maxWeight >= last.maxWeight) last.bestReps = bestReps;
      } else {
        arr.push({ date: w.date, maxWeight, volume, bestReps });
      }
    }
  }
  return map;
}

export async function renderProgress() {
  const workouts = await getAllWorkouts();
  const chronological = [...workouts].sort((a, b) => a.startedAt - b.startedAt);
  const types = Array.from(new Set(chronological.map(workoutTypeLabel))).sort((a, b) => a.localeCompare(b, 'he'));

  // ---- בורר אימון — מצמצם את רשימת התרגילים ואת הנתונים לאימון ספציפי,
  // כדי שקל למצוא בזריזות "כמה עליתי בתרגיל הזה, באימון הזה" ----
  const workoutSelect = $('#progressWorkoutSelect');
  if (!types.length) {
    workoutSelect.replaceChildren(el('option', { value: 'all' }, 'אין עדיין אימונים'));
    workoutSelect.disabled = true;
  } else {
    workoutSelect.disabled = false;
    if (selectedExerciseType !== 'all' && !types.includes(selectedExerciseType)) selectedExerciseType = 'all';
    workoutSelect.replaceChildren(
      el('option', { value: 'all', selected: selectedExerciseType === 'all' }, 'כל האימונים'),
      ...types.map((t) => el('option', { value: t, selected: t === selectedExerciseType }, t)),
    );
    workoutSelect.value = selectedExerciseType;
  }

  const workoutsForExercise = selectedExerciseType === 'all'
    ? chronological
    : chronological.filter((w) => workoutTypeLabel(w) === selectedExerciseType);
  const series = buildExerciseSeries(workoutsForExercise);
  const names = Array.from(series.keys()).sort((a, b) => a.localeCompare(b, 'he'));

  // ---- בורר תרגיל (בתוך האימון שנבחר) ----
  const select = $('#progressExercise');
  if (!names.length) {
    select.replaceChildren(el('option', { value: '' }, 'אין עדיין תרגילים'));
    select.disabled = true;
  } else {
    select.disabled = false;
    if (!selected || !series.has(selected)) selected = names[0];
    select.replaceChildren(...names.map((n) => el('option', { value: n, selected: n === selected }, n)));
    select.value = selected;
  }

  // ---- גרף התרגיל הנבחר — ניתן לדפדוף אחורה בהיסטוריה ----
  const data = selected ? (series.get(selected) || []) : [];
  $('#chartTitle').textContent = selected
    ? `${selected} — משקל מקסימלי (ק"ג)`
    : 'משקל מקסימלי לאורך זמן';
  $('#chartSubtitle').textContent = (selected && selectedExerciseType !== 'all') ? selectedExerciseType : '';

  if (exOffset > maxOffset(data.length)) exOffset = maxOffset(data.length);
  const exPage = paginate(data, exOffset);
  wireChartNav('progressOlderBtn', 'progressNewerBtn', 'progressRange',
    exOffset, (v) => { exOffset = v; }, data.length, exPage.start, exPage.end, renderProgress);

  lineChart($('#progressChart'), exPage.window.map((d) => ({ label: shortDate(d.date), value: d.maxWeight })), {
    unit: 'ק"ג',
    emptyText: 'רשום אימון עם התרגיל הזה כדי לראות התקדמות',
  });

  // ---- מספרים מסכמים — תמיד על כל ההיסטוריה, לא רק החלון הנראה בגרף ----
  const stats = $('#chartStats');
  if (data.length) {
    const pr = Math.max(...data.map((d) => d.maxWeight));
    const first = data[0].maxWeight;
    const lastVal = data[data.length - 1].maxWeight;
    const delta = lastVal - first;
    stats.replaceChildren(
      el('div', { class: 'cl' }, el('b', {}, fmtNum(pr, 1)), el('span', {}, 'שיא אישי (ק"ג)')),
      el('div', { class: 'cl' }, el('b', {}, String(data.length)), el('span', {}, 'אימונים עם התרגיל')),
      el('div', { class: 'cl' },
        el('b', { style: `color:${delta >= 0 ? '#35d07f' : '#ff4d5e'}` },
          `${delta >= 0 ? '+' : ''}${fmtNum(delta, 1)}`),
        el('span', {}, 'שינוי מהפעם הראשונה')),
    );
  } else {
    stats.replaceChildren();
  }

  // ---- היסטוריה קריאה: תאריך, משקל וחזרות — תואמת את החלון הנראה בגרף ----
  renderExerciseHistory(exPage.window);

  // ---- נפח אימונים, לפי סוג אימון (עם "הכל" להשוואה) ----
  const typeSelect = $('#volumeTypeSelect');
  if (!types.length) {
    typeSelect.replaceChildren(el('option', { value: 'all' }, 'אין עדיין אימונים'));
    typeSelect.disabled = true;
  } else {
    typeSelect.disabled = false;
    if (selectedVolumeType !== 'all' && !types.includes(selectedVolumeType)) selectedVolumeType = 'all';
    typeSelect.replaceChildren(
      el('option', { value: 'all', selected: selectedVolumeType === 'all' }, 'הכל (השוואה)'),
      ...types.map((t) => el('option', { value: t, selected: t === selectedVolumeType }, t)),
    );
    typeSelect.value = selectedVolumeType;
  }

  const filtered = selectedVolumeType === 'all'
    ? chronological
    : chronological.filter((w) => workoutTypeLabel(w) === selectedVolumeType);

  if (volOffset > maxOffset(filtered.length)) volOffset = maxOffset(filtered.length);
  const volPage = paginate(filtered, volOffset);
  wireChartNav('volumeOlderBtn', 'volumeNewerBtn', 'volumeRange',
    volOffset, (v) => { volOffset = v; }, filtered.length, volPage.start, volPage.end, renderProgress);

  barChart($('#volumeChart'), volPage.window.map((w) => ({
    label: shortDate(w.date),
    value: w.totalVolume ?? calcVolume(w),
  })), { unit: 'ק"ג', emptyText: 'אין עדיין אימונים מהסוג הזה' });
  renderVolumeHistory(volPage.window, selectedVolumeType === 'all');
}

/** רשימה קריאה מתחת לגרף הנפח — מספר מדויק לכל אימון, לא רק גובה עמודה מול ציר מעוגל.
 *  במצב "הכל" מוסיפים גם את סוג האימון לכל שורה, כדי שההשוואה תהיה ברורה */
function renderVolumeHistory(recent, showType) {
  const host = $('#volumeHistory');
  if (!host) return;

  if (!recent.length) { host.replaceChildren(); return; }

  host.replaceChildren(...[...recent].reverse().map((w) => el('div', { class: 'list-item weight-row' },
    el('div', { class: 'li-main' },
      el('div', { class: 'li-title' }, formatDateHe(w.date, { withYear: true })),
      showType ? el('div', { class: 'li-sub' }, workoutTypeLabel(w)) : null,
    ),
    el('div', { class: 'li-side' }, fmtNum(w.totalVolume ?? calcVolume(w), 1), el('small', {}, 'ק"ג')),
  )));
}

/** רשימה קריאה מתחת לגרף: תאריך מדויק + משקל + חזרות, מהחדש לישן */
function renderExerciseHistory(data) {
  const host = $('#progressHistory');
  if (!host) return;

  if (!data.length) { host.replaceChildren(); return; }

  host.replaceChildren(...[...data].reverse().map((d) => el('div', { class: 'list-item weight-row' },
    el('div', { class: 'li-main' },
      el('div', { class: 'li-title' }, formatDateHe(d.date, { withYear: true })),
    ),
    el('div', { class: 'li-side' }, fmtNum(d.maxWeight, 1), el('small', {}, `ק"ג × ${d.bestReps || 0}`)),
  )));
}

export function initProgress() {
  $('#progressWorkoutSelect').addEventListener('change', (e) => {
    selectedExerciseType = e.target.value;
    selected = null; // האימון השתנה — התרגיל הנבחר לא בהכרח קיים בו, נבחר את הראשון מחדש
    exOffset = 0;
    renderProgress();
  });
  $('#progressExercise').addEventListener('change', (e) => {
    selected = e.target.value;
    exOffset = 0;
    renderProgress();
  });
  $('#volumeTypeSelect').addEventListener('change', (e) => {
    selectedVolumeType = e.target.value;
    volOffset = 0;
    renderProgress();
  });
}
