import React, { useState, useEffect } from 'react'
import {
  SkipBack,
  Rewind,
  Play,
  Pause,
  Square,
  FastForward,
  SkipForward,
  Circle,
  Volume2,
  VolumeX,
  Headphones
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface AudioDevice {
  deviceId: string
  label: string
}

interface TransportBarProps {
  currentTime: number
  totalDuration: number
  isPlaying: boolean
  isRecording: boolean
  isAppendMode: boolean
  sampleRate?: number
  bitDepth?: string
  masterVolume: number
  selectedOutputDevice: string
  onPlay: () => void
  onPause: () => void
  onStop: () => void
  onRecord: () => void
  onSeek: (time: number) => void
  onToggleAppendMode: () => void
  onOutputDeviceChange: (deviceId: string) => void
  onMasterVolumeChange: (vol: number) => void
}

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) seconds = 0
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  const hundredths = Math.floor((seconds % 1) * 100)
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${hundredths.toString().padStart(2, '0')}`
}

export const TransportBar: React.FC<TransportBarProps> = ({
  currentTime,
  totalDuration,
  isPlaying,
  isRecording,
  isAppendMode,
  sampleRate = 48000,
  bitDepth = '24-Bit Stereo',
  masterVolume,
  selectedOutputDevice,
  onPlay,
  onPause,
  onStop,
  onRecord,
  onSeek,
  onToggleAppendMode,
  onOutputDeviceChange,
  onMasterVolumeChange
}) => {
  const { t } = useTranslation()
  const [outputDevices, setOutputDevices] = useState<AudioDevice[]>([])
  const [isMuted, setIsMuted] = useState(false)
  const [prevVolume, setPrevVolume] = useState(masterVolume)

  // Enumerate output audio devices via Web Audio MediaDevices
  useEffect(() => {
    async function loadAudioOutputs() {
      try {
        if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
          const devices = await navigator.mediaDevices.enumerateDevices()
          const outputs = devices
            .filter((d) => d.kind === 'audiooutput')
            .map((d, index) => ({
              deviceId: d.deviceId,
              label: d.label || `${t('transport.output_device', 'Ausgabegerät')} ${index + 1}`
            }))
          setOutputDevices(outputs)
        }
      } catch (err) {
        console.warn('Could not enumerate audio outputs:', err)
      }
    }

    loadAudioOutputs()
    if (navigator.mediaDevices) {
      navigator.mediaDevices.addEventListener('devicechange', loadAudioOutputs)
      return () => {
        navigator.mediaDevices.removeEventListener('devicechange', loadAudioOutputs)
      }
    }
  }, [t])

  const handlePlayPause = () => {
    if (isPlaying) {
      onPause()
    } else {
      onPlay()
    }
  }

  const handleToStart = () => {
    onSeek(0)
  }

  const handleToEnd = () => {
    onSeek(totalDuration)
  }

  const handleBack1s = () => {
    onSeek(Math.max(0, currentTime - 1.0))
  }

  const handleForward1s = () => {
    onSeek(Math.min(totalDuration, currentTime + 1.0))
  }

  const handleToggleMuteMaster = () => {
    if (isMuted) {
      setIsMuted(false)
      onMasterVolumeChange(prevVolume > 0 ? prevVolume : 1.0)
    } else {
      setPrevVolume(masterVolume)
      setIsMuted(true)
      onMasterVolumeChange(0)
    }
  }

  return (
    <div className="h-12 bg-[#1b1d22] border-t border-[#2d3036] flex items-center justify-between px-3 select-none text-xs text-gray-200 shrink-0">
      {/* Left: Transport Buttons */}
      <div className="flex items-center gap-1.5">
        {/* Rewind to Start */}
        <button
          onClick={handleToStart}
          title={t('transport.to_start', 'Zum Anfang springen (Pos1)')}
          className="w-7 h-7 rounded-lg bg-[#24272d] hover:bg-[#32363e] active:scale-[0.97] border border-gray-700/60 flex items-center justify-center text-gray-300 hover:text-white transition-all duration-150"
        >
          <SkipBack size={13} />
        </button>

        {/* Back 1 second */}
        <button
          onClick={handleBack1s}
          title={t('transport.back_1s', '1 Sekunde zurück')}
          className="w-7 h-7 rounded-lg bg-[#24272d] hover:bg-[#32363e] active:scale-[0.97] border border-gray-700/60 flex items-center justify-center text-gray-300 hover:text-white transition-all duration-150"
        >
          <Rewind size={13} />
        </button>

        {/* Play / Pause Button */}
        <button
          onClick={handlePlayPause}
          title={isPlaying ? t('transport.pause', 'Pause (Leertaste)') : t('transport.play', 'Abspielen (Leertaste)')}
          className={`h-7 px-3.5 rounded-lg flex items-center gap-1.5 font-semibold text-xs transition-all duration-150 active:scale-[0.97] shadow-sm ${
            isPlaying
              ? 'bg-[#0078d7] hover:bg-[#1084e3] text-white shadow-[0_0_12px_rgba(0,120,215,0.4)]'
              : 'bg-[#282c33] hover:bg-[#353a42] text-white border border-gray-700/70'
          }`}
        >
          {isPlaying ? (
            <>
              <Pause size={13} className="fill-white" />
              <span>{t('transport.pause', 'Pause')}</span>
            </>
          ) : (
            <>
              <Play size={13} className="fill-white" />
              <span>{t('transport.play', 'Play')}</span>
            </>
          )}
        </button>

        {/* Stop Button */}
        <button
          onClick={onStop}
          title={t('transport.stop', 'Stopp (Esc)')}
          className="w-7 h-7 rounded-lg bg-[#24272d] hover:bg-[#32363e] active:scale-[0.97] border border-gray-700/60 flex items-center justify-center text-gray-300 hover:text-white transition-all duration-150"
        >
          <Square size={12} className="fill-gray-300" />
        </button>

        {/* Forward 1 second */}
        <button
          onClick={handleForward1s}
          title={t('transport.forward_1s', '1 Sekunde vor')}
          className="w-7 h-7 rounded-lg bg-[#24272d] hover:bg-[#32363e] active:scale-[0.97] border border-gray-700/60 flex items-center justify-center text-gray-300 hover:text-white transition-all duration-150"
        >
          <FastForward size={13} />
        </button>

        {/* Forward to End */}
        <button
          onClick={handleToEnd}
          title={t('transport.to_end', 'Zum Ende springen (Ende)')}
          className="w-7 h-7 rounded-lg bg-[#24272d] hover:bg-[#32363e] active:scale-[0.97] border border-gray-700/60 flex items-center justify-center text-gray-300 hover:text-white transition-all duration-150"
        >
          <SkipForward size={13} />
        </button>

        {/* Master Record Button */}
        <button
          onClick={onRecord}
          title={isRecording ? t('transport.recording', 'Aufnahme stoppen (R)') : t('transport.record', 'Aufnahme starten (R)')}
          className={`h-7 px-3 ml-1 rounded-lg flex items-center gap-1.5 font-bold text-xs transition-all duration-150 active:scale-[0.97] border ${
            isRecording
              ? 'bg-red-600/90 hover:bg-red-500 border-red-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.5)] animate-pulse'
              : 'bg-[#2a1e20] hover:bg-[#382326] border-red-900/60 text-red-400 hover:text-red-300'
          }`}
        >
          <Circle size={10} className={isRecording ? 'fill-white text-white' : 'fill-red-500 text-red-500'} />
          <span>{isRecording ? 'REC ●' : 'REC'}</span>
        </button>
      </div>

      {/* Center: LCD Time Display & Format Badge */}
      <div className="flex items-center gap-3">
        {/* LCD Counter */}
        <div className="flex items-baseline bg-[#101215] border border-gray-800 px-3 py-1 rounded-lg shadow-inner font-mono">
          <span className="text-white text-sm font-bold tracking-wider">
            {formatTime(currentTime)}
          </span>
          <span className="text-gray-500 text-xs mx-1">/</span>
          <span className="text-gray-400 text-xs font-medium">
            {formatTime(totalDuration)}
          </span>
        </div>

        {/* Sample Rate & Bit Depth Badge */}
        <div className="hidden sm:flex items-center gap-1 bg-[#141619] border border-gray-800 text-[10px] text-gray-400 px-2.5 py-1 rounded-md font-mono">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"></span>
          <span>{Math.round(sampleRate / 1000)} kHz</span>
          <span className="text-gray-600">•</span>
          <span>{bitDepth}</span>
        </div>
      </div>

      {/* Right: Append Mode Toggle + Audio Output Sink + Master Volume */}
      <div className="flex items-center gap-3">
        {/* Append Mode Switch */}
        <button
          onClick={onToggleAppendMode}
          title={
            isAppendMode
              ? t('transport.append_mode', 'Modus: Am Ende anfügen')
              : t('transport.cursor_mode', 'Modus: Ab aktueller Position aufnehmen')
          }
          className={`px-2.5 py-1 rounded-lg text-xs font-medium border flex items-center gap-1.5 transition-all duration-150 ${
            isAppendMode
              ? 'bg-[#0078d7]/20 border-omega-accent text-blue-300'
              : 'bg-[#1e2126] border-gray-700/60 text-gray-400 hover:text-gray-200'
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              isAppendMode ? 'bg-omega-accent' : 'bg-gray-500'
            }`}
          />
          <span>{isAppendMode ? t('transport.append_mode', 'Anfügen (Ende)') : t('transport.cursor_mode', 'Ab Cursor')}</span>
        </button>

        {/* Output Device Selector */}
        <div className="flex items-center gap-1.5 bg-[#141619] border border-gray-700/60 rounded-lg px-2 py-0.5 max-w-[200px]">
          <Headphones size={13} className="text-omega-accent shrink-0" />
          <select
            value={selectedOutputDevice}
            onChange={(e) => onOutputDeviceChange(e.target.value)}
            className="bg-transparent text-gray-300 text-xs outline-none cursor-pointer w-full truncate py-0.5"
            title={t('transport.output_device', 'Audio-Ausgangsgerät')}
          >
            <option value="default" className="bg-[#1e2126] text-white">
              {t('transport.system_default', 'Systemstandard')}
            </option>
            {outputDevices.map((d) => (
              <option key={d.deviceId} value={d.deviceId} className="bg-[#1e2126] text-white">
                {d.label}
              </option>
            ))}
          </select>
        </div>

        {/* Master Volume Fader */}
        <div className="hidden lg:flex items-center gap-1.5 w-24">
          <button
            onClick={handleToggleMuteMaster}
            className="text-gray-400 hover:text-white transition-colors"
          >
            {isMuted || masterVolume === 0 ? <VolumeX size={14} className="text-red-400" /> : <Volume2 size={14} />}
          </button>
          <input
            type="range"
            min="0"
            max="1.5"
            step="0.01"
            value={isMuted ? 0 : masterVolume}
            onChange={(e) => {
              setIsMuted(false)
              onMasterVolumeChange(parseFloat(e.target.value))
            }}
            className="w-full h-1 bg-[#141619] rounded-lg appearance-none cursor-pointer accent-omega-accent border border-gray-800"
            title={`${t('track.gain', 'Master-Lautstärke')}: ${Math.round(masterVolume * 100)}%`}
          />
        </div>
      </div>
    </div>
  )
}

export default TransportBar
