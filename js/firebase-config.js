/* ===================================================================
   firebase-config.js — פרטי החיבור לפרויקט Firebase.

   כל עוד apiKey ריק, שער הכניסה כבוי לגמרי והאפליקציה עובדת
   בדיוק כמו קודם, בלי התחברות. ברגע שממלאים כאן את הערכים
   מקונסולת Firebase (Project settings > Your apps > Web app),
   השער נדלק והכניסה נעשית באישור בלבד.

   הערכים האלה אינם סוד — הם נחשפים ממילא בכל אפליקציית ווב.
   מה שמגן על הנתונים אלה חוקי האבטחה (Security Rules) בצד Firebase.
   =================================================================== */

export const firebaseConfig = {
  apiKey: 'AIzaSyALIV4GUTotmWdaNb6GWF91MJHHZ_ktek0',
  authDomain: 'ori-ak-fitness.firebaseapp.com',
  projectId: 'ori-ak-fitness',
  storageBucket: 'ori-ak-fitness.firebasestorage.app',
  messagingSenderId: '1068333439061',
  appId: '1:1068333439061:web:f7dc639e0022276a34dcdc',
};

/** כתובות המייל שמנהלות את האפליקציה — מאשרות ומסירות משתמשים */
export const ADMIN_EMAILS = [
  'oritikshuv2007@gmail.com',
];

export function isConfigured() {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
}
