import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'

/**
 * App and Auth only.
 *
 * The architecture originally placed `initializeFirestore` here too. It lives in
 * `sync/firestoreGateway.ts` instead, so that the ESLint boundary "only firestoreGateway.ts may
 * import firebase/firestore" holds with *no* exceptions — a boundary with one sanctioned exception
 * is a boundary that grows a second one. Nothing outside the gateway needs a Firestore handle, so
 * this costs nothing. (builder, 2026-08-26)
 *
 * Analytics is deliberately never initialised (ticket 04).
 */

const required = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
] as const

function readConfig() {
  const env = import.meta.env as unknown as Record<string, string | undefined>
  const missing = required.filter((key) => !env[key])
  if (missing.length > 0) {
    // Fail loudly at boot rather than with an opaque Firebase error on first use. A missing
    // variable means the Cloudflare Pages environment is misconfigured, and that is worth
    // knowing at the first paint of the first deploy.
    throw new Error(
      `Firebase config missing: ${missing.join(', ')}. ` +
        'Set these in .env.local locally, and in the Cloudflare Pages environment for deploys. ' +
        'See .env.example.',
    )
  }
  return {
    apiKey: env.VITE_FIREBASE_API_KEY!,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN!,
    projectId: env.VITE_FIREBASE_PROJECT_ID!,
    appId: env.VITE_FIREBASE_APP_ID!,
  }
}

let app: FirebaseApp | undefined
let auth: Auth | undefined

export function getFirebaseApp(): FirebaseApp {
  app ??= initializeApp(readConfig())
  return app
}

export function getFirebaseAuth(): Auth {
  auth ??= getAuth(getFirebaseApp())
  return auth
}
