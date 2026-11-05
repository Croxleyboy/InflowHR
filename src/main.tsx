import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './admin.css'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import { reportError } from './lib/errorReporting'

window.addEventListener('error', (event) => {
  if (event.error instanceof Error) reportError(event.error)
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason instanceof Error ? event.reason : new Error(String(event.reason))
  reportError(reason)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
