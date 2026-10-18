import React, { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle, Download, RefreshCw, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export interface UpdateEntry {
  version?: string
  date?: string
  english: string
  deutsch: string
}

export interface UpdateInfo {
  latestVersion: string
  currentVersion: string
  url?: string
  downloadUrl?: string
  body?: string
  releaseNotes?: string
  available?: boolean
}

export interface UpdateModalProps {
  updateInfo?: UpdateInfo | null
  onClose: (deferredUpdate?: boolean) => void
}

export type UpdateStep = 'checking' | 'prompt' | 'downloading' | 'ready' | 'up-to-date' | 'error'

function parseUpdateBody(raw: string, fallbackVersion?: string): UpdateEntry[] {
  const normalized = raw.replace(/\r\n/g, '\n')
  const noticeRegex =
    /###\s*English\s*[\r\n]+####\s*Upgrade\s*Notice\s*[\r\n]+[\s\S]*?###\s*Deutsch\s*[\r\n]+####\s*Wichtiger\s*Hinweis\s*zum\s*Update\s*[\r\n]+[\s\S]*?(?:\n---\n|\n---(?=\n)|$)/gi
  const cleaned = normalized.replace(noticeRegex, '')
  const versionBlocks = cleaned.split(/\n---\n|\n---(?=\n)/)
  const entries: UpdateEntry[] = []

  for (const block of versionBlocks) {
    const trimmedBlock = block.trim()
    if (!trimmedBlock) continue

    const versionMatch = trimmedBlock.match(/^(?:### Version|## \[?v?([0-9.]+))(?:\s*\(([^)]+)\)|\s*-\s*([^\n]+))?/)
    let version = ''
    let date = ''
    let contentBlock = trimmedBlock

    if (versionMatch) {
      version = (versionMatch[1] || '').trim()
      if (version.startsWith('v')) version = version.slice(1)
      date = (versionMatch[2] || versionMatch[3] || '').trim()
      contentBlock = trimmedBlock.substring(versionMatch[0].length).trim()
    }

    const englishMatch = contentBlock.match(/###\s*English\s*\n([\s\S]*?)(?=\n### |\n## |\n---|\s*$)/i)
    const deutschMatch = contentBlock.match(/###\s*Deutsch\s*\n([\s\S]*?)(?=\n### |\n## |\n---|\s*$)/i)
    const fallbackText = contentBlock.replace(/^###\s*(?:English|Deutsch)\s*\n/i, '').trim()

    entries.push({
      version: version || fallbackVersion?.replace(/^v/, '') || undefined,
      date: date || undefined,
      english: englishMatch ? englishMatch[1].trim() : fallbackText,
      deutsch: deutschMatch ? deutschMatch[1].trim() : fallbackText
    })
  }

  return entries
}

function renderInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return parts.map((part, i) => {
    const boldMatch = part.match(/^\*\*(.+)\*\*$/)
    if (boldMatch) return <strong key={i} className="text-white font-bold">{boldMatch[1]}</strong>
    const codeMatch = part.match(/^`(.+)`$/)
    if (codeMatch) return <code key={i} className="bg-gray-800 text-omega-accent px-1 rounded text-xs font-mono">{codeMatch[1]}</code>
    return <span key={i}>{part}</span>
  })
}

function renderMarkdownBlock(text: string) {
  if (!text) return <p className="text-gray-500 italic text-xs">Keine Details verfügbar.</p>

  let isImportant = false
  return text.split('\n').map((line, idx) => {
    const trimmed = line.trim()
    if (trimmed.startsWith('#### ')) {
      const label = trimmed.slice(5)
      let color = 'text-gray-300'
      const labelLower = label.toLowerCase()
      if (
        labelLower.includes('notice') ||
        labelLower.includes('hinweis') ||
        labelLower.includes('important') ||
        labelLower.includes('wichtig')
      ) {
        color = 'text-red-500 font-extrabold'
        isImportant = true
      } else {
        isImportant = false
        if (
          labelLower.includes('added') ||
          labelLower.includes('neu') ||
          labelLower.includes('hinzugefügt') ||
          labelLower.includes('hinzugefuegt')
        ) {
          color = 'text-green-400'
        } else if (
          labelLower.includes('fixed') ||
          labelLower.includes('behoben') ||
          labelLower.includes('verbessert')
        ) {
          color = 'text-blue-400'
        } else if (
          labelLower.includes('changed') ||
          labelLower.includes('geändert') ||
          labelLower.includes('geaendert')
        ) {
          color = 'text-yellow-400'
        } else if (
          labelLower.includes('removed') ||
          labelLower.includes('entfernt')
        ) {
          color = 'text-red-400'
        }
      }
      return (
        <h5
          key={idx}
          className={`${color} font-bold text-xs uppercase tracking-widest mt-3.5 mb-1.5 first:mt-0 flex items-center gap-1.5`}
        >
          {label}
        </h5>
      )
    }

    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const content = trimmed.slice(2)
      return (
        <div key={idx} className="flex items-start gap-2 mb-1.5">
          <span className={`${isImportant ? 'text-red-500' : 'text-omega-accent'} mt-0.5 shrink-0 text-xs`}>
            •
          </span>
          <p className={`${isImportant ? 'text-red-400 font-semibold' : 'text-gray-200'} text-xs leading-relaxed`}>
            {renderInline(content)}
          </p>
        </div>
      )
    }

    if (trimmed === '') return <div key={idx} className="h-1" />
    return (
      <p key={idx} className={`${isImportant ? 'text-red-400 font-semibold' : 'text-gray-400'} text-xs leading-relaxed mb-1`}>
        {renderInline(line)}
      </p>
    )
  })
}

export function UpdateModal({ updateInfo, onClose }: UpdateModalProps) {
  const [step, setStep] = useState<UpdateStep>(updateInfo ? 'prompt' : 'checking')
  const [activeInfo, setActiveInfo] = useState<UpdateInfo | null>(updateInfo || null)
  const [progress, setProgress] = useState(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [entries, setEntries] = useState<UpdateEntry[]>([])
  const [showUpgradeNotice, setShowUpgradeNotice] = useState(true)
  const [showHideNoticePrompt, setShowHideNoticePrompt] = useState(false)
  const [hideNoticePermanently, setHideNoticePermanently] = useState(false)
  const [downloadedBytes, setDownloadedBytes] = useState<number | null>(null)
  const [totalBytes, setTotalBytes] = useState<number | null>(null)
  const [speedBps, setSpeedBps] = useState<number | null>(null)
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null)

  const isPopout =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('window') === 'update'
  const { i18n } = useTranslation()
  const [lang, setLang] = useState<'de' | 'en'>(i18n?.language?.startsWith('de') ? 'de' : 'en')

  // Parse release notes
  useEffect(() => {
    const rawBody = activeInfo?.body || activeInfo?.releaseNotes || ''
    if (rawBody) {
      setEntries(parseUpdateBody(rawBody, activeInfo?.latestVersion))
    } else {
      setEntries([])
    }
  }, [activeInfo?.body, activeInfo?.releaseNotes, activeInfo?.latestVersion])

  // Initial check if updateInfo was not provided
  useEffect(() => {
    let cancelled = false

    const init = async () => {
      if (updateInfo) {
        setActiveInfo(updateInfo)
        setStep('prompt')
        return
      }

      setStep('checking')
      try {
        let curr = '0.1.6'
        if (window.api?.getAppVersion) {
          const v = await window.api.getAppVersion()
          if (v) curr = v
        }

        if (window.api?.checkForUpdates) {
          const res = await window.api.checkForUpdates()
          if (cancelled) return

          if (res?.available || res?.updateAvailable) {
            const info: UpdateInfo = {
              currentVersion: res.currentVersion || curr,
              latestVersion: res.latestVersion || res.version || curr,
              url: res.url,
              downloadUrl: res.downloadUrl,
              body: res.body || res.releaseNotes || ''
            }
            setActiveInfo(info)
            setStep('prompt')
            return
          } else if (res?.error) {
            setErrorMessage(res.error)
            setStep('error')
            return
          } else {
            setActiveInfo({
              currentVersion: res?.currentVersion || curr,
              latestVersion: res?.latestVersion || res?.currentVersion || curr
            })
            setStep('up-to-date')
            return
          }
        } else {
          setStep('up-to-date')
        }
      } catch (err: any) {
        if (!cancelled) {
          setErrorMessage(err?.message || 'Fehler beim Abrufen der Update-Informationen.')
          setStep('error')
        }
      }
    }

    init()

    return () => {
      cancelled = true
    }
  }, [updateInfo])

  // Load Upgrade Notice settings preference
  useEffect(() => {
    let cancelled = false
    const loadNoticePreference = async () => {
      try {
        if (window.api?.getSettings) {
          const settings = await window.api.getSettings()
          if (!cancelled) {
            setShowUpgradeNotice((settings as any)?.showUpdateUpgradeNotice !== false)
          }
        }
      } catch (err) {
        console.error('Fehler beim Laden der Update-Hinweis-Einstellung:', err)
      }
    }
    loadNoticePreference()
    return () => {
      cancelled = true
    }
  }, [])

  // Listen to download progress
  useEffect(() => {
    if (!window.api?.onDownloadProgress) return

    const unsubscribe = window.api.onDownloadProgress((data: any) => {
      if (data.status === 'downloading') {
        setStep('downloading')
        setProgress(data.percent || 0)
        if (data.downloadedBytes !== undefined) setDownloadedBytes(data.downloadedBytes)
        if (data.totalBytes !== undefined) setTotalBytes(data.totalBytes)
        if (data.speedBps !== undefined) setSpeedBps(data.speedBps)
        if (data.remainingSeconds !== undefined) setRemainingSeconds(data.remainingSeconds)
      } else if (data.status === 'completed' || data.percent >= 100) {
        setStep('ready')
        setProgress(100)
      } else if (data.status === 'error') {
        setStep('error')
        setErrorMessage(data.error || 'Ein unbekannter Fehler ist aufgetreten.')
      }
    })

    return () => {
      unsubscribe()
    }
  }, [])

  // Close on Escape when not downloading
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && step !== 'downloading') {
        handleClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [step])

  const formatSpeed = (bps: number | null) => {
    if (bps === null || bps <= 0) return '0 KB/s'
    const kbps = bps / 1024
    if (kbps < 1024) return `${kbps.toFixed(1)} KB/s`
    return `${(kbps / 1024).toFixed(2)} MB/s`
  }

  const formatSize = (bytes: number | null) => {
    if (bytes === null || bytes <= 0) return '0 MB'
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const formatRemaining = (seconds: number | null) => {
    if (seconds === null || seconds < 0) return '--:--'
    if (seconds < 60) return `${Math.round(seconds)}s`
    const mins = Math.floor(seconds / 60)
    const secs = Math.round(seconds % 60)
    return `${mins}m ${secs}s`
  }

  const persistUpgradeNoticePreference = async (visible: boolean) => {
    try {
      if (window.api?.getSettings && window.api?.saveSettings) {
        const currentSettings = await window.api.getSettings()
        const nextSettings = {
          ...currentSettings,
          showUpdateUpgradeNotice: visible
        }
        await window.api.saveSettings(nextSettings)
      }
    } catch (err) {
      console.error('Fehler beim Speichern der Update-Hinweis-Einstellung:', err)
    }
  }

  const handleHideUpgradeNotice = () => {
    setHideNoticePermanently(false)
    setShowHideNoticePrompt(true)
  }

  const handleConfirmHideNotice = async () => {
    setShowUpgradeNotice(false)
    setShowHideNoticePrompt(false)
    if (hideNoticePermanently) {
      await persistUpgradeNoticePreference(false)
    }
  }

  const handleCancelHideNotice = () => {
    setShowHideNoticePrompt(false)
    setHideNoticePermanently(false)
  }

  const handleClose = () => {
    onClose(false)
  }

  const handleStartDownload = async () => {
    setStep('downloading')
    setProgress(0)
    setDownloadedBytes(null)
    setTotalBytes(null)
    setSpeedBps(null)
    setRemainingSeconds(null)

    try {
      if (window.api?.startUpdateDownload) {
        const res = await window.api.startUpdateDownload({
          url: activeInfo?.downloadUrl || activeInfo?.url || '',
          latestVersion: activeInfo?.latestVersion
        })
        if (!res?.success) {
          if (res?.error === 'Canceled') {
            setStep('prompt')
          } else {
            setStep('error')
            setErrorMessage(res?.error || 'Der Download konnte nicht gestartet werden.')
          }
        }
      }
    } catch (err: any) {
      if (err?.message === 'Canceled') {
        setStep('prompt')
      } else {
        setStep('error')
        setErrorMessage(err?.message || 'Verbindungsfehler beim Download.')
      }
    }
  }

  const handleCancelDownload = async () => {
    try {
      if (window.api?.cancelUpdateDownload) {
        await window.api.cancelUpdateDownload()
      }
      setStep('prompt')
      setProgress(0)
      setDownloadedBytes(null)
      setTotalBytes(null)
      setSpeedBps(null)
      setRemainingSeconds(null)
    } catch (err) {
      console.error('Failed to cancel update download:', err)
    }
  }

  const handleInstallNow = async () => {
    try {
      if (window.api?.installUpdate) {
        await window.api.installUpdate({ installNow: true })
      }
    } catch (err) {
      console.error(err)
    }
  }

  const handleInstallLater = async () => {
    try {
      if (window.api?.installUpdate) {
        await window.api.installUpdate({ installNow: false })
      }
      onClose(true)
    } catch (err) {
      console.error(err)
    }
  }

  const renderParsedEntries = () => {
    if (entries.length === 0) {
      return (
        <p className="text-gray-500 italic text-xs">
          {lang === 'de' ? 'Keine Details verfügbar.' : 'No details available.'}
        </p>
      )
    }

    return entries.map((entry, idx) => {
      const content = lang === 'de' ? entry.deutsch : entry.english
      return (
        <div key={idx} className="border-b border-gray-800/40 pb-5 mb-5 last:border-0 last:pb-0 last:mb-0">
          {entry.version && (
            <div className="flex items-baseline gap-2.5 mb-3 select-none">
              <h4 className="text-omega-accent font-black text-sm">v{entry.version}</h4>
              {entry.date && <span className="text-gray-500 text-[11px]">{entry.date}</span>}
            </div>
          )}
          <div>
            {renderMarkdownBlock(content || (lang === 'de' ? 'Keine Details verfügbar.' : 'No details available.'))}
          </div>
        </div>
      )
    })
  }

  const renderStepHero = (icon: React.ReactNode, title: string, subtitle: string) => (
    <div className="flex items-center gap-4 text-left">
      {icon}
      <div className="flex flex-col gap-1">
        <h3 className="font-black text-xl sm:text-2xl leading-tight text-white tracking-tight">{title}</h3>
        <p className="text-xs sm:text-sm text-gray-400 font-semibold">{subtitle}</p>
      </div>
    </div>
  )

  const currentVerStr = activeInfo?.currentVersion
    ? activeInfo.currentVersion.startsWith('v')
      ? activeInfo.currentVersion
      : `v${activeInfo.currentVersion}`
    : 'v0.1.6'

  const latestVerStr = activeInfo?.latestVersion
    ? activeInfo.latestVersion.startsWith('v')
      ? activeInfo.latestVersion
      : `v${activeInfo.latestVersion}`
    : currentVerStr

  const modalContent = (
    <div
      id="update-modal-content"
      className={`${
        isPopout
          ? 'w-full h-full'
          : 'w-[940px] max-w-[calc(100vw-32px)] h-[min(820px,calc(100vh-32px))] rounded-xl shadow-2xl border border-gray-700/60'
      } bg-[#24272c]/95 overflow-hidden flex flex-col backdrop-blur-md relative select-none`}
    >
      {/* Top Window Header */}
      <div
        className="bg-[#1a1d21]/80 px-5 py-3 border-b border-gray-800/80 flex items-center justify-between shrink-0"
        style={isPopout ? ({ WebkitAppRegion: 'drag' } as React.CSSProperties) : undefined}
      >
        <div className="flex items-center gap-2">
          <RefreshCw className="text-omega-accent animate-spin" size={16} style={{ animationDuration: '4s' }} />
          <span className="text-xs font-bold uppercase tracking-wider text-omega-accent">Software Update</span>
        </div>
        <div
          className="flex items-center gap-2"
          style={isPopout ? ({ WebkitAppRegion: 'no-drag' } as React.CSSProperties) : undefined}
        >
          {step !== 'downloading' && (
            <button
              onClick={handleClose}
              className="text-gray-400 hover:text-white p-1 rounded hover:bg-white/5 transition-colors"
              title="Schließen"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Main Content Body */}
      <div className="p-5 sm:p-6 flex-1 min-h-0 w-full overflow-hidden flex flex-col">
        {step === 'checking' && (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <div className="h-16 w-16 bg-omega-accent/10 rounded-full flex items-center justify-center text-omega-accent shadow-lg shadow-omega-accent/5">
              <RefreshCw className="animate-spin text-omega-accent" size={32} />
            </div>
            <div>
              <h3 className="font-bold text-white text-base mb-1">Suche nach Updates...</h3>
              <p className="text-gray-400 text-xs">Verbinde mit dem Update-Server...</p>
            </div>
          </div>
        )}

        {step === 'up-to-date' && (
          <div className="flex h-full flex-col gap-5 w-full">
            {renderStepHero(
              <div className="h-16 w-16 shrink-0 bg-emerald-500/10 rounded-full flex items-center justify-center text-emerald-400 shadow-lg shadow-emerald-500/5">
                <CheckCircle size={32} />
              </div>,
              'Sie sind auf dem neuesten Stand!',
              `Omega Wave Recorder ${currentVerStr} ist aktuell.`
            )}

            <div className="w-full flex-1 min-h-0 bg-[#16181b]/80 border border-gray-800/80 rounded-lg p-5 text-sm text-left text-gray-300 flex flex-col gap-3 font-sans shadow-inner">
              <div className="flex justify-between items-center border-b border-gray-800/40 pb-2.5">
                <span className="text-gray-400 font-semibold">Installierte Version:</span>
                <span className="font-mono text-white font-bold">{currentVerStr}</span>
              </div>
              <div className="flex justify-between items-center border-b border-gray-800/40 pb-2.5">
                <span className="text-gray-400 font-semibold">Status:</span>
                <span className="font-mono text-emerald-400 font-bold flex items-center gap-1.5">
                  <CheckCircle size={14} /> Aktuellste Version
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-2 leading-relaxed">
                Es sind zurzeit keine neueren Versionen oder Aktualisierungen auf GitHub verfügbar.
              </p>
            </div>
          </div>
        )}

        {step === 'prompt' && (
          <div className="flex h-full flex-col gap-4 w-full">
            {renderStepHero(
              <div className="h-16 w-16 shrink-0 bg-omega-accent/10 rounded-full flex items-center justify-center text-omega-accent shadow-lg shadow-omega-accent/5">
                <Download size={32} />
              </div>,
              'Ein neues Update ist verfügbar!',
              `Omega Wave Recorder ${latestVerStr}`
            )}

            <div className="w-full flex-1 min-h-0 bg-[#16181b]/80 border border-gray-800/80 rounded-lg p-4 sm:p-5 text-xs sm:text-sm text-left text-gray-300 flex flex-col gap-2.5 font-sans shadow-inner">
              <div className="flex justify-between items-center border-b border-gray-800/40 pb-2">
                <span className="text-gray-400 font-semibold">Installierte Version:</span>
                <span className="font-mono text-white font-bold">{currentVerStr}</span>
              </div>
              <div className="flex justify-between items-center border-b border-gray-800/40 pb-2">
                <span className="text-gray-400 font-semibold">Neueste Version:</span>
                <span className="font-mono text-green-400 font-extrabold">{latestVerStr}</span>
              </div>
              <div className="flex justify-between items-center border-b border-gray-800/40 pb-2">
                <span className="text-gray-400 font-semibold">Sprache / Language:</span>
                <div className="flex items-center bg-[#1a1d21] rounded-lg p-0.5 border border-gray-750/80">
                  <button
                    onClick={() => setLang('de')}
                    className={`px-3 py-0.5 rounded-md text-[11px] font-semibold transition-all duration-150 ${
                      lang === 'de' ? 'bg-omega-accent text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    DE Deutsch
                  </button>
                  <button
                    onClick={() => setLang('en')}
                    className={`px-3 py-0.5 rounded-md text-[11px] font-semibold transition-all duration-150 ${
                      lang === 'en' ? 'bg-omega-accent text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    EN English
                  </button>
                </div>
              </div>

              {showUpgradeNotice && (
                <div className="relative bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2.5 text-red-100 text-xs flex gap-2.5 items-start leading-relaxed">
                  <AlertTriangle className="text-red-400 shrink-0 mt-0.5" size={16} />
                  <div className="pr-8">
                    <strong className="text-red-300 block mb-0.5 uppercase tracking-wider text-[10px] font-black">
                      {lang === 'de' ? 'Wichtiger Hinweis zum Update' : 'Important Upgrade Notice'}
                    </strong>
                    <span className="text-[11px]">
                      {lang === 'de'
                        ? 'Bitte stelle vor dem Update des Omega Wave Recorders sicher, dass deine aktiven Projekte (.owrp) gespeichert sind. Wenn du von einer älteren Version aktualisierst, bleiben deine Einstellungen und die Liste der letzten Projekte sicher erhalten.'
                        : 'Before updating Omega Wave Recorder, please make sure to save your active projects (.owrp). If you are upgrading from an older version, your settings and recent project lists will be preserved safely.'}
                    </span>
                  </div>
                  <button
                    onClick={handleHideUpgradeNotice}
                    className="absolute right-2 top-2 rounded p-1 text-red-300/80 hover:bg-red-500/15 hover:text-white transition-colors"
                    title={lang === 'de' ? 'Hinweis ausblenden' : 'Hide notice'}
                  >
                    <X size={14} />
                  </button>
                </div>
              )}

              <div className="flex-1 min-h-[140px] overflow-y-auto pr-2 leading-normal text-gray-200 custom-scrollbar select-text w-full text-left">
                {renderParsedEntries()}
              </div>
            </div>
          </div>
        )}

        {step === 'downloading' && (
          <div className="flex h-full flex-col gap-4 w-full">
            {renderStepHero(
              <div className="h-16 w-16 shrink-0 bg-omega-accent/10 rounded-full flex items-center justify-center text-omega-accent shadow-lg shadow-omega-accent/5">
                <RefreshCw className="animate-spin" size={30} />
              </div>,
              'Lade Update herunter...',
              'Bitte schließe die Anwendung währenddessen nicht.'
            )}

            <div className="w-full">
              <div className="w-full bg-gray-800 h-2.5 rounded-full overflow-hidden border border-gray-700/50">
                <div
                  className="bg-gradient-to-r from-blue-500 to-omega-accent h-full rounded-full transition-all duration-150 shadow-[0_0_10px_rgba(30,144,255,0.4)]"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="flex justify-between items-center text-[10px] text-gray-400 mt-1.5 px-0.5">
                <span>Fortschritt</span>
                <span className="font-mono font-bold text-omega-accent">{progress}%</span>
              </div>

              {downloadedBytes !== null && totalBytes !== null && (
                <div className="mt-3 bg-[#16181b]/55 border border-gray-800/80 rounded-lg p-3 flex flex-col gap-1.5 w-full text-left font-sans text-[10px] text-gray-300 shadow-inner">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Datenmenge:</span>
                    <span className="font-mono text-white font-semibold">
                      {formatSize(downloadedBytes)} / {formatSize(totalBytes)}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-gray-800/40 pt-1.5">
                    <span className="text-gray-400">Geschwindigkeit:</span>
                    <span className="font-mono text-omega-accent font-semibold">{formatSpeed(speedBps)}</span>
                  </div>
                  <div className="flex justify-between border-t border-gray-800/40 pt-1.5">
                    <span className="text-gray-400">Verbleibende Zeit:</span>
                    <span className="font-mono text-green-400 font-semibold">{formatRemaining(remainingSeconds)}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="w-full flex-1 min-h-[140px] bg-[#16181b]/50 border border-gray-800/40 rounded-lg p-4 text-xs text-left text-gray-400 flex flex-col gap-1.5 overflow-hidden select-text shadow-inner">
              <div className="flex justify-between items-center border-b border-gray-800/40 pb-1.5 mb-1.5 select-none">
                <span className="text-[10px] uppercase font-bold text-gray-400">Was ist neu:</span>
                <div className="flex items-center bg-[#1a1d21] rounded-lg p-0.5 border border-gray-700/80 scale-90 origin-right">
                  <button
                    onClick={() => setLang('de')}
                    className={`px-2 py-0.5 rounded-md text-[10px] font-semibold transition-all duration-150 ${
                      lang === 'de' ? 'bg-omega-accent text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    DE
                  </button>
                  <button
                    onClick={() => setLang('en')}
                    className={`px-2 py-0.5 rounded-md text-[10px] font-semibold transition-all duration-150 ${
                      lang === 'en' ? 'bg-omega-accent text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    EN
                  </button>
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto pr-2 custom-scrollbar">
                {renderParsedEntries()}
              </div>
            </div>
          </div>
        )}

        {step === 'ready' && (
          <div className="flex h-full flex-col gap-4 w-full">
            {renderStepHero(
              <div className="h-16 w-16 shrink-0 bg-green-500/10 rounded-full flex items-center justify-center text-green-400 shadow-lg shadow-green-500/5">
                <CheckCircle size={32} />
              </div>,
              'Download abgeschlossen!',
              `Das Update für ${latestVerStr} ist bereit zur Installation.`
            )}
            <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">
              Möchtest du das Update jetzt installieren (die App wird sofort neu gestartet) oder soll die Installation erst beim nächsten Beenden der App ausgeführt werden?
            </p>

            <div className="w-full flex-1 min-h-[140px] bg-[#16181b]/50 border border-gray-800/40 rounded-lg p-4 sm:p-5 text-xs sm:text-sm text-left text-gray-300 flex flex-col gap-2 overflow-hidden select-text shadow-inner">
              <div className="flex justify-between items-center border-b border-gray-800/40 pb-1 mb-2 select-none">
                <span className="text-[10px] uppercase font-bold text-gray-400">Neue Features in diesem Update:</span>
                <div className="flex items-center bg-[#1a1d21] rounded-lg p-0.5 border border-gray-700/80 scale-90 origin-right">
                  <button
                    onClick={() => setLang('de')}
                    className={`px-2 py-0.5 rounded-md text-[10px] font-semibold transition-all duration-150 ${
                      lang === 'de' ? 'bg-omega-accent text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    DE
                  </button>
                  <button
                    onClick={() => setLang('en')}
                    className={`px-2 py-0.5 rounded-md text-[10px] font-semibold transition-all duration-150 ${
                      lang === 'en' ? 'bg-omega-accent text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    EN
                  </button>
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto pr-2 custom-scrollbar">
                {renderParsedEntries()}
              </div>
            </div>
          </div>
        )}

        {step === 'error' && (
          <div className="flex h-full flex-col gap-4 w-full">
            {renderStepHero(
              <div className="h-16 w-16 shrink-0 bg-red-500/10 rounded-full flex items-center justify-center text-red-400 shadow-lg shadow-red-500/5">
                <AlertTriangle size={32} />
              </div>,
              'Update fehlgeschlagen',
              'Fehler beim Downloaden des Updates.'
            )}
            <div className="w-full bg-[#1b1e22] border border-red-900/30 text-red-400 rounded-lg p-4 text-center mt-2 leading-relaxed font-mono text-xs shadow-inner">
              {errorMessage}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Action Footer */}
      <div className="bg-[#1a1d21]/80 px-5 py-3.5 border-t border-gray-800/80 flex justify-end gap-2.5 shrink-0">
        {step === 'checking' && (
          <button
            onClick={handleClose}
            className="px-6 py-2 bg-gray-800 hover:bg-gray-700 text-white text-xs font-semibold rounded-lg border border-gray-700/50 shadow transition-all duration-150 active:scale-[0.98]"
          >
            Abbrechen
          </button>
        )}

        {step === 'up-to-date' && (
          <button
            onClick={handleClose}
            className="px-6 py-2 bg-omega-accent hover:bg-blue-500 text-white text-xs font-bold rounded-lg shadow transition-all duration-150 active:scale-[0.98]"
          >
            Schließen
          </button>
        )}

        {step === 'prompt' && (
          <>
            <button
              onClick={handleClose}
              className="px-6 py-2 bg-gray-800 hover:bg-gray-700 text-white text-xs font-semibold rounded-lg border border-gray-700/50 shadow transition-all duration-150 active:scale-[0.98]"
            >
              Später
            </button>
            <button
              onClick={handleStartDownload}
              className="px-8 py-2 bg-omega-accent hover:bg-blue-500 text-white text-xs font-bold rounded-lg shadow-lg hover:shadow-omega-accent/20 transition-all duration-150 active:scale-[0.98]"
            >
              Jetzt herunterladen
            </button>
          </>
        )}

        {step === 'downloading' && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400 italic">Download läuft im Hintergrund...</span>
            <button
              onClick={handleCancelDownload}
              className="px-5 py-2 bg-red-950/40 border border-red-500/35 hover:bg-red-900/30 text-red-400 text-xs font-bold rounded-lg transition-all duration-150 active:scale-[0.98] cursor-pointer"
            >
              Abbrechen
            </button>
          </div>
        )}

        {step === 'ready' && (
          <>
            <button
              onClick={handleInstallLater}
              className="px-6 py-2 bg-gray-800 hover:bg-gray-700 text-white text-xs font-semibold rounded-lg border border-gray-700/50 shadow transition-all duration-150 active:scale-[0.98]"
            >
              Nach Neustart
            </button>
            <button
              onClick={handleInstallNow}
              className="px-8 py-2 bg-omega-accent hover:bg-blue-500 text-white text-xs font-bold rounded-lg shadow-lg hover:shadow-omega-accent/20 transition-all duration-150 active:scale-[0.98]"
            >
              Jetzt installieren
            </button>
          </>
        )}

        {step === 'error' && (
          <>
            <button
              onClick={handleStartDownload}
              className="px-6 py-2 bg-omega-accent hover:bg-blue-500 text-white text-xs font-semibold rounded-lg shadow transition-all duration-150 active:scale-[0.98]"
            >
              Wiederholen
            </button>
            <button
              onClick={handleClose}
              className="px-6 py-2 bg-gray-800 hover:bg-gray-700 text-white text-xs font-semibold rounded-lg border border-gray-700/50 shadow transition-all duration-150 active:scale-[0.98]"
            >
              Schließen
            </button>
          </>
        )}
      </div>

      {/* Hide Notice Confirmation Dialog */}
      {showHideNoticePrompt && (
        <div className="absolute inset-0 bg-black/75 backdrop-blur-[2px] flex items-center justify-center z-20 p-4">
          <div className="w-full max-w-md bg-[#1e2124] border border-gray-700 rounded-lg shadow-2xl overflow-hidden">
            <div className="bg-[#181b1f] px-4 py-3 border-b border-gray-700 flex items-center gap-2">
              <AlertTriangle className="text-red-400" size={18} />
              <span className="text-xs font-bold uppercase tracking-wider text-gray-200">
                {lang === 'de' ? 'Update-Hinweis ausblenden' : 'Hide update notice'}
              </span>
            </div>
            <div className="p-5 text-sm text-gray-300 leading-relaxed">
              {lang === 'de'
                ? 'Der Hinweis kann nur für jetzt ausgeblendet oder bis zur Reaktivierung in den Einstellungen dauerhaft unterdrückt werden.'
                : 'This notice can be hidden just for now or suppressed permanently until it is reactivated in settings.'}
            </div>
            <div className="px-5 pb-4">
              <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={hideNoticePermanently}
                  onChange={(e) => setHideNoticePermanently(e.target.checked)}
                  className="accent-omega-accent"
                />
                {lang === 'de'
                  ? 'Dauerhaft ausblenden, bis Hinweisdialoge in den Einstellungen reaktiviert werden'
                  : 'Hide permanently until warning dialogs are reactivated in settings'}
              </label>
            </div>
            <div className="bg-[#181b1f] px-4 py-3 border-t border-gray-700 flex justify-end gap-2">
              <button
                onClick={handleCancelHideNotice}
                className="px-5 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded shadow transition-all"
              >
                {lang === 'de' ? 'Abbrechen' : 'Cancel'}
              </button>
              <button
                onClick={handleConfirmHideNotice}
                className="px-5 py-1.5 bg-omega-accent hover:bg-blue-500 text-white text-xs rounded shadow transition-all font-bold"
              >
                {lang === 'de' ? 'Ausblenden' : 'Hide'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  if (isPopout) {
    return modalContent
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[5000] p-3 sm:p-4 animate-in fade-in duration-200">
      {modalContent}
    </div>
  )
}

export default UpdateModal
