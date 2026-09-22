import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/base.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

/* Production only: in dev the worker would serve yesterday's modules over
 * Vite's HMR and make every change look like it did nothing. See public/sw.js
 * for why there is one at all. */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Unsupported, or blocked by settings. The app works without it; only
      // the install prompt and the offline shell are lost.
    })
  })
}
