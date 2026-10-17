import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import deLocale from '../locales/de.json'
import enLocale from '../locales/en.json'

export type LocaleResources = Record<string, Record<string, any>>

/**
 * Initialize i18next with bundled static resources and dynamic locale files loaded via IPC.
 *
 * @param customResources Optional dynamically loaded locales (e.g. from AppData/Locales)
 * @param initialLang Initial language code (default: 'de')
 */
export async function initI18n(customResources?: LocaleResources, initialLang: string = 'de') {
  const resources: Record<string, { translation: Record<string, any> }> = {
    de: { translation: deLocale },
    en: { translation: enLocale }
  }

  if (customResources && typeof customResources === 'object') {
    Object.keys(customResources).forEach((lang) => {
      if (resources[lang]) {
        // Deep merge or overwrite with custom translations
        resources[lang] = {
          translation: {
            ...resources[lang].translation,
            ...customResources[lang]
          }
        }
      } else {
        resources[lang] = {
          translation: customResources[lang]
        }
      }
    })
  }

  await i18n.use(initReactI18next).init({
    resources,
    lng: initialLang || 'de',
    fallbackLng: 'de',
    interpolation: {
      escapeValue: false
    }
  })

  return i18n
}

/**
 * Switch interface language dynamically at runtime.
 */
export async function changeLanguage(lang: string): Promise<void> {
  await i18n.changeLanguage(lang)
}

/**
 * Get current active language code.
 */
export function getCurrentLanguage(): string {
  return i18n.language || 'de'
}

/**
 * Returns list of all available languages loaded into i18n.
 */
export function getAvailableLanguages(): string[] {
  return Object.keys(i18n.services.resourceStore.data || {})
}

export default i18n
