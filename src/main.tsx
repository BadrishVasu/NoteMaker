import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SignInSmokeTest } from './app/SignInSmokeTest'
import { registerServiceWorker } from './platform/serviceWorker'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root is missing from index.html')

createRoot(root).render(
  <StrictMode>
    <SignInSmokeTest />
  </StrictMode>,
)

registerServiceWorker()
