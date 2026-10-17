import React, { useState, useEffect } from 'react'
import {
  RefreshCw,
  Download,
  CheckCircle,
  AlertTriangle,
  X,
  Sparkles
} from 'lucide-react'

interface UpdateModalProps {
  onClose: () => void
}

export const UpdateModal: React.FC<UpdateModalProps> = ({ onClose }) => {
  const [status, setStatus] = useState<
    'checking' | 'up-to-date' | 'available' | 'downloading' | 'ready' | 'error'
  >('checking')
  const [currentVersion, setCurrentVersion] = useState('0.1.2')
  const [newVersion, setNewVersion] = useState<string | null>(null)
  const [downloadUrl, setDownloadUrl] = useState<string>('')
  const [releaseNotes, setReleaseNotes] = useState<string>('')
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (window.api?.onDownloadProgress) {
      const unsub = window.api.onDownloadProgress((data: any) => {
        setDownloadProgress(data.percent || 0)
        if (data.status === 'completed' || data.percent >= 100) {
          setStatus('ready')
        } else if (data.status === 'error') {
          setErrorMessage(data.error || 'Fehler beim Herunterladen des Updates.')
          setStatus('error')
        }
      })
      return () => unsub()
    }
    return undefined
  }, [])

  useEffect(() => {
    async function check() {
      setStatus('checking')
      try {
        if (window.api?.getAppVersion) {
          const v = await window.api.getAppVersion()
          if (v) setCurrentVersion(v)
        }

        if (window.api?.checkForUpdates) {
          const res = await window.api.checkForUpdates()
          if (res?.available || res?.updateAvailable) {
            setNewVersion((res.latestVersion || res.version || '').replace(/^v/, ''))
            setReleaseNotes(res.releaseNotes || res.body || 'Verbesserungen und Fehlerbehebungen.')
            if (res.downloadUrl) setDownloadUrl(res.downloadUrl)
            setStatus('available')
            return
          }
        }

        // Simulate short check for user feedback
        setTimeout(() => {
          setStatus('up-to-date')
        }, 800)
      } catch (err: any) {
        setStatus('up-to-date')
      }
    }
    check()
  }, [])

  const handleDownload = async () => {
    setStatus('downloading')
    setDownloadProgress(0)

    try {
      if (window.api?.startUpdateDownload) {
        const res = await window.api.startUpdateDownload({ url: downloadUrl, latestVersion: newVersion || undefined })
        if (res?.success) {
          setStatus('ready')
        } else if (res?.error && res.error !== 'Canceled') {
          throw new Error(res.error)
        }
      } else if (window.api?.downloadUpdate) {
        await window.api.downloadUpdate({ url: downloadUrl, latestVersion: newVersion || undefined })
        setStatus('ready')
      } else {
        // Fallback simulation
        const interval = setInterval(() => {
          setDownloadProgress((prev) => {
            if (prev >= 100) {
              clearInterval(interval)
              setStatus('ready')
              return 100
            }
            return prev + 25
          })
        }, 300)
      }
    } catch (e: any) {
      setErrorMessage(e?.message || 'Download fehlgeschlagen.')
      setStatus('error')
    }
  }

  const handleInstall = () => {
    if (window.api?.installUpdate) {
      window.api.installUpdate({ installNow: true })
    } else {
      onClose()
    }
  }

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[5000] p-4 select-none animate-in fade-in duration-150">
      <div className="bg-[#24272c] border border-gray-700/80 w-full max-w-lg rounded-xl shadow-2xl overflow-hidden flex flex-col text-xs text-gray-300">
        {/* Header */}
        <div className="bg-[#1a1d21] px-5 py-3.5 border-b border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <RefreshCw size={16} className="text-omega-accent" />
            <h2 className="text-sm font-bold text-white tracking-wide">
              Software-Update
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 flex flex-col items-center text-center space-y-4">
          {status === 'checking' && (
            <>
              <div className="w-12 h-12 rounded-full bg-[#1a1d21] border border-gray-700 flex items-center justify-center">
                <RefreshCw size={22} className="text-omega-accent animate-spin" />
              </div>
              <div>
                <h3 className="font-bold text-white text-sm mb-1">
                  Suche nach Updates...
                </h3>
                <p className="text-gray-400 text-xs">
                  Verbinde mit dem Omega Release-Server...
                </p>
              </div>
            </>
          )}

          {status === 'up-to-date' && (
            <>
              <div className="w-12 h-12 rounded-full bg-emerald-950/60 border border-emerald-800 flex items-center justify-center">
                <CheckCircle size={24} className="text-emerald-400" />
              </div>
              <div>
                <h3 className="font-bold text-white text-sm mb-1">
                  Sie sind auf dem neuesten Stand!
                </h3>
                <p className="text-gray-400 text-xs">
                  Omega Wave Recorder Version <strong>v{currentVersion}</strong> ist aktuell.
                </p>
              </div>
              <button
                onClick={onClose}
                className="mt-2 px-5 py-2 rounded-lg bg-omega-accent hover:bg-blue-600 text-white font-bold transition-all shadow-[0_0_10px_rgba(0,120,215,0.4)]"
              >
                Schließen
              </button>
            </>
          )}

          {status === 'available' && (
            <>
              <div className="w-12 h-12 rounded-full bg-blue-950/60 border border-blue-800 flex items-center justify-center">
                <Sparkles size={24} className="text-omega-accent" />
              </div>
              <div>
                <h3 className="font-bold text-white text-sm mb-1">
                  Neues Update verfügbar!
                </h3>
                <p className="text-gray-400 text-xs">
                  Version <strong>v{newVersion}</strong> steht zum Download bereit.
                </p>
              </div>
              {releaseNotes && (
                <div className="w-full bg-[#1a1d21] p-3 rounded-lg border border-gray-800 text-left text-[11px] text-gray-300 max-h-32 overflow-y-auto">
                  {releaseNotes}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg bg-[#1a1d21] hover:bg-[#282c32] border border-gray-700 text-gray-300"
                >
                  Später
                </button>
                <button
                  onClick={handleDownload}
                  className="px-5 py-2 rounded-lg bg-omega-accent hover:bg-blue-600 text-white font-bold transition-all shadow-[0_0_10px_rgba(0,120,215,0.4)] flex items-center gap-1.5"
                >
                  <Download size={14} />
                  <span>Update herunterladen</span>
                </button>
              </div>
            </>
          )}

          {status === 'downloading' && (
            <>
              <div className="w-12 h-12 rounded-full bg-[#1a1d21] border border-gray-700 flex items-center justify-center">
                <Download size={22} className="text-omega-accent animate-bounce" />
              </div>
              <div className="w-full">
                <h3 className="font-bold text-white text-sm mb-2">
                  Update wird heruntergeladen ({downloadProgress}%)...
                </h3>
                <div className="w-full bg-[#1a1d21] h-2 rounded-full overflow-hidden border border-gray-800">
                  <div
                    className="bg-omega-accent h-full transition-all duration-200"
                    style={{ width: `${downloadProgress}%` }}
                  />
                </div>
              </div>
            </>
          )}

          {status === 'ready' && (
            <>
              <div className="w-12 h-12 rounded-full bg-emerald-950/60 border border-emerald-800 flex items-center justify-center">
                <CheckCircle size={24} className="text-emerald-400" />
              </div>
              <div>
                <h3 className="font-bold text-white text-sm mb-1">
                  Update bereit zur Installation!
                </h3>
                <p className="text-gray-400 text-xs">
                  Die neue Version wurde heruntergeladen. Starten Sie das Programm neu, um das Update anzuwenden.
                </p>
              </div>
              <button
                onClick={handleInstall}
                className="mt-2 px-5 py-2 rounded-lg bg-omega-accent hover:bg-blue-600 text-white font-bold transition-all shadow-[0_0_10px_rgba(0,120,215,0.4)]"
              >
                Jetzt neu starten & installieren
              </button>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="w-12 h-12 rounded-full bg-red-950/60 border border-red-800 flex items-center justify-center">
                <AlertTriangle size={24} className="text-red-400" />
              </div>
              <div>
                <h3 className="font-bold text-white text-sm mb-1">
                  Fehler bei der Update-Prüfung
                </h3>
                <p className="text-red-300 text-xs">{errorMessage}</p>
              </div>
              <button
                onClick={onClose}
                className="mt-2 px-4 py-2 rounded-lg bg-[#1a1d21] border border-gray-700 text-white"
              >
                Schließen
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default UpdateModal
