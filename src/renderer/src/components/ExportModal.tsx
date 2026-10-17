import React, { useState, useEffect } from 'react'
import {
  Download,
  X,
  FileAudio,
  Layers,
  Tag,
  Image as ImageIcon,
  FolderOpen,
  CheckCircle,
  AlertCircle
} from 'lucide-react'
import type { ExportSettings, MetadataTags } from '../../../common/types'

interface ExportModalProps {
  onClose: () => void
  onExport: (settings: ExportSettings) => Promise<void> | void
  defaultPath?: string
}

export const ExportModal: React.FC<ExportModalProps> = ({
  onClose,
  onExport,
  defaultPath = 'C:\\Exports\\Aufnahme'
}) => {
  const [format, setFormat] = useState<'wav' | 'mp3' | 'ogg'>('mp3')
  const [mode, setMode] = useState<'mixdown' | 'stems'>('mixdown')
  const [sampleRate, setSampleRate] = useState<number>(48000)
  const [bitDepth, setBitDepth] = useState<string>('24 Bit')
  const [bitrate, setBitrate] = useState<string>('320')
  const [channels, setChannels] = useState<'Stereo' | 'Mono'>('Stereo')
  const [targetPath, setTargetPath] = useState<string>(defaultPath)
  const [playAfterExport, setPlayAfterExport] = useState(false)

  // ID3 Metadata Tags
  const [id3Title, setId3Title] = useState('')
  const [id3Artist, setId3Artist] = useState('')
  const [id3Album, setId3Album] = useState('')
  const [id3Year, setId3Year] = useState(new Date().getFullYear().toString())
  const [id3Genre, setId3Genre] = useState('Recording')
  const [id3Comment, setId3Comment] = useState('Recorded with Omega Wave Recorder')
  const [id3Track, setId3Track] = useState('1')
  const [id3CoverPath, setId3CoverPath] = useState<string | null>(null)

  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isExporting) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, isExporting])

  const handleSelectCoverArt = async () => {
    try {
      if (window.api?.showOpenDialog) {
        const res = await window.api.showOpenDialog({
          title: 'Cover-Bild auswählen',
          filters: [{ name: 'Bilder (JPG, PNG)', extensions: ['jpg', 'jpeg', 'png'] }],
          properties: ['openFile']
        })
        if (!res.canceled && res.filePaths?.[0]) {
          setId3CoverPath(res.filePaths[0])
        }
      }
    } catch (e) {
      console.warn('Cover Art selection failed:', e)
    }
  }

  const handleSelectOutputPath = async () => {
    try {
      if (window.api?.showSaveDialog) {
        const ext = format === 'wav' ? 'wav' : format === 'mp3' ? 'mp3' : 'ogg'
        const res = await window.api.showSaveDialog({
          title: 'Zielort für Audio-Export wählen',
          defaultPath: `${targetPath}.${ext}`,
          filters: [
            { name: `${format.toUpperCase()} Audio`, extensions: [ext] },
            { name: 'Alle Dateien', extensions: ['*'] }
          ]
        })
        if (!res.canceled && res.filePath) {
          setTargetPath(res.filePath)
        }
      }
    } catch (e) {
      console.warn('Save dialog error:', e)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsExporting(true)
    setError(null)

    const id3Tags: MetadataTags = {
      title: id3Title.trim() || undefined,
      artist: id3Artist.trim() || undefined,
      album: id3Album.trim() || undefined,
      year: id3Year.trim() || undefined,
      genre: id3Genre.trim() || undefined,
      comment: id3Comment.trim() || undefined,
      track: id3Track.trim() || undefined,
      coverPath: id3CoverPath || undefined
    }

    const settings: ExportSettings = {
      format,
      mode,
      path: targetPath,
      sampleRate,
      bitDepth: format === 'wav' ? bitDepth : undefined,
      bitrate: format !== 'wav' ? bitrate : undefined,
      channels,
      playAfterExport,
      id3Tags
    }

    try {
      await onExport(settings)
      onClose()
    } catch (err: any) {
      setError(err?.message || 'Fehler beim Exportieren des Audios.')
      setIsExporting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[5000] p-4 select-none animate-in fade-in duration-150">
      <div className="bg-[#24272c] border border-gray-700/80 w-full max-w-2xl rounded-xl shadow-2xl overflow-hidden flex flex-col text-xs text-gray-300">
        {/* Header */}
        <div className="bg-[#1a1d21] px-5 py-3.5 border-b border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Download size={16} className="text-omega-accent" />
            <h2 className="text-sm font-bold text-white tracking-wide">
              Audio Exportieren
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={isExporting}
            className="text-gray-500 hover:text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto max-h-[80vh]">
          {error && (
            <div className="bg-red-950/60 border border-red-800 p-3 rounded-lg flex items-center gap-2 text-red-200">
              <AlertCircle size={16} className="shrink-0 text-red-400" />
              <span>{error}</span>
            </div>
          )}

          {/* Section 1: Format & Mode */}
          <div className="grid grid-cols-2 gap-4">
            {/* Format Selection */}
            <div>
              <label className="block text-gray-400 font-semibold mb-1.5">
                Audioformat:
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['wav', 'mp3', 'ogg'] as const).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => setFormat(fmt)}
                    className={`py-2 px-3 rounded-lg border font-bold text-xs uppercase transition-all ${
                      format === fmt
                        ? 'bg-omega-accent border-omega-accent text-white shadow-[0_0_10px_rgba(0,120,215,0.4)]'
                        : 'bg-[#1a1d21] hover:bg-[#282c32] border-gray-700/70 text-gray-300'
                    }`}
                  >
                    {fmt}
                  </button>
                ))}
              </div>
            </div>

            {/* Mode Selection */}
            <div>
              <label className="block text-gray-400 font-semibold mb-1.5">
                Export-Modus:
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMode('mixdown')}
                  className={`py-2 px-2.5 rounded-lg border font-medium text-xs flex items-center justify-center gap-1.5 transition-all ${
                    mode === 'mixdown'
                      ? 'bg-omega-accent border-omega-accent text-white shadow-[0_0_10px_rgba(0,120,215,0.4)]'
                      : 'bg-[#1a1d21] hover:bg-[#282c32] border-gray-700/70 text-gray-300'
                  }`}
                >
                  <FileAudio size={14} />
                  <span>Summen-Mixdown</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMode('stems')}
                  className={`py-2 px-2.5 rounded-lg border font-medium text-xs flex items-center justify-center gap-1.5 transition-all ${
                    mode === 'stems'
                      ? 'bg-omega-accent border-omega-accent text-white shadow-[0_0_10px_rgba(0,120,215,0.4)]'
                      : 'bg-[#1a1d21] hover:bg-[#282c32] border-gray-700/70 text-gray-300'
                  }`}
                >
                  <Layers size={14} />
                  <span>Einzelspuren (Stems)</span>
                </button>
              </div>
            </div>
          </div>

          {/* Section 2: Audio Parameters */}
          <div className="bg-[#1a1d21] p-4 rounded-xl border border-gray-800 grid grid-cols-3 gap-3">
            <div>
              <label className="block text-gray-400 font-medium mb-1">
                Samplerate:
              </label>
              <select
                value={sampleRate}
                onChange={(e) => setSampleRate(parseInt(e.target.value))}
                className="w-full bg-[#202328] border border-gray-700 rounded p-1.5 text-white"
              >
                <option value={44100}>44.1 kHz (CD Audio)</option>
                <option value={48000}>48.0 kHz (Studio Standard)</option>
                <option value={96000}>96.0 kHz (High-Res)</option>
              </select>
            </div>

            {format === 'wav' ? (
              <div>
                <label className="block text-gray-400 font-medium mb-1">
                  Bittiefe:
                </label>
                <select
                  value={bitDepth}
                  onChange={(e) => setBitDepth(e.target.value)}
                  className="w-full bg-[#202328] border border-gray-700 rounded p-1.5 text-white"
                >
                  <option value="16 Bit">16-Bit PCM</option>
                  <option value="24 Bit">24-Bit Studio PCM</option>
                  <option value="32 Bit float">32-Bit Float PCM</option>
                </select>
              </div>
            ) : (
              <div>
                <label className="block text-gray-400 font-medium mb-1">
                  Bitrate:
                </label>
                <select
                  value={bitrate}
                  onChange={(e) => setBitrate(e.target.value)}
                  className="w-full bg-[#202328] border border-gray-700 rounded p-1.5 text-white"
                >
                  <option value="128">128 kbps (Standard)</option>
                  <option value="192">192 kbps (Medium)</option>
                  <option value="256">256 kbps (High)</option>
                  <option value="320">320 kbps (Maximum)</option>
                </select>
              </div>
            )}

            <div>
              <label className="block text-gray-400 font-medium mb-1">
                Kanäle:
              </label>
              <select
                value={channels}
                onChange={(e) => setChannels(e.target.value as any)}
                className="w-full bg-[#202328] border border-gray-700 rounded p-1.5 text-white"
              >
                <option value="Stereo">Stereo (2 Kanäle)</option>
                <option value="Mono">Mono (1 Kanal)</option>
              </select>
            </div>
          </div>

          {/* Section 3: Vollwertiger ID3-Tag-Editor */}
          <div className="bg-[#1a1d21] p-4 rounded-xl border border-gray-800 space-y-3">
            <div className="flex items-center gap-2 border-b border-gray-800 pb-2">
              <Tag size={15} className="text-omega-accent" />
              <h3 className="font-bold text-white text-xs">
                ID3-Metadaten & Cover-Art
              </h3>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-gray-400 mb-1">Titel:</label>
                <input
                  type="text"
                  value={id3Title}
                  onChange={(e) => setId3Title(e.target.value)}
                  placeholder="Song- / Aufnahmetitel"
                  className="w-full bg-[#202328] border border-gray-700 rounded px-2.5 py-1 text-white focus:border-omega-accent outline-none"
                />
              </div>

              <div>
                <label className="block text-gray-400 mb-1">Künstler / Interpret:</label>
                <input
                  type="text"
                  value={id3Artist}
                  onChange={(e) => setId3Artist(e.target.value)}
                  placeholder="Interpret oder Band"
                  className="w-full bg-[#202328] border border-gray-700 rounded px-2.5 py-1 text-white focus:border-omega-accent outline-none"
                />
              </div>

              <div>
                <label className="block text-gray-400 mb-1">Album:</label>
                <input
                  type="text"
                  value={id3Album}
                  onChange={(e) => setId3Album(e.target.value)}
                  placeholder="Album-Name"
                  className="w-full bg-[#202328] border border-gray-700 rounded px-2.5 py-1 text-white focus:border-omega-accent outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-gray-400 mb-1">Jahr:</label>
                  <input
                    type="text"
                    value={id3Year}
                    onChange={(e) => setId3Year(e.target.value)}
                    className="w-full bg-[#202328] border border-gray-700 rounded px-2.5 py-1 text-white focus:border-omega-accent outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="block text-gray-400 mb-1">Track-Nr.:</label>
                  <input
                    type="text"
                    value={id3Track}
                    onChange={(e) => setId3Track(e.target.value)}
                    className="w-full bg-[#202328] border border-gray-700 rounded px-2.5 py-1 text-white focus:border-omega-accent outline-none font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-gray-400 mb-1">Genre:</label>
                <input
                  type="text"
                  value={id3Genre}
                  onChange={(e) => setId3Genre(e.target.value)}
                  className="w-full bg-[#202328] border border-gray-700 rounded px-2.5 py-1 text-white focus:border-omega-accent outline-none"
                />
              </div>

              <div>
                <label className="block text-gray-400 mb-1">Kommentar:</label>
                <input
                  type="text"
                  value={id3Comment}
                  onChange={(e) => setId3Comment(e.target.value)}
                  className="w-full bg-[#202328] border border-gray-700 rounded px-2.5 py-1 text-white focus:border-omega-accent outline-none"
                />
              </div>
            </div>

            {/* Cover Art Selector */}
            <div className="pt-1">
              <label className="block text-gray-400 mb-1">Cover-Art (JPG / PNG):</label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSelectCoverArt}
                  className="px-3 py-1.5 bg-[#202328] hover:bg-[#2a2f38] border border-gray-700 rounded flex items-center gap-1.5 text-white transition-colors"
                >
                  <ImageIcon size={14} className="text-omega-accent" />
                  <span>Cover auswählen...</span>
                </button>
                <span className="text-gray-400 truncate flex-1 font-mono text-[11px]">
                  {id3CoverPath ? id3CoverPath : 'Kein Cover gewählt'}
                </span>
                {id3CoverPath && (
                  <button
                    type="button"
                    onClick={() => setId3CoverPath(null)}
                    className="text-gray-500 hover:text-red-400 text-xs"
                  >
                    Entfernen
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Section 4: Target Path */}
          <div>
            <label className="block text-gray-400 font-semibold mb-1">
              Speicherort:
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={targetPath}
                onChange={(e) => setTargetPath(e.target.value)}
                className="flex-1 bg-[#1a1d21] border border-gray-700 rounded px-3 py-1.5 text-white focus:border-omega-accent outline-none font-mono"
              />
              <button
                type="button"
                onClick={handleSelectOutputPath}
                className="px-3 py-1.5 bg-[#1a1d21] hover:bg-[#282c32] border border-gray-700 rounded flex items-center gap-1.5 text-white transition-colors"
              >
                <FolderOpen size={14} />
                <span>Durchsuchen</span>
              </button>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="pt-2 border-t border-gray-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="playAfter"
                checked={playAfterExport}
                onChange={(e) => setPlayAfterExport(e.target.checked)}
                className="accent-omega-accent rounded cursor-pointer"
              />
              <label htmlFor="playAfter" className="text-gray-400 cursor-pointer">
                Nach Export automatisch abspielen
              </label>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={isExporting}
                className="px-4 py-2 rounded-lg bg-[#1a1d21] hover:bg-[#282c32] border border-gray-700 text-gray-300 transition-colors"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                disabled={isExporting}
                className="px-5 py-2 rounded-lg bg-omega-accent hover:bg-blue-600 active:scale-[0.97] text-white font-bold transition-all shadow-[0_0_12px_rgba(0,120,215,0.4)] flex items-center gap-2"
              >
                {isExporting ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Exportiert...</span>
                  </>
                ) : (
                  <>
                    <Download size={14} />
                    <span>Jetzt exportieren</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

export default ExportModal
