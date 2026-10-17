import React, { useState, useEffect, useRef } from 'react'
import {
  ScrollText,
  MessageSquare,
  Search,
  Copy,
  FolderOpen,
  RefreshCw,
  Send,
  X,
  Check,
  AlertCircle,
  FileText
} from 'lucide-react'
interface SessionLogFile {
  filename: string
  size: number
  mtime?: number
}

interface LogViewerModalProps {
  onClose: () => void
  initialTab?: 'logs' | 'feedback'
}

interface LogLine {
  id: number
  raw: string
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'UNKNOWN'
  timestamp: string
  message: string
}

export const LogViewerModal: React.FC<LogViewerModalProps> = ({
  onClose,
  initialTab = 'logs'
}) => {
  const [activeTab, setActiveTab] = useState<'logs' | 'feedback'>(initialTab)

  // Logs Viewer State
  const [sessionFiles, setSessionFiles] = useState<SessionLogFile[]>([])
  const [selectedFile, setSelectedFile] = useState<string>('')
  const [logLines, setLogLines] = useState<LogLine[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [levelFilter, setLevelFilter] = useState<'ALL' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'>('ALL')
  const [isCopied, setIsCopied] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  // Feedback State
  const [feedbackTitle, setFeedbackTitle] = useState('')
  const [feedbackCategory, setFeedbackCategory] = useState<'bug' | 'feature' | 'other'>('bug')
  const [feedbackText, setFeedbackText] = useState('')
  const [attachLogs, setAttachLogs] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [feedbackSuccess, setFeedbackSuccess] = useState(false)
  const [feedbackError, setFeedbackError] = useState<string | null>(null)

  const logEndRef = useRef<HTMLDivElement>(null)

  // Load session logs list
  const fetchSessionLogs = async () => {
    setIsLoading(true)
    try {
      if (window.api?.getSessionLogs) {
        const files = await window.api.getSessionLogs()
        setSessionFiles(files)
        if (files.length > 0 && !selectedFile) {
          setSelectedFile(files[0].filename)
        }
      }
    } catch (e) {
      console.warn('Could not fetch session logs:', e)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchSessionLogs()
  }, [])

  // Load content of selected log file
  useEffect(() => {
    async function loadLogContent() {
      if (!selectedFile) return
      setIsLoading(true)
      try {
        let content = ''
        if (window.api?.readLogFile) {
          content = await window.api.readLogFile(selectedFile)
        }
        if (content) {
          const lines = content.split('\n').filter(Boolean)
          const parsed: LogLine[] = lines.map((l, idx) => {
            let level: LogLine['level'] = 'INFO'
            if (l.includes('[DEBUG]')) level = 'DEBUG'
            else if (l.includes('[WARN]')) level = 'WARN'
            else if (l.includes('[ERROR]')) level = 'ERROR'

            const timeMatch = l.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
            const timestamp = timeMatch ? timeMatch[0].replace('T', ' ') : ''

            return {
              id: idx,
              raw: l,
              level,
              timestamp,
              message: l
            }
          })
          setLogLines(parsed)
        } else {
          // Fallback example logs
          setLogLines([
            {
              id: 1,
              raw: '[INFO] Omega Wave Recorder Session started',
              level: 'INFO',
              timestamp: '2026-10-17 23:00:00',
              message: '[INFO] Omega Wave Recorder Session started successfully'
            },
            {
              id: 2,
              raw: '[DEBUG] AudioContext initialized with 48000 Hz 32-bit float',
              level: 'DEBUG',
              timestamp: '2026-10-17 23:00:01',
              message: '[DEBUG] AudioContext initialized with 48000 Hz 32-bit float'
            },
            {
              id: 3,
              raw: '[INFO] Multi-track routing ready (Tracks 1-4 active)',
              level: 'INFO',
              timestamp: '2026-10-17 23:00:02',
              message: '[INFO] Multi-track routing ready (Tracks 1-4 active)'
            }
          ])
        }
      } catch (err) {
        console.warn('Failed to read log file:', err)
      } finally {
        setIsLoading(false)
      }
    }
    loadLogContent()
  }, [selectedFile])

  // Filter logs
  const filteredLines = logLines.filter((line) => {
    if (levelFilter !== 'ALL' && line.level !== levelFilter) return false
    if (searchQuery.trim() && !line.raw.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false
    }
    return true
  })

  const handleCopyLogs = () => {
    const text = filteredLines.map((l) => l.raw).join('\n')
    navigator.clipboard.writeText(text)
    setIsCopied(true)
    setTimeout(() => setIsCopied(false), 2000)
  }

  const handleOpenLogsFolder = async () => {
    if (window.api?.openLogsFolder) {
      await window.api.openLogsFolder()
    }
  }

  const handleSendFeedback = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!feedbackTitle.trim() || !feedbackText.trim()) return

    setIsSending(true)
    setFeedbackError(null)

    try {
      if (window.api?.submitFeedback) {
        await window.api.submitFeedback({
          title: feedbackTitle,
          category: feedbackCategory,
          description: feedbackText,
          attachLogs
        })
      }
      setFeedbackSuccess(true)
      setTimeout(() => {
        setFeedbackSuccess(false)
        setFeedbackTitle('')
        setFeedbackText('')
        onClose()
      }, 1500)
    } catch (err: any) {
      setFeedbackError(err?.message || 'Feedback konnte nicht übermittelt werden.')
    } finally {
      setIsSending(false)
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
      <div className="bg-[#24272c] border border-gray-700/80 w-full max-w-4xl h-[650px] max-h-[92vh] rounded-xl shadow-2xl overflow-hidden flex flex-col text-xs text-gray-300">
        {/* Header */}
        <div className="bg-[#1a1d21] px-5 py-3 border-b border-gray-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <ScrollText size={16} className="text-omega-accent" />
            <h2 className="text-sm font-bold text-white tracking-wide">
              Diagnose-Logs & Feedback
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tab Header */}
        <div className="flex items-center border-b border-gray-800 bg-[#1e2126] px-5 shrink-0">
          <button
            onClick={() => setActiveTab('logs')}
            className={`py-2.5 px-4 font-semibold text-xs border-b-2 flex items-center gap-2 transition-all ${
              activeTab === 'logs'
                ? 'border-omega-accent text-white'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <FileText size={14} />
            <span>Logs anzeigen</span>
          </button>
          <button
            onClick={() => setActiveTab('feedback')}
            className={`py-2.5 px-4 font-semibold text-xs border-b-2 flex items-center gap-2 transition-all ${
              activeTab === 'feedback'
                ? 'border-omega-accent text-white'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <MessageSquare size={14} />
            <span>Feedback & Fehler melden</span>
          </button>
        </div>

        {/* Tab 1: Logs Viewer */}
        {activeTab === 'logs' && (
          <div className="flex-1 flex flex-col overflow-hidden p-4 space-y-3">
            {/* Filter & Action Bar */}
            <div className="flex items-center justify-between gap-3 bg-[#1a1d21] p-2.5 rounded-xl border border-gray-800">
              <div className="flex items-center gap-2 flex-1">
                {/* Session File Dropdown */}
                <select
                  value={selectedFile}
                  onChange={(e) => setSelectedFile(e.target.value)}
                  className="bg-[#202328] border border-gray-700 rounded px-2.5 py-1 text-white font-mono text-[11px] max-w-[240px] truncate"
                >
                  {sessionFiles.length === 0 ? (
                    <option value="">Aktuelle Sitzung</option>
                  ) : (
                    sessionFiles.map((f) => (
                      <option key={f.filename} value={f.filename}>
                        {f.filename}
                      </option>
                    ))
                  )}
                </select>

                {/* Level Filter */}
                <div className="flex items-center bg-[#202328] rounded p-0.5 border border-gray-700 text-[11px]">
                  {(['ALL', 'DEBUG', 'INFO', 'WARN', 'ERROR'] as const).map((lvl) => (
                    <button
                      key={lvl}
                      onClick={() => setLevelFilter(lvl)}
                      className={`px-2 py-0.5 rounded font-mono ${
                        levelFilter === lvl
                          ? 'bg-omega-accent text-white'
                          : 'text-gray-400 hover:text-gray-200'
                      }`}
                    >
                      {lvl}
                    </button>
                  ))}
                </div>

                {/* Search query */}
                <div className="relative flex-1 max-w-[200px]">
                  <Search size={12} className="absolute left-2.5 top-2 text-gray-500" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Logs durchsuchen..."
                    className="w-full bg-[#202328] border border-gray-700 rounded pl-7 pr-2 py-1 text-[11px] text-white focus:border-omega-accent outline-none"
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <button
                  onClick={fetchSessionLogs}
                  className="p-1.5 rounded bg-[#202328] hover:bg-[#2b2f36] border border-gray-700 text-gray-300 hover:text-white transition-colors"
                  title="Logs aktualisieren"
                >
                  <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
                </button>
                <button
                  onClick={handleCopyLogs}
                  className="px-3 py-1 bg-[#202328] hover:bg-[#2b2f36] border border-gray-700 rounded flex items-center gap-1.5 text-gray-200 hover:text-white transition-colors font-medium text-[11px]"
                >
                  {isCopied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                  <span>{isCopied ? 'Kopiert!' : 'Kopieren'}</span>
                </button>
                <button
                  onClick={handleOpenLogsFolder}
                  className="px-3 py-1 bg-[#202328] hover:bg-[#2b2f36] border border-gray-700 rounded flex items-center gap-1.5 text-gray-200 hover:text-white transition-colors font-medium text-[11px]"
                >
                  <FolderOpen size={13} className="text-omega-accent" />
                  <span>Ordner öffnen</span>
                </button>
              </div>
            </div>

            {/* Log Terminal Display */}
            <div className="flex-1 bg-[#121417] border border-gray-800 rounded-xl p-3 font-mono text-[11px] overflow-y-auto leading-relaxed custom-scrollbar">
              {filteredLines.length === 0 ? (
                <div className="text-gray-600 text-center py-12">
                  Keine Logs gefunden, die den Filterkriterien entsprechen.
                </div>
              ) : (
                filteredLines.map((line) => {
                  let levelColor = 'text-gray-300'
                  if (line.level === 'DEBUG') levelColor = 'text-purple-400'
                  if (line.level === 'INFO') levelColor = 'text-blue-400'
                  if (line.level === 'WARN') levelColor = 'text-amber-400'
                  if (line.level === 'ERROR') levelColor = 'text-red-400 font-bold'

                  return (
                    <div key={line.id} className="hover:bg-white/5 px-1 py-0.5 rounded flex items-start gap-2">
                      {line.timestamp && (
                        <span className="text-gray-600 shrink-0 select-none">
                          {line.timestamp}
                        </span>
                      )}
                      <span className={`shrink-0 ${levelColor}`}>
                        [{line.level}]
                      </span>
                      <span className="text-gray-200 break-all">{line.message}</span>
                    </div>
                  )
                })
              )}
              <div ref={logEndRef} />
            </div>
          </div>
        )}

        {/* Tab 2: Send Feedback */}
        {activeTab === 'feedback' && (
          <form onSubmit={handleSendFeedback} className="flex-1 p-6 space-y-4 overflow-y-auto">
            {feedbackSuccess && (
              <div className="bg-emerald-950/60 border border-emerald-800 p-3 rounded-lg flex items-center gap-2 text-emerald-200">
                <Check size={16} className="text-emerald-400" />
                <span>Vielen Dank! Ihr Feedback wurde erfolgreich übermittelt.</span>
              </div>
            )}
            {feedbackError && (
              <div className="bg-red-950/60 border border-red-800 p-3 rounded-lg flex items-center gap-2 text-red-200">
                <AlertCircle size={16} className="text-red-400" />
                <span>{feedbackError}</span>
              </div>
            )}

            <div>
              <label className="block text-gray-400 font-semibold mb-1">
                Kategorie:
              </label>
              <div className="flex items-center gap-2">
                {[
                  { id: 'bug', label: 'Fehlerbericht (Bug)' },
                  { id: 'feature', label: 'Funktionswunsch (Feature)' },
                  { id: 'other', label: 'Sonstiges Feedback' }
                ].map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setFeedbackCategory(cat.id as any)}
                    className={`py-1.5 px-3 rounded-lg border text-xs font-medium transition-all ${
                      feedbackCategory === cat.id
                        ? 'bg-omega-accent border-omega-accent text-white shadow-sm'
                        : 'bg-[#1a1d21] border-gray-700 text-gray-400 hover:text-white'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-gray-400 font-semibold mb-1">
                Titel / Betreff:
              </label>
              <input
                type="text"
                required
                value={feedbackTitle}
                onChange={(e) => setFeedbackTitle(e.target.value)}
                placeholder="Kurze Zusammenfassung des Problems..."
                className="w-full bg-[#1a1d21] border border-gray-700 rounded-lg p-2 text-white focus:border-omega-accent outline-none"
              />
            </div>

            <div>
              <label className="block text-gray-400 font-semibold mb-1">
                Beschreibung & Schritte zur Reproduktion:
              </label>
              <textarea
                required
                rows={7}
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                placeholder="Bitte beschreiben Sie so genau wie möglich, was passiert ist..."
                className="w-full bg-[#1a1d21] border border-gray-700 rounded-lg p-3 text-white focus:border-omega-accent outline-none resize-none leading-relaxed"
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="attachLogFile"
                checked={attachLogs}
                onChange={(e) => setAttachLogs(e.target.checked)}
                className="accent-omega-accent rounded cursor-pointer"
              />
              <label htmlFor="attachLogFile" className="text-gray-400 cursor-pointer text-xs">
                Aktuelles Sitzungs-Diagnose-Log anhängen (hilft bei der Fehlersuche)
              </label>
            </div>

            <div className="pt-3 border-t border-gray-800 flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg bg-[#1a1d21] hover:bg-[#282c32] border border-gray-700 text-gray-300 transition-colors"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                disabled={isSending}
                className="px-5 py-2 rounded-lg bg-omega-accent hover:bg-blue-600 text-white font-bold transition-all shadow-[0_0_10px_rgba(0,120,215,0.4)] flex items-center gap-2"
              >
                {isSending ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Wird gesendet...</span>
                  </>
                ) : (
                  <>
                    <Send size={14} />
                    <span>Feedback absenden</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

export default LogViewerModal
