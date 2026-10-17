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
  Headphones,
  Sliders
} from 'lucide-react'

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
  const [outputDevices, setOutputDevices] = useState<AudioDevice[]>([])
  const [isMuted, setIsMuted] = useState(false)
  const [prevVolume, setPrevVolume] = useState(masterVolume || 1.0)

  // Enumerate audio output devices
  useEffect(() => {
    async function loadAudioDevices() {
      try {
        if (navigator.mediaDevices?.enumerateDevices) {
          const devices = await navigator.mediaDevices.enumerateDevices()
          const audioOutputs = devices
            .filter((d) => d.kind === 'audiooutput')
            .map((d, index) => ({
              deviceId: d.deviceId,
              label: d.label || `Ausgabegerät ${index + 1}`
            }))
          setOutputDevices(audioOutputs)
        }
      } catch (err) {
        console.warn('Could not enumerate audio output devices:', err)
      }
    }
    loadAudioDevices()

    if (navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', loadAudioDevices)
      return () => {
        navigator.mediaDevices.removeEventListener('devicechange', loadAudioDevices)
      }
    }
  }, [])

  const handleToStart = () => {
    onSeek(0)
  }

  const handleBack1s = () => {
    onSeek(Math.max(0, currentTime - 1.0))
  }

  const handleForward1s = () => {
    onSeek(Math.min(totalDuration, currentTime + 1.0))
  }

  const handleToEnd = () => {
    onSeek(totalDuration)
  }

  const handlePlayPause = () => {
    if (isPlaying) {
      onPause()
    } else {
      onPlay()
    }
  }

  const handleMuteToggle = () => {
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
    <div className="h-14 bg-[#1a1d21] border-t border-[#2e3238] flex items-center justify-between px-4 select-none shrink-0 z-30">
      {/* Left: Transport Control Buttons */}
      <div className="flex items-center gap-1.5">
        {/* Rewind to Start */}
        <button
          onClick={handleToStart}
          title="Zum Anfang springen (Pos1)"
          className="w-8 h-8 rounded-lg bg-[#25282e] hover:bg-[#32363e] active:scale-[0.97] border border-gray-700/60 flex items-center justify-center text-gray-300 hover:text-white transition-all duration-150"
        >
          <SkipBack size={14} />
        </button>

        {/* Back 1 second */}
        <button
          onClick={handleBack1s}
          title="1 Sekunde zurück (Pfeil links)"
          className="w-8 h-8 rounded-lg bg-[#25282e] hover:bg-[#32363e] active:scale-[0.97] border border-gray-700/60 flex items-center justify-center text-gray-300 hover:text-white transition-all duration-150"
        >
          <Rewind size={14} />
        </button>

        {/* Play / Pause Button */}
        <button
          onClick={handlePlayPause}
          title={isPlaying ? 'Pause (Leertaste)' : 'Abspielen (Leertaste)'}
          className={`h-8 px-4 rounded-lg flex items-center gap-1.5 font-semibold text-xs transition-all duration-150 active:scale-[0.97] shadow-sm ${
            isPlaying
              ? 'bg-[#0078d7] hover:bg-[#1084e3] text-white shadow-[0_0_12px_rgba(0,120,215,0.4)]'
              : 'bg-[#282c33] hover:bg-[#353a42] text-white border border-gray-700/70'
          }`}
        >
          {isPlaying ? (
            <>
              <Pause size={14} className="fill-white" />
              <span>Pause</span>
            </>
          ) : (
            <>
              <Play size={14} className="fill-white" />
              <span>Play</span>
            </>
          )}
        </button>

        {/* Stop Button */}
        <button
          onClick={onStop}
          title="Stopp (Esc / Stop)"
          className="w-8 h-8 rounded-lg bg-[#25282e] hover:bg-[#32363e] active:scale-[0.97] border border-gray-700/60 flex items-center justify-center text-gray-300 hover:text-white transition-all duration-150"
        >
          <Square size={13} className="fill-gray-300" />
        </button>

        {/* Forward 1 second */}
        <button
          onClick={handleForward1s}
          title="1 Sekunde vor (Pfeil rechts)"
          className="w-8 h-8 rounded-lg bg-[#25282e] hover:bg-[#32363e] active:scale-[0.97] border border-gray-700/60 flex items-center justify-center text-gray-300 hover:text-white transition-all duration-150"
        >
          <FastForward size={14} />
        </button>

        {/* Forward to End */}
        <button
          onClick={handleToEnd}
          title="Zum Ende springen (Ende)"
          className="w-8 h-8 rounded-lg bg-[#25282e] hover:bg-[#32363e] active:scale-[0.97] border border-gray-700/60 flex items-center justify-center text-gray-300 hover:text-white transition-all duration-150"
        >
          <SkipForward size={14} />
        </button>

        {/* Master Record Button */}
        <button
          onClick={onRecord}
          title={isRecording ? 'Aufnahme stoppen (R)' : 'Aufnahme starten (R)'}
          className={`h-8 px-3.5 ml-1 rounded-lg flex items-center gap-2 font-bold text-xs transition-all duration-150 active:scale-[0.97] border ${
            isRecording
              ? 'bg-red-600/90 hover:bg-red-500 border-red-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.5)] animate-pulse'
              : 'bg-[#2a1e20] hover:bg-[#382326] border-red-900/60 text-red-400 hover:text-red-300'
          }`}
        >
          <Circle size={11} className={isRecording ? 'fill-white text-white' : 'fill-red-500 text-red-500'} />
          <span>{isRecording ? 'REC ●' : 'REC'}</span>
        </button>
      </div>

      {/* Middle: Time Display & Samplerate Badge */}
      <div className="flex items-center gap-3">
        <div className="flex items-baseline bg-[#121417] px-3.5 py-1 rounded-lg border border-[#2b2e35] shadow-inner font-mono tracking-wider">
          <span className="text-base font-bold text-white leading-none">
            {formatTime(currentTime)}
          </span>
          <span className="text-xs text-gray-500 mx-1.5 font-normal">/</span>
          <span className="text-xs text-gray-400 leading-none">
            {formatTime(totalDuration)}
          </span>
        </div>

        {/* Samplerate Badge */}
        <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#202328] border border-gray-700/60 text-[11px] text-gray-400 font-mono">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
          <span>{sampleRate / 1000} kHz</span>
          <span className="text-gray-600">·</span>
          <span>{bitDepth}</span>
        </div>
      </div>

      {/* Right: Audio Output Selector, Append Toggle & Master Volume */}
      <div className="flex items-center gap-3">
        {/* Append Mode Toggle */}
        <button
          onClick={onToggleAppendMode}
          title={
            isAppendMode
              ? 'Modus: Ans Audio-Ende anfügen (Klicken für Cursor-Modus)'
              : 'Modus: Ab aktueller Cursor-Position aufnehmen (Klicken für Append-Modus)'
          }
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-medium transition-all duration-150 active:scale-[0.97] ${
            isAppendMode
              ? 'bg-[#0078d7]/20 border-omega-accent text-blue-300'
              : 'bg-[#22252a] hover:bg-[#2b2f36] border-gray-700/70 text-gray-400 hover:text-gray-200'
          }`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-omega-accent"></span>
          <span>{isAppendMode ? 'Anfügen (Ende)' : 'Ab Cursor'}</span>
        </button>

        {/* Master Output Device Dropdown */}
        <div className="flex items-center gap-1 bg-[#16181b] px-2 py-0.5 rounded-lg border border-gray-700/60 text-xs">
          <Headphones size={13} className="text-omega-accent shrink-0" />
          <select
            value={selectedOutputDevice || 'default'}
            onChange={(e) => onOutputDeviceChange(e.target.value)}
            className="bg-transparent text-gray-300 text-[11px] py-1 px-1 border-none focus:outline-none max-w-[130px] truncate cursor-pointer"
            title="Master-Audioausgang wählen"
          >
            <option value="default">Systemstandard</option>
            {outputDevices.map((dev) => (
              <option key={dev.deviceId} value={dev.deviceId}>
                {dev.label}
              </option>
            ))}
          </select>
        </div>

        {/* Master Volume Slider & Mute Toggle */}
        <div className="flex items-center gap-1.5 bg-[#16181b] px-2.5 py-1 rounded-lg border border-gray-700/60">
          <button
            onClick={handleMuteToggle}
            className="text-gray-400 hover:text-white transition-colors"
            title={isMuted ? 'Stummschaltung aufheben' : 'Stummschalten'}
          >
            {isMuted || masterVolume === 0 ? (
              <VolumeX size={14} className="text-red-400" />
            ) : (
              <Volume2 size={14} />
            )}
          </button>
          <input
            type="range"
            min="0"
            max="1.5"
            step="0.01"
            value={isMuted ? 0 : masterVolume}
            onChange={(e) => {
              if (isMuted) setIsMuted(false)
              onMasterVolumeChange(parseFloat(e.target.value))
            }}
            className="w-16 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-omega-accent"
            title={`Master Volume: ${Math.round((isMuted ? 0 : masterVolume) * 100)}%`}
          />
          <span className="text-[10px] font-mono text-gray-400 w-7 text-right">
            {Math.round((isMuted ? 0 : masterVolume) * 100)}%
          </span>
        </div>
      </div>
    </div>
  )
}

export default TransportBar
