import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Fonts are bundled by Vite (no CDN, no Google Fonts): the app must work with no internet.
// Only the Latin subset: it covers English and Filipino names, and keeps the build small.
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
import './styles/index.css'
import { App } from './App'
import { applyTheme, cachedTheme } from './lib/theme'

// Start with the theme last shown in this browser, before the server says who is signed in (no flash).
applyTheme(cachedTheme())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
