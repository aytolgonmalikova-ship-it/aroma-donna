/**
 * Подключение Firebase.
 *
 * Ключи берутся из переменных окружения (файл .env, см. .env.example).
 * Если ключей нет — Firebase не загружается, и приложение работает в ДЕМО-РЕЖИМЕ.
 *
 * Примечание: apiKey веб-приложения Firebase не является секретом — он идентифицирует
 * проект. Защита данных обеспечивается правилами Firestore (файл firestore.rules)
 * и Firebase Authentication, а не скрытием ключа.
 */

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);

let servicesPromise = null;

/**
 * Ленивая загрузка Firebase: библиотека скачивается браузером только если она нужна.
 * Возвращает { auth, db, authApi, dbApi }.
 */
export function getFirebase() {
  if (!isFirebaseConfigured) {
    return Promise.reject(new Error('firebase-not-configured'));
  }
  if (!servicesPromise) {
    servicesPromise = Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
      import('firebase/firestore'),
    ]).then(([appApi, authApi, dbApi]) => {
      const app = appApi.initializeApp(config);
      return {
        auth: authApi.getAuth(app),
        db: dbApi.getFirestore(app),
        authApi,
        dbApi,
      };
    });
  }
  return servicesPromise;
}
