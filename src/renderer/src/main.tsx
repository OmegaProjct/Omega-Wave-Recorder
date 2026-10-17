import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { initI18n } from './lib/i18n'

async function bootstrap() {
  let initialLang = 'de'
  let locales: Record<string, any> = {}

  // 1. Load settings (language preference) via IPC if available
  try {
    if (window.api?.getSettings) {
      const settings = await window.api.getSettings()
      if (settings?.language) {
        initialLang = settings.language
      }
    }
  } catch (err) {
    console.warn('[Bootstrap] Could not load persisted settings:', err)
  }

  // 2. Load custom / dynamic locales via IPC if available
  try {
    if (window.api?.getLocales) {
      const dynamicLocales = await window.api.getLocales()
      if (dynamicLocales && typeof dynamicLocales === 'object') {
        locales = dynamicLocales
      }
    }
  } catch (err) {
    console.warn('[Bootstrap] Could not load dynamic locales via IPC:', err)
  }

  // 3. Initialize i18next
  await initI18n(locales, initialLang)

  // 4. Mount React Application
  const rootElement = document.getElementById('root')
  if (!rootElement) {
    throw new Error('Failed to find root DOM element (#root)')
  }

  const root = ReactDOM.createRoot(rootElement)
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

bootstrap().catch((err) => {
  console.error('[Bootstrap] Fatal initialization error:', err)
})
