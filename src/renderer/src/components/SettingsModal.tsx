import React, { useState, useEffect } from 'react'
import {
  Settings,
  Languages,
  Headphones,
  BellRing,
  FolderOpen,
  RotateCcw,
  Check,
  X,
  Volume2,
  HardDrive
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface SettingsModalProps {
  onClose: () => void
  initialTab?: 'language' | 'audio' | 'notifications'
}

interface AudioDevice {
  deviceId: string
  label: string
}

interface SilencedWarning {
  id: string
  title: string
  description: string
  isSilenced: boolean
}

const DEFAULT_WARNINGS: SilencedWarning[] = [
  {
    id: 'wasapi_process_disconnect',
    title: 'Ziel-Anwendung geschlossen (WASAPI)',
    description: 'Benachrichtigung, wenn ein aufgenommenes Programm (z. B. Spotify) unerwartet beendet wird.',
    isSilenced: false
  },
  {
    id: 'delete_cut_confirm',
    title: 'Bestätigung vor Schnittaktionen',
    description: 'Sicherheitsabfrage vor dem Löschen oder Beschneiden von Spuren.',
    isSilenced: false
  },
  {
    id: 'unsaved_project_confirm',
    title: 'Warnung bei ungespeichertem Projekt',
    description: 'Bestätigung anfordern, wenn das Programm mit ungesicherten Aufnahmen geschlossen wird.',
    isSilenced: false
  },
  {
    id: 'buffer_underrun_notice',
    title: 'Audio-Buffer Warnung',
    description: 'Hinweis bei drohendem Puffer-Überlauf oder Dropouts während intensiver Festplattenaktivität.',
    isSilenced: false
  }
]

export const SettingsModal: React.FC<SettingsModalProps> = ({
  onClose,
  initialTab = 'language'
}) => {
  const { t, i18n } = useTranslation()
  const [activeTab, setActiveTab] = useState<'language' | 'audio' | 'notifications'>(initialTab)

  // Language state
  const [currentLang, setCurrentLang] = useState(i18n.language || 'de')
  const [availableLocales, setAvailableLocales] = useState<string[]>(['de', 'en'])

  // Audio state
  const [sampleRate, setSampleRate] = useState<number>(48000)
  const [outputDevices, setOutputDevices] = useState<AudioDevice[]>([])
  const [defaultOutputDevice, setDefaultOutputDevice] = useState<string>('default')
  const [recordingsPath, setRecordingsPath] = useState<string>('')
  const [projectsPath, setProjectsPath] = useState<string>('')

  // Notifications / Warnings state
  const [warnings, setWarnings] = useState<SilencedWarning[]>(DEFAULT_WARNINGS)
  const [hasSaved, setHasSaved] = useState(false)

  // Load saved settings & audio devices
  useEffect(() => {
    async function initSettings() {
      try {
        if (window.api?.getSettings) {
          const s = await window.api.getSettings()
          if (s) {
            if (s.language) {
              setCurrentLang(s.language)
              i18n.changeLanguage(s.language)
            }
            if (s.sampleRate) setSampleRate(s.sampleRate)
            if (s.defaultOutputDevice) setDefaultOutputDevice(s.defaultOutputDevice)
            if (s.recordingsPath) setRecordingsPath(s.recordingsPath)
            if (s.projectsPath) setProjectsPath(s.projectsPath)
            if (s.silencedWarnings) {
              setWarnings((prev) =>
                prev.map((w) => ({
                  ...w,
                  isSilenced: s.silencedWarnings.includes(w.id)
                }))
              )
            }
          }
        }

        if (window.api?.getAvailableLocales) {
          const locs = await window.api.getAvailableLocales()
          if (locs && locs.length > 0) setAvailableLocales(locs)
        }

        if (navigator.mediaDevices?.enumerateDevices) {
          const devices = await navigator.mediaDevices.enumerateDevices()
          const outputs = devices
            .filter((d) => d.kind === 'audiooutput')
            .map((d, idx) => ({
              deviceId: d.deviceId,
              label: d.label || `Ausgabegerät ${idx + 1}`
            }))
          setOutputDevices(outputs)
        }
      } catch (err) {
        console.warn('Failed to load settings:', err)
      }
    }
    initSettings()
  }, [i18n])

  const handleLanguageChange = (lang: string) => {
    setCurrentLang(lang)
    i18n.changeLanguage(lang)
  }

  const handleOpenLocalesFolder = async () => {
    try {
      if (window.api?.openLocalesFolder) {
        await window.api.openLocalesFolder()
      } else if (window.api?.openPath) {
        await window.api.openPath('src\\renderer\\src\\locales')
      }
    } catch (e) {
      console.warn('Failed to open locales folder:', e)
    }
  }

  const handleToggleWarning = (id: string) => {
    setWarnings((prev) =>
      prev.map((w) => (w.id === id ? { ...w, isSilenced: !w.isSilenced } : w))
    )
  }

  const handleResetAllWarnings = () => {
    setWarnings((prev) => prev.map((w) => ({ ...w, isSilenced: false })))
  }

  const handleSave = async () => {
    const silencedIds = warnings.filter((w) => w.isSilenced).map((w) => w.id)
    const newSettings = {
      language: currentLang,
      sampleRate,
      defaultOutputDevice,
      recordingsPath,
      projectsPath,
      silencedWarnings: silencedIds
    }

    try {
      if (window.api?.saveSettings) {
        await window.api.saveSettings(newSettings)
      }
      setHasSaved(true)
      setTimeout(() => {
        setHasSaved(false)
        onClose()
      }, 400)
    } catch (err) {
      console.error('Failed to save settings:', err)
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[5000] p-4 select-none animate-in fade-in duration-150">
      <div className="bg-[#24272c] border border-gray-700/80 w-full max-w-2xl rounded-xl shadow-2xl overflow-hidden flex flex-col text-xs text-gray-300">
        {/* Header */}
        <div className="bg-[#1a1d21] px-5 py-3.5 border-b border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings size={16} className="text-omega-accent" />
            <h2 className="text-sm font-bold text-white tracking-wide">
              {t('settings.title', 'Programmeinstellungen')}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center border-b border-gray-800 bg-[#1e2126] px-5">
          <button
            onClick={() => setActiveTab('language')}
            className={`py-2.5 px-4 font-semibold text-xs border-b-2 flex items-center gap-2 transition-all ${
              activeTab === 'language'
                ? 'border-omega-accent text-white'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <Languages size={14} />
            <span>Sprache & Lokalisierung</span>
          </button>
          <button
            onClick={() => setActiveTab('audio')}
            className={`py-2.5 px-4 font-semibold text-xs border-b-2 flex items-center gap-2 transition-all ${
              activeTab === 'audio'
                ? 'border-omega-accent text-white'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <Headphones size={14} />
            <span>Audio & I/O</span>
          </button>
          <button
            onClick={() => setActiveTab('notifications')}
            className={`py-2.5 px-4 font-semibold text-xs border-b-2 flex items-center gap-2 transition-all ${
              activeTab === 'notifications'
                ? 'border-omega-accent text-white'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <BellRing size={14} />
            <span>Meldungen & Warnungen</span>
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-6 overflow-y-auto max-h-[60vh] space-y-5">
          {/* Reiter Sprache */}
          {activeTab === 'language' && (
            <div className="space-y-4">
              <div>
                <label className="block text-gray-400 font-semibold mb-1.5">
                  Oberflächensprache:
                </label>
                <select
                  value={currentLang}
                  onChange={(e) => handleLanguageChange(e.target.value)}
                  className="w-full bg-[#1a1d21] border border-gray-700 rounded-lg p-2 text-white outline-none cursor-pointer"
                >
                  <option value="de">Deutsch (Standard)</option>
                  <option value="en">English</option>
                  {availableLocales
                    .filter((l) => l !== 'de' && l !== 'en')
                    .map((loc) => (
                      <option key={loc} value={loc}>
                        {loc.toUpperCase()}
                      </option>
                    ))}
                </select>
                <p className="text-[11px] text-gray-500 mt-1">
                  Die Sprache wird sofort zur Laufzeit ohne Neustart des Programms umgeschaltet.
                </p>
              </div>

              <div className="bg-[#1a1d21] p-4 rounded-xl border border-gray-800 flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-white mb-0.5">Eigene Sprachen hinzufügen</h4>
                  <p className="text-gray-400 text-[11px]">
                    Öffnen Sie den Locales-Ordner, um eigene JSON-Übersetzungen hinzuzufügen.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleOpenLocalesFolder}
                  className="px-3 py-1.5 bg-[#202328] hover:bg-[#2b2f36] border border-gray-700 rounded-lg flex items-center gap-1.5 text-white transition-colors"
                >
                  <FolderOpen size={14} className="text-omega-accent" />
                  <span>Sprachordner im Explorer öffnen</span>
                </button>
              </div>
            </div>
          )}

          {/* Reiter Audio */}
          {activeTab === 'audio' && (
            <div className="space-y-4">
              <div>
                <label className="block text-gray-400 font-semibold mb-1.5">
                  Standard-Samplerate (PCM Audio):
                </label>
                <select
                  value={sampleRate}
                  onChange={(e) => setSampleRate(parseInt(e.target.value))}
                  className="w-full bg-[#1a1d21] border border-gray-700 rounded-lg p-2 text-white outline-none"
                >
                  <option value={44100}>44.1 kHz (CD Audio)</option>
                  <option value={48000}>48.0 kHz (Studio Standard - Empfohlen)</option>
                  <option value={96000}>96.0 kHz (High-Resolution Studio)</option>
                </select>
              </div>

              <div>
                <label className="block text-gray-400 font-semibold mb-1.5">
                  Standard-Audioausgang (Monitoring):
                </label>
                <select
                  value={defaultOutputDevice}
                  onChange={(e) => setDefaultOutputDevice(e.target.value)}
                  className="w-full bg-[#1a1d21] border border-gray-700 rounded-lg p-2 text-white outline-none"
                >
                  <option value="default">Systemstandard</option>
                  {outputDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-gray-500 mt-1">
                  Wählt das primäre Ausgabegerät für das Abhören und den Playback-Kanal.
                </p>
              </div>

              <div className="bg-[#1a1d21] p-4 rounded-xl border border-gray-800 space-y-3">
                <div className="flex items-center gap-2">
                  <HardDrive size={15} className="text-omega-accent" />
                  <h4 className="font-bold text-white">Speicherpfade</h4>
                </div>
                <div>
                  <label className="block text-gray-400 text-[11px] mb-1">
                    Standardordner für Aufnahmen:
                  </label>
                  <input
                    type="text"
                    value={recordingsPath}
                    onChange={(e) => setRecordingsPath(e.target.value)}
                    placeholder="%USERPROFILE%\Documents\OmegaProjects\Omega Media Core\Omega Wave Recorder\Recordings"
                    className="w-full bg-[#202328] border border-gray-700 rounded px-2.5 py-1 text-white focus:border-omega-accent outline-none font-mono text-[11px]"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Reiter Meldungen & Warnungen */}
          {activeTab === 'notifications' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-white">Stummgeschaltete Hinweise & Warnungen</h3>
                  <p className="text-gray-400 text-[11px]">
                    Hier können Sie Hinweise wieder aktivieren, die Sie mit „Nicht mehr anzeigen“ ausgeblendet haben.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleResetAllWarnings}
                  className="px-3 py-1.5 bg-[#1a1d21] hover:bg-[#282c32] border border-gray-700 rounded-lg flex items-center gap-1.5 text-gray-200 hover:text-white transition-colors"
                >
                  <RotateCcw size={13} className="text-amber-400" />
                  <span>Alle Warnungen zurücksetzen</span>
                </button>
              </div>

              <div className="space-y-2">
                {warnings.map((w) => (
                  <div
                    key={w.id}
                    className="bg-[#1a1d21] p-3 rounded-lg border border-gray-800 flex items-center justify-between"
                  >
                    <div className="flex-1 pr-4">
                      <div className="font-semibold text-gray-200 text-xs">{w.title}</div>
                      <div className="text-gray-400 text-[11px]">{w.description}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggleWarning(w.id)}
                      className={`px-3 py-1 rounded text-[11px] font-bold border transition-all ${
                        w.isSilenced
                          ? 'bg-amber-600/20 border-amber-500 text-amber-300'
                          : 'bg-emerald-600/20 border-emerald-500 text-emerald-300'
                      }`}
                    >
                      {w.isSilenced ? 'Stummgeschaltet' : 'Aktiv'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="bg-[#1a1d21] px-5 py-3 border-t border-gray-800 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-[#202328] hover:bg-[#282c32] border border-gray-700 text-gray-300 transition-colors"
          >
            Schließen
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-5 py-1.5 rounded-lg bg-omega-accent hover:bg-blue-600 active:scale-[0.97] text-white font-bold transition-all shadow-[0_0_10px_rgba(0,120,215,0.4)] flex items-center gap-1.5"
          >
            {hasSaved ? (
              <>
                <Check size={14} className="text-emerald-300" />
                <span>Gespeichert!</span>
              </>
            ) : (
              <span>Speichern</span>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

export default SettingsModal
