import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppShell } from './app/AppShell'
import { registerServiceWorker } from './platform/serviceWorker'
import './index.css'
import './app.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root is missing from index.html')

// Auth is step 7 (build brief): AppShell opens straight onto the list against a fixed local
// uid (`local`) — see the comment on `AppShell`'s `LOCAL_UID` constant for the swap-over point.
createRoot(root).render(
  <StrictMode>
    <AppShell />
  </StrictMode>,
)

registerServiceWorker()
