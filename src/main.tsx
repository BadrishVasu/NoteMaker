import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { createFirebaseAuth } from './platform/auth'
import { getFirebaseApp } from './platform/firebase'
import { requestPersist } from './platform/persistStorage'
import { getAutoSync } from './platform/prefs'
import { registerServiceWorker } from './platform/serviceWorker'
import { openIdbNoteStore } from './store/idbNoteStore'
import { createFirestoreGateway, openFirestore } from './sync/firestoreGateway'
import type { RemoteGateway } from './sync/remoteGateway'
import type { Clock } from './sync/engine'
import { openSession } from './session'
import './index.css'
import './app.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root is missing from index.html')

// The engine consults no clock of its own (ESLint); this is the real one.
const clock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

// `initializeFirestore` may run once per app, so the gateway is built once and shared by every
// session this tab opens (an account switch opens a second one).
let gateway: RemoteGateway | null = null

const auth = createFirebaseAuth()
const open = (uid: string) =>
  openSession(uid, {
    openStore: openIdbNoteStore,
    gateway: (gateway ??= createFirestoreGateway(openFirestore(getFirebaseApp()))),
    clock,
    autoSync: getAutoSync,
    requestPersist: () => requestPersist(),
    // Surfaced to the console until the "couldn't sync" UI exists; each is also a retry or a park.
    onProblem: (problem) => console.warn('NoteMaker sync:', problem),
  })

createRoot(root).render(
  <StrictMode>
    <App auth={auth} openSession={open} />
  </StrictMode>,
)

registerServiceWorker()
