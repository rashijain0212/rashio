import { initializeApp } from 'firebase/app'
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  connectAuthEmulator,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  inMemoryPersistence,
  initializeAuth,
} from 'firebase/auth'
import {
  doc,
  initializeFirestore,
  persistentLocalCache,
  memoryLocalCache,
  persistentMultipleTabManager,
  runTransaction,
  collection,
  connectFirestoreEmulator,
} from 'firebase/firestore'
import type { Db, DocData, Tx } from './store'

// Public web config from environment variables (.env.local, git-ignored).
// These values are not secret; access is enforced by Firestore rules.
const env = import.meta.env
const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
}
if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  throw new Error('Firebase settings are missing: copy .env.example to .env.local and fill in your project values.')
}

export const app = initializeApp(firebaseConfig)

/**
 * "Cloud-only" mode: when the browser's storage (IndexedDB) is locked or broken,
 * keep sign-in and the data cache in memory. Firestore is still the source of
 * truth, so nothing is lost; the user just signs in again next visit.
 */
export const CLOUD_ONLY = (() => {
  try {
    return sessionStorage.getItem('mt-cloud-only') === '1'
  } catch {
    return true
  }
})()

export function enableCloudOnlyAndReload() {
  try {
    sessionStorage.setItem('mt-cloud-only', '1')
  } catch {
    /* ignore */
  }
  window.location.reload()
}

export const auth = initializeAuth(app, {
  persistence: CLOUD_ONLY ? inMemoryPersistence : [indexedDBLocalPersistence, browserLocalPersistence],
  popupRedirectResolver: browserPopupRedirectResolver,
})
export const googleProvider = new GoogleAuthProvider()
googleProvider.setCustomParameters({ prompt: 'select_account' })

// Persistent cache keeps reads low: unchanged docs are served from IndexedDB.
// Firestore remains the source of truth.
export const firestore = initializeFirestore(app, {
  ignoreUndefinedProperties: true,
  localCache: CLOUD_ONLY ? memoryLocalCache() : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
})

export const firestoreDb: Db = {
  newId: () => doc(collection(firestore, '_ids')).id,
  runTransaction: (fn) =>
    runTransaction(firestore, async (t) => {
      const tx: Tx = {
        get: async (path) => {
          const snap = await t.get(doc(firestore, path))
          return snap.exists() ? (snap.data() as DocData) : null
        },
        set: (path, data) => void t.set(doc(firestore, path), data),
        delete: (path) => void t.delete(doc(firestore, path)),
      }
      return fn(tx)
    }),
}

/** Local end-to-end testing only (VITE_USE_EMULATORS=1); never set in production builds. */
export const USE_EMULATORS = import.meta.env.VITE_USE_EMULATORS === '1'
if (USE_EMULATORS) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(firestore, '127.0.0.1', 8080)
}
