/* ===================================================================
   charts.js — גרפים ב-SVG טהור, בלי ספריות חיצוניות.
   =================================================================== */

const NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/**
 * צבעי הגרפים נלקחים מערכת הנושא הפעילה, כדי שהם ייראו נכון
 * גם בערכה הבהירה וגם במצב לילה.
 */
function themeColors() {
  const s = getComputedStyle(document.documentElement);
  const get = (name, fallback) => (s.getPropertyValue(name) || '').trim() || fallback;
  return {
    accent: get('--accent', '#2f2a22'),
    accent2: get('--accent-2', '#1d6f8f'),
    gold: get('--gold-deep', '#1d6b6f'),
    grid: get('--line', '#dbd1be'),
    label: get('--text-faint', '#9b9284'),
    surface: get('--bg-elev', '#fffdf7'),
  };
}

function niceTicks(min, max, count = 4) {
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad; max += pad;
  }
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = start; v <= end + step * 0.001; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return ticks;
}

/**
 * גרף קו עם נקודות.
 * @param {HTMLElement} host
 * @param {{label:string, value:number}[]} points  — לפי סדר כרונולוגי
 * @param {{unit?:string, color?:string, area?:boolean, emptyText?:string}} opts
 */
export function lineChart(host, points, opts = {}) {
  const {
    unit = '',
    area = true,
    emptyText = 'אין עדיין נתונים להצגה',
  } = opts;

  const C = themeColors();
  const color = opts.color || C.gold;

  host.replaceChildren();

  if (!points.length) {
    const empty = document.createElement('div');
    empty.className = 'chart-empty';
    empty.textContent = emptyText;
    host.append(empty);
    return;
  }

  // נקודה בודדת — מציגים ערך גדול במקום גרף חסר משמעות
  if (points.length === 1) {
    const single = document.createElement('div');
    single.className = 'chart-empty';
    single.innerHTML = `<b style="font-size:1.6rem;color:${color}">${points[0].value}${unit ? ' ' + unit : ''}</b>` +
                       `<div style="margin-top:6px">${points[0].label} — צריך עוד רישום אחד כדי לראות מגמה</div>`;
    host.append(single);
    return;
  }

  const W = 340, H = 200;
  const padTop = 14, padBottom = 26, padStart = 16, padEnd = 42; // padEnd = צד ימין ב-RTL? לא: הצירים נשארים LTR
  const plotW = W - padStart - padEnd;
  const plotH = H - padTop - padBottom;

  const values = points.map((p) => p.value);
  const ticks = niceTicks(Math.min(...values), Math.max(...values), 4);
  const yMin = ticks[0], yMax = ticks[ticks.length - 1];
  const yRange = (yMax - yMin) || 1;

  const x = (i) => padStart + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v) => padTop + plotH - ((v - yMin) / yRange) * plotH;

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'גרף התקדמות' });

  // קווי רשת + תוויות ציר Y
  for (const t of ticks) {
    const yy = y(t);
    svg.append(svgEl('line', {
      x1: padStart, y1: yy, x2: padStart + plotW, y2: yy,
      stroke: C.grid, 'stroke-width': 1,
    }));
    const label = svgEl('text', {
      x: padStart + plotW + 6, y: yy + 4,
      fill: C.label, 'font-size': 10, 'text-anchor': 'start', direction: 'ltr',
    });
    label.textContent = String(t);
    svg.append(label);
  }

  // שטח מתחת לקו
  const linePts = points.map((p, i) => `${x(i)},${y(p.value)}`);
  if (area) {
    const gradId = 'grad-' + Math.random().toString(36).slice(2, 8);
    const defs = svgEl('defs');
    const grad = svgEl('linearGradient', { id: gradId, x1: 0, y1: 0, x2: 0, y2: 1 });
    grad.append(svgEl('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': .32 }));
    grad.append(svgEl('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': 0 }));
    defs.append(grad);
    svg.append(defs);
    svg.append(svgEl('path', {
      d: `M ${x(0)},${padTop + plotH} L ${linePts.join(' L ')} L ${x(points.length - 1)},${padTop + plotH} Z`,
      fill: `url(#${gradId})`,
    }));
  }

  // הקו
  svg.append(svgEl('polyline', {
    points: linePts.join(' '),
    fill: 'none', stroke: color, 'stroke-width': 2.5,
    'stroke-linejoin': 'round', 'stroke-linecap': 'round',
  }));

  // נקודות
  points.forEach((p, i) => {
    const c = svgEl('circle', { cx: x(i), cy: y(p.value), r: 3.5, fill: C.surface, stroke: color, 'stroke-width': 2 });
    const title = svgEl('title');
    title.textContent = `${p.label}: ${p.value}${unit ? ' ' + unit : ''}`;
    c.append(title);
    svg.append(c);
  });

  // תוויות ציר X — ראשונה, אמצעית ואחרונה, כדי לא לצפוף
  const idxs = points.length <= 3
    ? points.map((_, i) => i)
    : [0, Math.floor((points.length - 1) / 2), points.length - 1];
  for (const i of idxs) {
    const t = svgEl('text', {
      x: x(i), y: H - 8, fill: C.label, 'font-size': 10,
      'text-anchor': i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle',
    });
    t.textContent = points[i].label;
    svg.append(t);
  }

  host.append(svg);
}

/**
 * גרף עמודות פשוט.
 * @param {{label:string, value:number}[]} points
 */
export function barChart(host, points, opts = {}) {
  const { unit = '', emptyText = 'אין עדיין נתונים להצגה' } = opts;

  const C = themeColors();
  const color = opts.color || C.gold;

  host.replaceChildren();

  if (!points.length) {
    const empty = document.createElement('div');
    empty.className = 'chart-empty';
    empty.textContent = emptyText;
    host.append(empty);
    return;
  }

  const W = 340, H = 180;
  const padTop = 12, padBottom = 24, padStart = 12, padEnd = 42;
  const plotW = W - padStart - padEnd;
  const plotH = H - padTop - padBottom;

  const max = Math.max(...points.map((p) => p.value)) || 1;
  const ticks = niceTicks(0, max, 3);
  const yMax = ticks[ticks.length - 1] || 1;

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'גרף עמודות' });

  for (const t of ticks) {
    const yy = padTop + plotH - (t / yMax) * plotH;
    svg.append(svgEl('line', { x1: padStart, y1: yy, x2: padStart + plotW, y2: yy, stroke: C.grid, 'stroke-width': 1 }));
    const label = svgEl('text', { x: padStart + plotW + 6, y: yy + 4, fill: C.label, 'font-size': 10, direction: 'ltr' });
    label.textContent = t >= 1000 ? (t / 1000) + 'k' : String(t);
    svg.append(label);
  }

  const slot = plotW / points.length;
  const barW = Math.min(24, slot * 0.62);

  points.forEach((p, i) => {
    const h = (p.value / yMax) * plotH;
    const bx = padStart + slot * i + (slot - barW) / 2;
    const rect = svgEl('rect', {
      x: bx, y: padTop + plotH - h, width: barW, height: Math.max(h, 1),
      rx: Math.min(4, barW / 2), fill: color, opacity: .85,
    });
    const title = svgEl('title');
    title.textContent = `${p.label}: ${p.value}${unit ? ' ' + unit : ''}`;
    rect.append(title);
    svg.append(rect);
  });

  const idxs = points.length <= 3
    ? points.map((_, i) => i)
    : [0, Math.floor((points.length - 1) / 2), points.length - 1];
  for (const i of idxs) {
    const t = svgEl('text', {
      x: padStart + slot * i + slot / 2, y: H - 7,
      fill: C.label, 'font-size': 10, 'text-anchor': 'middle',
    });
    t.textContent = points[i].label;
    svg.append(t);
  }

  host.append(svg);
}
