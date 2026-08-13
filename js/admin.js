/* ===================================================================
   admin.js — ניהול מי נכנס לאפליקציה.

   כל מי שמתחבר עם גוגל נרשם אוטומטית כ-pending ולא נכנס. עד עכשיו
   הדרך היחידה לאשר אותו הייתה להיכנס לקונסולת Firebase ולשנות שדה
   ביד — כלומר בפועל אי אפשר היה לאשר חבר מהטלפון. המסך הזה עושה
   את זה מתוך האפליקציה.

   מוצג רק למי שמוגדר ב-ADMIN_EMAILS. זו הסתרה נוחה בלבד ולא אבטחה:
   מה שבאמת מונע ממשתמש רגיל לאשר את עצמו הוא firestore.rules.
   =================================================================== */

import { el, openSheet, toast } from './ui.js';
import { currentUser, fetchUsers, setUserStatus } from './auth.js';

/* ---------- מצב ---------- */

const STATUS_LABEL = {
  pending: 'ממתין לאישור',
  approved: 'מאושר',
  blocked: 'הגישה הוסרה',
};

/** האם המשתמש המחובר הוא מנהל. נקבע בהתחברות ונשמר במכשיר */
export function isAdminUser() {
  return Boolean(currentUser()?.isAdmin);
}

/**
 * תקציר קצר לשורת ההגדרות. לא זורק — שורת ההגדרות לא אמורה
 * להיעלם או לשבור את המסך רק בגלל שאין רגע רשת.
 * @returns {Promise<string>}
 */
export async function usersSummary() {
  try {
    const users = await fetchUsers();
    const pending = users.filter((u) => (u.status || 'pending') === 'pending').length;
    const approved = users.filter((u) => u.status === 'approved').length;
    return pending
      ? `${pending} ממתינים לאישור · ${approved} מאושרים`
      : `${approved} מאושרים`;
  } catch {
    return 'לחץ כדי לנהל את המשתמשים';
  }
}

/* ---------- שורת משתמש ---------- */

/*
 * פעולה הרסנית (חסימה / הסרת גישה) דורשת שתי לחיצות על אותו כפתור
 * במקום דיאלוג אישור. confirmSheet משתמש באותו גיליון משותף שהמסך
 * הזה כבר תופס, כך שהוא היה מחליף את הרשימה ומאלץ לפתוח אותה מחדש.
 */
function actionButton(label, cls, onConfirm, { destructive = false } = {}) {
  const btn = el('button', { class: `btn btn-sm ${cls}` }, label);
  let armed = false;
  let timer = null;

  btn.addEventListener('click', async () => {
    if (destructive && !armed) {
      armed = true;
      btn.textContent = 'בטוח?';
      timer = setTimeout(() => { armed = false; btn.textContent = label; }, 3000);
      return;
    }
    clearTimeout(timer);
    btn.disabled = true;
    btn.textContent = 'שומר…';
    try {
      await onConfirm();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = label;
      armed = false;
      throw err;
    }
  });

  return btn;
}

function userRow(user, { isMe, onChange }) {
  const status = user.status || 'pending';

  const actions = [];
  if (isMe) {
    // חסימה עצמית הייתה נועלת את בעל האפליקציה מחוץ לאפליקציה שלו
    actions.push(el('span', { class: 'li-side' }, 'אתה'));
  } else {
    if (status !== 'approved') {
      actions.push(actionButton('אשר', 'btn-primary', () => onChange(user, 'approved')));
    }
    if (status === 'approved') {
      actions.push(actionButton('הסר גישה', 'btn-ghost', () => onChange(user, 'blocked'), { destructive: true }));
    } else if (status === 'pending') {
      actions.push(actionButton('דחה', 'btn-ghost', () => onChange(user, 'blocked'), { destructive: true }));
    }
  }

  return el('div', { class: 'list-item is-static user-row' },
    user.photo
      ? el('img', { class: 'li-thumb user-avatar', src: user.photo, alt: '', referrerpolicy: 'no-referrer' })
      : el('span', { class: 'li-thumb user-avatar user-avatar-blank' }, '👤'),
    el('div', { class: 'li-main' },
      el('div', { class: 'li-title' }, user.name || user.email || 'משתמש'),
      // בלי השם, הכותרת כבר מציגה את המייל — אין טעם לחזור עליו פעמיים
      el('div', { class: 'li-sub' }, user.name ? (user.email || '') : (STATUS_LABEL[status] || status)),
    ),
    el('div', { class: 'user-actions' }, ...actions),
  );
}

/* ---------- המסך ---------- */

function group(title, users, opts) {
  if (!users.length) return null;
  return el('div', { class: 'user-group' },
    el('div', { class: 'user-group-head' }, `${title} (${users.length})`),
    el('div', { class: 'list' }, ...users.map((u) => userRow(u, { ...opts, isMe: u.uid === opts.myUid }))),
  );
}

export async function openUsersSheet() {
  const host = el('div', {}, el('p', { class: 'muted' }, 'טוען משתמשים…'));
  openSheet('👥 ניהול משתמשים', host);

  const myUid = currentUser()?.uid || null;

  async function refresh() {
    let users;
    try {
      users = await fetchUsers();
    } catch (err) {
      console.warn('[Ori Fitness] טעינת המשתמשים נכשלה:', err);
      // permission-denied כאן משמעו כמעט תמיד שחוקי האבטחה עדיין לא
      // מכירים במנהל — בלי המסר הזה זה נראה פשוט כמו "לא עובד"
      const denied = err?.code === 'permission-denied';
      host.replaceChildren(el('div', { class: 'empty-state' },
        el('div', { class: 'empty-icon' }, denied ? '🔒' : '⚠️'),
        el('p', {}, denied
          ? 'אין הרשאה לקרוא את רשימת המשתמשים. צריך לעדכן את חוקי האבטחה ב-Firebase (הקובץ firestore.rules בפרויקט).'
          : 'לא הצלחנו לטעון את המשתמשים. בדוק חיבור לאינטרנט ונסה שוב.'),
        el('button', { class: 'btn btn-secondary', onclick: refresh }, 'נסה שוב'),
      ));
      return;
    }

    const onChange = async (user, status) => {
      await setUserStatus(user.uid, status);
      toast(status === 'approved'
        ? `${user.name || user.email} אושר/ה`
        : `הגישה של ${user.name || user.email} הוסרה`, 'ok');
      await refresh();
    };

    const opts = { myUid, onChange };
    const by = (s) => users.filter((u) => (u.status || 'pending') === s);

    const groups = [
      group('ממתינים לאישור', by('pending'), opts),
      group('מאושרים', by('approved'), opts),
      group('חסומים', by('blocked'), opts),
    ].filter(Boolean);

    host.replaceChildren(
      el('p', { class: 'muted', style: 'margin-bottom:14px' },
        'כל מי שמתחבר מופיע כאן וממתין לאישור שלך. הסרת גישה נכנסת לתוקף גם אם האפליקציה כבר מותקנת אצלו.'),
      ...(groups.length ? groups : [el('div', { class: 'empty-state' },
        el('div', { class: 'empty-icon' }, '👥'),
        el('p', {}, 'עוד אף אחד לא ניסה להתחבר.'))]),
    );
  }

  await refresh();
}
