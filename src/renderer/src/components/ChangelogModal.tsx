import React, { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { FileCode2, X } from 'lucide-react'

interface ChangelogEntry {
  version: string
  date: string
  english: string
  deutsch: string
}

function parseChangelog(raw: string): ChangelogEntry[] {
  const normalized = raw.replace(/\r\n/g, '\n')
  const entries: ChangelogEntry[] = []
  const versionBlocks = normalized.split(/\n(?=## \[)/)

  for (const block of versionBlocks) {
    const versionMatch = block.match(/^## \[([^\]]+)\]\s*-\s*(.+)/)
    if (!versionMatch) continue

    const version = versionMatch[1].trim()
    const date = versionMatch[2].trim()

    const englishMatch = block.match(/### English\n([\s\S]*?)(?=\n### |\n## |\n---|\s*$)/)
    const deutschMatch = block.match(/### Deutsch\n([\s\S]*?)(?=\n### |\n## |\n---|\s*$)/)
    const fallbackText = block.replace(/^## \[([^\]]+)\]\s*-\s*.+/, '').trim()

    entries.push({
      version,
      date,
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
    if (line.startsWith('#### ')) {
      const rawLabel = line.slice(5).trim()
      const cleanLabel = rawLabel.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').trim()

      let color = 'text-gray-300'
      const labelLower = cleanLabel.toLowerCase()
      if (labelLower.includes('notice') || labelLower.includes('hinweis') || labelLower.includes('wichtig')) {
        color = 'text-red-400 font-extrabold'
        isImportant = true
      } else {
        isImportant = false
        if (labelLower.includes('added') || labelLower.includes('hinzugefügt') || labelLower.includes('neu')) {
          color = 'text-emerald-400'
        } else if (labelLower.includes('fixed') || labelLower.includes('behoben')) {
          color = 'text-blue-400'
        } else if (labelLower.includes('changed') || labelLower.includes('geändert') || labelLower.includes('verbessert')) {
          color = 'text-amber-400'
        } else if (labelLower.includes('removed') || labelLower.includes('entfernt')) {
          color = 'text-red-400'
        }
      }
      return (
        <h5 key={idx} className={`${color} font-bold text-xs uppercase tracking-widest mt-4 mb-2 first:mt-0`}>
          {cleanLabel}
        </h5>
      )
    }
    if (line.startsWith('- ') || line.startsWith('* ')) {
      const content = line.slice(2)
      return (
        <div key={idx} className="flex items-start gap-2 mb-2">
          <span className={`${isImportant ? 'text-red-500' : 'text-omega-accent'} mt-1 shrink-0 text-xs`}>•</span>
          <p className={`${isImportant ? 'text-red-300 font-semibold' : 'text-gray-200'} text-xs leading-relaxed`}>
            {renderInline(content)}
          </p>
        </div>
      )
    }
    if (line.trim() === '') return <div key={idx} className="h-1" />
    return <p key={idx} className={`${isImportant ? 'text-red-300 font-semibold' : 'text-gray-400'} text-xs`}>{renderInline(line)}</p>
  })
}

interface ChangelogModalProps {
  onClose: () => void
}

export const ChangelogModal: React.FC<ChangelogModalProps> = ({ onClose }) => {
  const { i18n } = useTranslation()
  const [lang, setLang] = useState<'de' | 'en'>(i18n.language?.startsWith('de') ? 'de' : 'en')
  const [entries, setEntries] = useState<ChangelogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const loadChangelog = async () => {
      try {
        let raw = ''
        if (window.api?.readChangelog) {
          raw = await window.api.readChangelog()
        }
        if (raw) {
          setEntries(parseChangelog(raw))
        } else {
          // Fallback initial 0.1.0 changelog
          setEntries([
            {
              version: '0.1.0',
              date: '2026-10-17',
              deutsch: `#### Neu\n- **Multi-Track Audio Recorder**: Schlankes Aufnahmeprogramm mit bis zu 4 Spuren für parallele Mehrspuraufnahmen oder gezielte Einzelaufnahmen (Overdub / Punch-in).\n- **Programm-Audio-Aufnahme**: Isoliertes Abgreifen einzelner Windows-Programme (z. B. Spotify, Discord) über das OBS-Studio-Verfahren (Windows WASAPI Process Loopback).\n- **Hardware- & Line-In Eingänge**: Studio-Qualität bei der Aufnahme über Mikrofone, Line-In und virtuelle Audiogeräte mit 32-Bit Float PCM.\n- **Wählbarer Audioausgang**: Flexible Wahl des Abhörgeräts direkt in der Bedienleiste über die Web Audio API.\n- **Time Ruler & Schnittwerkzeuge**: Präziser Schnitt über den Time Ruler für alle Spuren synchron oder isoliert pro Spur mit klickfreiem 3ms Micro-Fade.\n- **Hybrid-Ansicht**: Umschaltbar zwischen 4-Spur-Stapelung und vergrößerter Retro-Einzelspuransicht im Look des klassischen Windows WAV-Recorders.\n- **ID3-Tag-Editor**: Vollwertiger Metadaten- und Cover-Art-Editor beim Export nach WAV, MP3 und OGG.`,
              english: `#### Added\n- **Multi-Track Audio Recorder**: Lean multitrack audio recorder supporting up to 4 tracks for parallel or punch-in recording.\n- **Application Audio Capture**: Isolated capture of specific Windows applications (such as Spotify, Discord) via OBS-style WASAPI Process Loopback.\n- **Hardware & Line-In Inputs**: Studio-quality raw recording for microphones, line-in, and virtual audio devices using 32-bit float PCM.\n- **Selectable Audio Output**: Flexible monitoring device routing directly from the transport bar via Web Audio API.\n- **Time Ruler & Smart Cutting**: Precise cutting via Time Ruler with click-free 3ms micro-crossfades.\n- **Hybrid View**: Toggle between a compact 4-track layout and an expanded retro single-track focus view.\n- **ID3 Tag Editor**: Full metadata and cover art tagging when exporting to WAV, MP3, and OGG formats.`
            }
          ])
        }
      } catch (e) {
        console.warn('Failed to load changelog:', e)
      } finally {
        setLoading(false)
      }
    }
    loadChangelog()
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      ref={overlayRef}
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose()
      }}
      className="fixed inset-0 z-[5000] flex items-center justify-center bg-black/80 backdrop-blur-sm select-none p-4 animate-in fade-in duration-150"
    >
      <div className="bg-[#24272c] border border-gray-700/80 rounded-xl shadow-2xl flex flex-col w-[760px] max-w-[95vw] h-[580px] max-h-[90vh] overflow-hidden text-xs text-gray-300">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-800 bg-[#1a1d21] shrink-0">
          <div className="flex items-center gap-2.5">
            <FileCode2 className="text-omega-accent" size={17} />
            <h2 className="text-white font-bold text-sm tracking-wide">
              Changelog & Versionsverlauf
            </h2>
          </div>

          <div className="flex items-center gap-3">
            {/* Language toggle */}
            <div className="flex items-center bg-[#16181b] rounded-lg p-0.5 border border-gray-700/60">
              <button
                onClick={() => setLang('de')}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                  lang === 'de'
                    ? 'bg-omega-accent text-white shadow-sm'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                🇩🇪 Deutsch
              </button>
              <button
                onClick={() => setLang('en')}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                  lang === 'en'
                    ? 'bg-omega-accent text-white shadow-sm'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                🇬🇧 English
              </button>
            </div>

            <button
              onClick={onClose}
              className="text-gray-500 hover:text-white transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
          {loading ? (
            <div className="text-gray-500 text-xs text-center mt-16 font-mono">
              Lade Changelog...
            </div>
          ) : entries.length > 0 ? (
            entries.map((entry) => {
              const content = lang === 'de' ? entry.deutsch : entry.english
              return (
                <div
                  key={entry.version}
                  className="border-b border-gray-700/50 pb-6 last:border-0 last:pb-0"
                >
                  <div className="flex items-baseline gap-3 mb-3">
                    <h3 className="text-omega-accent font-black text-base">
                      v{entry.version}
                    </h3>
                    <span className="text-gray-500 text-xs font-mono">{entry.date}</span>
                  </div>
                  <div>{renderMarkdownBlock(content)}</div>
                </div>
              )
            })
          ) : (
            <div className="text-gray-500 text-xs text-center mt-16">
              Kein Changelog verfügbar.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default ChangelogModal
