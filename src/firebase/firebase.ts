import { type FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore'
import { connectStorageEmulator, getStorage, type FirebaseStorage } from 'firebase/storage'

interface FirebaseClientConfig {
  apiKey: string
  authDomain: string
  projectId: string
  storageBucket: string
  messagingSenderId: string
  appId: string
  measurementId?: string
}

const requiredFirebaseEnvKeys = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_STORAGE_BUCKET', 'VITE_FIREBASE_MESSAGING_SENDER_ID', 'VITE_FIREBASE_APP_ID'] as const

function getFirebaseConfig(): FirebaseClientConfig {
  const missingKeys = requiredFirebaseEnvKeys.filter((key) => !import.meta.env[key]?.trim())
  if (missingKeys.length > 0) {
    throw new Error(`Firebase の環境変数が未設定です: ${missingKeys.join(', ')}。.env.example を .env.local にコピーして設定してください。`)
  }
  return { apiKey: import.meta.env.VITE_FIREBASE_API_KEY, authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN, projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID, storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET, messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID, appId: import.meta.env.VITE_FIREBASE_APP_ID, measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || undefined }
}

function initializeFirebaseApp(): FirebaseApp {
  return getApps().length > 0 ? getApp() : initializeApp(getFirebaseConfig())
}

export const firebaseApp = initializeFirebaseApp()
export const firebaseAuth: Auth = getAuth(firebaseApp)
export const firestore: Firestore = getFirestore(firebaseApp)
export const firebaseStorage: FirebaseStorage = getStorage(firebaseApp)

if (import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true') {
  connectAuthEmulator(firebaseAuth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(firestore, '127.0.0.1', 8080)
  connectStorageEmulator(firebaseStorage, '127.0.0.1', 9199)
}