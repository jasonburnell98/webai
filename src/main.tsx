import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Note: StrictMode is disabled in development because it causes double-mounting
// which aborts Supabase requests. In production, this doesn't happen.
// StrictMode was causing AbortError issues with the auth flow.
createRoot(document.getElementById('root')!).render(
  <App />
)
