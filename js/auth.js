/* ===================================================================
   auth.js — התחברות עם גוגל ואישור כניסה.

   הזרימה:
     1. המשתמש לוחץ "התחברות" ונכנס עם חשבון גוגל.
     2. נוצר עבורו מסמך ב-users/{uid} עם status: 'pending'.
     3. כל עוד הוא pending הוא רואה הודעת המתנה ולא נכנס לאפליקציה.
     4. אורי (ADMIN_EMAILS) מאושר אוטומטית, ויכול לשנות סטטוס לאחרים.
     5. status: 'blocked' חוסם כניסה גם למי שכבר נכנס בעבר.

   ה-SDK נטען מ-CDN כמודול ES — אין npm בפרויקט הזה, וזו הדרך
   היחידה לצרוך את Firebase בלי שלב בנייה.
   =================================================================== */

import { firebaseConfig, ADMIN_EMAILS } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.0';

/* המצב האחרון שנרשם במכשיר. נחוץ כדי שהאפליקציה תמשיך לעבוד אופליין:
   בלי אינטרנט אי אפשר לטעון את ה-SDK או לאמת מול השרת, ואסור שזה
   ינעל משתמש שכבר אושר מחוץ לנתונים שלו. */
const LOCAL_STATE_KEY = 'oriFitnessAuthState';

function readLocalState() {
  try { return JSON.parse(localStorage.getItem(LOCAL_STATE_KEY) || 'null'); }
  catch { return null; }
}

function writeLocalState(state) {
  try { localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(state)); }
  catch { /* אחסון חסום — לא קריטי */ }
}

let sdk = null;

async function loadSdk() {
  if (sdk) return sdk;
  const [appMod, authMod, storeMod] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  const app = appMod.initializeApp(firebaseConfig);
  sdk = {
    auth: authMod.getAuth(app),
    db: storeMod.getFirestore(app),
    ...authMod,
    ...storeMod,
  };
  return sdk;
}

/*
 * שום שלב בהתחברות לא נשאר תלוי לנצח.
 *
 * ברשת חלשה — סלולר, מעלית, ווייפיי גרוע — קריאה ל-Firebase יכולה פשוט
 * לא לחזור. בלי תקרת זמן הכפתור נשאר "טוען…" מושבת לתמיד, וזה נראה
 * למשתמש בדיוק כמו אפליקציה שבורה. עדיף להיכשל בגלוי ולתת לנסות שוב.
 */
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(
      () => reject(Object.assign(new Error('timeout'), { code: 'app/timeout' })), ms)),
  ]);
}

function isAdmin(email) {
  return ADMIN_EMAILS.map((e) => e.toLowerCase()).includes((email || '').toLowerCase());
}

/**
 * מביא את רשומת המשתמש, ויוצר אותה בפעם הראשונה.
 * @returns {Promise<'approved'|'pending'|'blocked'>}
 */
async function resolveStatus(user) {
  const s = await loadSdk();
  const ref = s.doc(s.db, 'users', user.uid);
  const snap = await s.getDoc(ref);

  if (!snap.exists()) {
    const status = isAdmin(user.email) ? 'approved' : 'pending';
    await s.setDoc(ref, {
      email: user.email || '',
      name: user.displayName || '',
      photo: user.photoURL || '',
      status,
      createdAt: s.serverTimestamp(),
      lastSeen: s.serverTimestamp(),
    });
    return status;
  }

  const data = snap.data() || {};
  // אורי מאושר תמיד, גם אם הרשומה נוצרה לפני שהוגדר כמנהל
  const status = isAdmin(user.email) ? 'approved' : (data.status || 'pending');
  await s.setDoc(ref, { lastSeen: s.serverTimestamp(), status }, { merge: true });
  return status;
}

/* ---------- ניהול משתמשים (למנהל בלבד) ---------- */

/*
 * קריאה וכתיבה של רשומות משתמשים אחרים יושבות כאן, ולא ב-admin.js,
 * כי auth.js הוא הקובץ היחיד שמחזיק את החיבור ל-Firebase. admin.js
 * אחראי רק על המסך. מי באמת רשאי לעשות את זה נקבע בחוקי האבטחה
 * בצד Firebase (firestore.rules) — לא בקוד שרץ בדפדפן.
 */

/** @returns {Promise<Array<{uid:string,email:string,name:string,photo:string,status:string}>>} */
export async function fetchUsers() {
  const s = await loadSdk();
  const snap = await s.getDocs(s.collection(s.db, 'users'));
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}

/** @param {'approved'|'pending'|'blocked'} status */
export async function setUserStatus(uid, status) {
  const s = await loadSdk();
  await s.setDoc(s.doc(s.db, 'users', uid), { status }, { merge: true });
}

/* ---------- הנתונים בענן ---------- */

/*
 * גם כאן, כמו ברשימת המשתמשים: Firebase נשאר סגור בתוך auth.js.
 * cloud.js מחזיק את היגיון הסנכרון ולא נוגע ב-SDK.
 * הנתונים יושבים תחת users/{uid}/records, ולפי firestore.rules
 * רק בעל הרשומה ניגש אליהן.
 */

function requireUid() {
  const uid = readLocalState()?.uid;
  if (!uid) throw Object.assign(new Error('not signed in'), { code: 'app/no-user' });
  return uid;
}

/** @returns {Promise<Array<{id:string, store:string, key:string, value:any, updatedAt:number}>>} */
export async function fetchRecords() {
  const s = await loadSdk();
  const snap = await s.getDocs(s.collection(s.db, 'users', requireUid(), 'records'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function putRecord(id, data) {
  const s = await loadSdk();
  await s.setDoc(s.doc(s.db, 'users', requireUid(), 'records', id), data);
}

export async function signOutUser() {
  try {
    const s = await loadSdk();
    await s.signOut(s.auth);
  } finally {
    writeLocalState(null);
    location.reload();
  }
}

/** פרטי המשתמש המחובר, או null. משמש את מסך ההגדרות */
export function currentUser() {
  return readLocalState();
}

/**
 * מנהל את כל מסך הכניסה. נקרא מ-gate.js.
 * @param {{openGate:Function, closeGate:Function, setNote:Function}} ui
 */
export async function startAuthFlow({ openGate, closeGate, setNote }) {
  const btn = document.querySelector('#gateSignInBtn');
  const cached = readLocalState();

  // ---- אופליין: מסתמכים על ההחלטה האחרונה שהתקבלה מהשרת ----
  if (!navigator.onLine) {
    if (cached?.status === 'approved') { closeGate(); return; }
    openGate();
    setNote('אין חיבור לאינטרנט. צריך להתחבר פעם אחת כדי להיכנס.', 'pending');
    if (btn) { btn.disabled = false; btn.textContent = 'נסה שוב'; }
    return;
  }

  /*
   * מי שכבר אושר בעבר נכנס מיד, והבדיקה מול השרת ממשיכה ברקע.
   *
   * קודם האפליקציה חיכתה לסיבוב מלא מול גוגל לפני שהציגה משהו —
   * טעינת ה-SDK מרשת חיצונית ואז אימות. בסלולר זה שניות של מסך ריק
   * בכל פתיחה, בשביל תשובה שכמעט תמיד זהה לזו שכבר שמורה כאן.
   *
   * אם הבדיקה ברקע תגלה שהגישה הוסרה, השער נסגר חזרה (handleUser).
   * הסיכון הוא חלון של רגע שבו מוסר-גישה רואה את הנתונים של עצמו
   * במכשיר שלו — ובתמורה כל כניסה רגילה נפתחת מיד.
   */
  const optimistic = cached?.status === 'approved';
  if (optimistic) closeGate();

  let s;
  try {
    s = await withTimeout(loadSdk(), 20000);
  } catch (err) {
    console.warn('[Ori Fitness] טעינת Firebase נכשלה:', err);
    // הרשת קיימת אבל ה-SDK לא נטען — לא נועלים מי שכבר אושר
    if (cached?.status === 'approved') { closeGate(); return; }
    setNote(err?.code === 'app/timeout'
      ? 'החיבור לשרת לוקח יותר מדי זמן. בדוק את החיבור לאינטרנט ונסה שוב.'
      : 'לא הצלחנו להתחבר לשרת. נסה שוב מאוחר יותר.', 'denied');
    if (btn) { btn.disabled = false; btn.textContent = 'נסה שוב'; btn.onclick = () => location.reload(); }
    return;
  }

  const provider = new s.GoogleAuthProvider();

  /*
   * חלון קופץ בכל מכשיר, כולל טלפון — למרות שקודם העדפנו כאן הפניה.
   *
   * הסיבה להיפוך: האפליקציה יושבת על ori-ak-fitness.github.io, בעוד דף
   * הביניים של ההתחברות יושב על ori-ak-fitness.firebaseapp.com. דפדפנים
   * חוסמים היום אחסון של אתר צד-שלישי, ולכן דף הביניים הזה כבר לא מצליח
   * להחזיר את התשובה לאפליקציה — הוא נטען לבן ונתקע, וזה בדיוק מה שקרה
   * בטלפון. חלון קופץ לא סובל מזה: הוא מדבר עם הדף שפתח אותו ישירות.
   *
   * הפניה נשארת רק כגיבוי, אם החלון הקופץ נחסם בפועל (למטה).
   */

  async function handleUser(user) {
    if (!user) {
      writeLocalState(null);
      openGate();
      setNote('הכניסה באישור בעלי האפליקציה בלבד.');
      // אותו כיתוב כמו למטה: המאזין הזה רץ אחרי שהכפתור כבר הוגדר,
      // ובלי זה הוא היה דורס אותו בחזרה ל"התחברות" סתמי
      if (btn) { btn.disabled = false; btn.textContent = 'התחברות עם Google'; }
      return;
    }

    if (btn) { btn.disabled = true; btn.textContent = 'בודק הרשאה…'; }

    let status;
    try {
      status = await withTimeout(resolveStatus(user), 20000);
    } catch (err) {
      console.warn('[Ori Fitness] בדיקת ההרשאה נכשלה:', err);
      // שסתום ביטחון: מנהל נכנס גם אם מסד הנתונים לא זמין (חוקי הרשאות
      // שעדיין לא הודבקו, מכסה שנגמרה, תקלה בצד Firebase). בלי זה תקלה
      // כזו הייתה נועלת את בעל האפליקציה מחוץ לאפליקציה שלו עצמו.
      if (isAdmin(user.email)) {
        writeLocalState({
          uid: user.uid, email: user.email || '', name: user.displayName || '',
          photo: user.photoURL || '', status: 'approved', isAdmin: true,
        });
        closeGate();
        return;
      }
      if (cached?.status === 'approved') { closeGate(); return; }
      /*
       * מפרידים בין שלוש תקלות שונות לגמרי, כי "נסה שוב" סתמי שולח את
       * המשתמש ללחוץ שוב ושוב על משהו שלעולם לא יצליח מעצמו:
       * חסימת הרשאות = תקלת הגדרה שרק בעל האפליקציה יכול לפתור,
       * תקרת זמן/רשת = כן שווה לנסות שוב.
       */
      const denied = err?.code === 'permission-denied';
      setNote(denied
        ? `נכנסת עם ${user.email}, אבל השרת חסם את בדיקת ההרשאה. זו תקלת הגדרה — פנה לבעל האפליקציה.`
        : err?.code === 'app/timeout'
          ? 'בדיקת ההרשאה לוקחת יותר מדי זמן. בדוק את החיבור ונסה שוב.'
          : 'לא הצלחנו לבדוק את ההרשאה. נסה לרענן.', 'denied');
      if (btn) {
        btn.disabled = false;
        btn.textContent = denied ? 'התנתק' : 'נסה שוב';
        btn.onclick = denied ? () => signOutUser() : () => location.reload();
      }
      return;
    }

    writeLocalState({
      uid: user.uid,
      email: user.email || '',
      name: user.displayName || '',
      photo: user.photoURL || '',
      status,
      isAdmin: isAdmin(user.email),
    });

    if (status === 'approved') { closeGate(); return; }

    openGate();
    if (status === 'blocked') {
      setNote('הגישה שלך לאפליקציה הוסרה.', 'denied');
    } else {
      setNote(`נרשמת בהצלחה (${user.email}). הכניסה תיפתח ברגע שתאושר.`, 'pending');
    }
    if (btn) { btn.disabled = false; btn.textContent = 'התנתק'; btn.onclick = () => signOutUser(); }
  }

  // קליטת חזרה מהפניה. ההפניה היא רק מסלול גיבוי היום, אבל מי שנתקע
  // באמצע כזו קודם עדיין צריך שהתשובה תיקלט — לפני שמאזינים למצב.
  try { await withTimeout(s.getRedirectResult(s.auth), 15000); } catch (err) {
    // תקרת זמן כאן אינה שגיאה שכדאי להציג: רוב הפעמים המשתמש לא הגיע
    // מהפניה בכלל, והמאזין שלמטה עדיין יקלוט התחברות תקינה בעצמו
    if (err?.code !== 'auth/no-auth-event' && err?.code !== 'app/timeout') {
      console.warn('[Ori Fitness] redirect:', err);
      // חשוב במיוחד בטלפון: כשההתחברות מתבצעת ב-redirect, כישלון בחזרה
      // ממנו הוא בדיוק המקרה שבו נראה כאילו "לחצתי ולא קרה כלום"
      setNote(`החזרה מההתחברות נכשלה: ${err?.code || 'שגיאה'}`, 'denied');
    }
  }

  s.onAuthStateChanged(s.auth, (user) => { handleUser(user); });

  if (btn) {
    btn.disabled = false;
    btn.textContent = 'התחברות עם Google';
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = 'מתחבר…';

      try {
        await s.signInWithPopup(s.auth, provider);
      } catch (err) {
        // ביטול יזום של המשתמש — לא שגיאה, ואסור להמשיך ממנו להפניה,
        // אחרת סגירת החלון הייתה זורקת אותו החוצה מהאפליקציה
        if (err?.code === 'auth/popup-closed-by-user' || err?.code === 'auth/cancelled-popup-request') {
          btn.disabled = false;
          btn.textContent = 'התחברות עם Google';
          return;
        }
        // חלון קופץ נחסם ממש — רק אז נופלים להפניה
        if (['auth/popup-blocked',
             'auth/operation-not-supported-in-this-environment']
            .includes(err?.code)) {
          try { await s.signInWithRedirect(s.auth, provider); return; }
          catch (e2) {
            console.warn('[Ori Fitness] redirect נכשל:', e2);
            setNote(`ההפניה נכשלה: ${e2?.code || e2?.message || 'שגיאה'}`, 'denied');
            btn.disabled = false;
            btn.textContent = 'נסה שוב';
            return;
          }
        }
        console.warn('[Ori Fitness] התחברות נכשלה:', err);
        // מציגים את קוד השגיאה על המסך ולא רק בקונסול: בטלפון אין דרך
        // לפתוח קונסול, ובלי זה כל תקלה נראית פשוט כמו "לא עובד"
        setNote(`ההתחברות נכשלה: ${err?.code || err?.message || 'שגיאה לא ידועה'}`, 'denied');
        btn.disabled = false;
        btn.textContent = 'נסה שוב';
      }
    };
  }
}
