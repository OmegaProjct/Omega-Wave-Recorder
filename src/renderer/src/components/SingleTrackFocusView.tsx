import React, { useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Mic,
  Monitor,
  Volume2,
  VolumeX,
  Radio,
  Sliders,
  Check,
  Activity
} from 'lucide-react'
import type { Track, InputSource, LivePeak, AudioProcessInfo, Region } from '../../../common/types'

interface SingleTrackFocusViewProps {
  tracks: Track[]
  activeTrackIndex: number
  armedTrackIds: Set<string>
  isRecording: boolean
  isPlaying: boolean
  currentTime: number
  totalDuration: number
  livePeak?: LivePeak
  audioDevices: { deviceId: string; label: string }[]
  runningProcesses: AudioProcessInfo[]
  onSelectTrack: (index: number) => void
  onToggleArm: (trackId: string) => void
  onToggleMute: (trackId: string) => void
  onToggleSolo: (trackId: string) => void
  onVolumeChange: (trackId: string, volume: number) => void
  onInputChange: (trackId: string, input: InputSource) => void
  onSeek: (time: number) => void
}

function formatRetroTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) seconds = 0
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  const hundredths = Math.floor((seconds % 1) * 100)
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${hundredths.toString().padStart(2, '0')}`
}

export const SingleTrackFocusView: React.FC<SingleTrackFocusViewProps> = ({
  tracks,
  activeTrackIndex,
  armedTrackIds,
  isRecording,
  isPlaying,
  currentTime,
  totalDuration,
  livePeak = { peakL: 0, peakR: 0, peakLdBFS: -60, peakRdBFS: -60 },
  audioDevices,
  runningProcesses,
  onSelectTrack,
  onToggleArm,
  onToggleMute,
  onToggleSolo,
  onVolumeChange,
  onInputChange,
  onSeek
}) => {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const activeTrack = tracks[activeTrackIndex] || tracks[0]
  const isArmed = armedTrackIds.has(activeTrack?.id)

  // Draw Retro Oscilloscope Screen
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    const width = rect.width
    const height = rect.height

    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr
      canvas.height = height * dpr
    }

    ctx.save()
    ctx.scale(dpr, dpr)

    // 1. CRT Screen Background
    ctx.fillStyle = '#0e1114'
    ctx.fillRect(0, 0, width, height)

    // 2. Phosphor Grid Lines
    ctx.strokeStyle = '#1a241f'
    ctx.lineWidth = 1

    const gridCols = 16
    const gridRows = 8
    const stepX = width / gridCols
    const stepY = height / gridRows

    // Vertical grid lines
    for (let c = 0; c <= gridCols; c++) {
      ctx.beginPath()
      ctx.moveTo(c * stepX, 0)
      ctx.lineTo(c * stepX, height)
      ctx.stroke()
    }
    // Horizontal grid lines
    for (let r = 0; r <= gridRows; r++) {
      ctx.beginPath()
      ctx.moveTo(0, r * stepY)
      ctx.lineTo(width, r * stepY)
      ctx.stroke()
    }

    // 3. Center 0V Reference Axis (Dotted or highlighted)
    const centerY = height / 2
    ctx.strokeStyle = '#283830'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(0, centerY)
    ctx.lineTo(width, centerY)
    ctx.stroke()

    // 4. Waveform Signal Line
    const isLive = isRecording && isArmed
    const strokeColor = isLive ? '#00ff66' : '#0078d7'
    const glowColor = isLive ? 'rgba(0, 255, 102, 0.7)' : 'rgba(0, 120, 215, 0.5)'

    ctx.strokeStyle = strokeColor
    ctx.lineWidth = 3 // Thick retro line
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.shadowColor = glowColor
    ctx.shadowBlur = 8

    ctx.beginPath()

    if (isLive) {
      // Live dynamic oscilloscope audio trace
      const currentPeak = Math.max(0.05, livePeak.peakL, livePeak.peakR)
      const maxAmp = (height / 2) * 0.85
      const points = 120

      for (let i = 0; i <= points; i++) {
        const x = (i / points) * width
        const phase = (i / points) * Math.PI * 8 + currentTime * 12
        const harmonic = Math.sin(phase * 1.5) * 0.3
        const yOffset = (Math.sin(phase) + harmonic) * currentPeak * maxAmp * (activeTrack?.volume || 1.0)
        const y = centerY + yOffset

        if (i === 0) {
          ctx.moveTo(x, y)
        } else {
          ctx.lineTo(x, y)
        }
      }
      ctx.stroke()
    } else {
      // Static / Playback Waveform of active track
      const regions = activeTrack?.regions || []
      const trackDuration = Math.max(totalDuration, 1.0)
      const points = 240
      const maxAmp = (height / 2) * 0.75

      for (let i = 0; i <= points; i++) {
        const x = (i / points) * width
        const timeAtPoint = (i / points) * trackDuration

        // Find if any region covers this point
        const region = regions.find(
          (r: Region) => timeAtPoint >= r.startPos && timeAtPoint <= r.startPos + r.duration
        )

        let amp = 0
        if (region) {
          const relX = timeAtPoint - region.startPos
          const seed = Math.sin(relX * 12) * Math.cos(relX * 24)
          amp = Math.abs(seed) * (region.gain || 1.0) * (activeTrack?.volume || 1.0) * maxAmp
        }

        // Draw upper and lower connected wave
        const yOffset = Math.sin(i * 0.4) * amp
        const y = centerY + (i % 2 === 0 ? yOffset : -yOffset)

        if (i === 0) {
          ctx.moveTo(x, centerY)
        } else {
          ctx.lineTo(x, y)
        }
      }
      ctx.stroke()

      // Playhead Indicator
      if (totalDuration > 0) {
        const playheadX = (currentTime / totalDuration) * width
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 2
        ctx.shadowColor = 'rgba(255, 255, 255, 0.8)'
        ctx.shadowBlur = 6
        ctx.beginPath()
        ctx.moveTo(playheadX, 0)
        ctx.lineTo(playheadX, height)
        ctx.stroke()
      }
    }

    ctx.restore()
  }, [
    activeTrack,
    isRecording,
    isPlaying,
    currentTime,
    totalDuration,
    livePeak,
    isArmed
  ])

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || totalDuration <= 0) return
    const rect = canvasRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const percent = Math.max(0, Math.min(1, x / rect.width))
    onSeek(percent * totalDuration)
  }

  return (
    <div className="flex-1 flex flex-col bg-[#16181b] p-3 overflow-hidden select-none">
      {/* Top Track Selector Tabs (1 - 4) */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-mono text-gray-400 mr-1 flex items-center gap-1">
            <Activity size={13} className="text-omega-accent" />
            {t('track.focus_title', 'Spur Fokus:')}
          </span>
          {tracks.map((tTrack, idx) => {
            const isSelected = idx === activeTrackIndex
            const isTrackArmed = armedTrackIds.has(tTrack.id)
            return (
              <button
                key={tTrack.id}
                onClick={() => onSelectTrack(idx)}
                className={`px-3 py-1 rounded-md text-xs font-bold border transition-all duration-150 active:scale-[0.97] flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-omega-accent border-omega-accent text-white shadow-[0_0_10px_rgba(0,120,215,0.4)]'
                    : 'bg-[#202328] hover:bg-[#2b2f36] border-gray-700/60 text-gray-400 hover:text-white'
                }`}
              >
                <span>{tTrack.name || `${t('track.track', 'Spur')} ${idx + 1}`}</span>
                {isTrackArmed && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />}
              </button>
            )
          })}
        </div>

        {/* Status Indicator */}
        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="px-2 py-0.5 rounded bg-[#101c15] border border-emerald-900/60 text-emerald-400 text-[10px] font-bold tracking-wider">
            {isRecording && isArmed
              ? t('track.live_rec', '● LIVE REC')
              : isPlaying
              ? t('track.play_active', '▶ PLAY')
              : t('track.ready', 'BEREIT')}
          </span>
          <span className="text-gray-400 text-xs font-mono">
            {formatRetroTime(currentTime)} / {formatRetroTime(totalDuration)}
          </span>
        </div>
      </div>

      {/* Main Large Retro CRT Oscilloscope Display */}
      <div
        ref={containerRef}
        className="flex-1 w-full relative rounded-xl border border-[#2b3a30] shadow-2xl overflow-hidden bg-[#0e1114] flex flex-col"
      >
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          className="w-full h-full cursor-pointer block"
        />

        {/* Corner Retro Badges */}
        <div className="absolute top-2 left-3 font-mono text-[10px] text-emerald-500/80 pointer-events-none select-none tracking-widest">
          OSCILLOSCOPE // CH {activeTrackIndex + 1} // {activeTrack?.name}
        </div>
        <div className="absolute bottom-2 right-3 font-mono text-[10px] text-emerald-500/80 pointer-events-none select-none tracking-widest">
          48 kHz · 24-BIT STUDIO PCM
        </div>
      </div>

      {/* Active Track Controls Bar underneath */}
      <div className="mt-2.5 bg-[#202328] border border-gray-700/60 rounded-xl px-4 py-2 flex items-center justify-between text-xs">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-white">{activeTrack?.name}</span>

          {/* Input Indicator */}
          <span className="px-2 py-0.5 rounded bg-[#16181b] border border-gray-700/60 text-[11px] text-gray-300 flex items-center gap-1.5">
            {activeTrack?.inputSource?.type === 'process' ? (
              <>
                <Monitor size={12} className="text-emerald-400" />
                <span>{activeTrack?.inputSource?.label || activeTrack?.inputSource?.name}</span>
              </>
            ) : (
              <>
                <Mic size={12} className="text-omega-accent" />
                <span>{activeTrack?.inputSource?.label || 'Mikrofon (Hardware)'}</span>
              </>
            )}
          </span>
        </div>

        {/* Arm, Mute, Solo, Volume */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => onToggleArm(activeTrack.id)}
            className={`px-3 py-1 rounded text-xs font-bold border transition-all active:scale-[0.97] ${
              isArmed
                ? 'bg-red-600 border-red-500 text-white shadow-[0_0_8px_rgba(239,68,68,0.5)]'
                : 'bg-[#181a1e] border-gray-700 text-gray-400'
            }`}
          >
            [● R] {t('track.arm', 'Arm')}
          </button>
          <button
            onClick={() => onToggleMute(activeTrack.id)}
            className={`px-3 py-1 rounded text-xs font-bold border transition-all active:scale-[0.97] ${
              activeTrack?.muted
                ? 'bg-amber-600 border-amber-500 text-white'
                : 'bg-[#181a1e] border-gray-700 text-gray-400'
            }`}
          >
            [M] {t('track.mute', 'Mute')}
          </button>
          <button
            onClick={() => onToggleSolo(activeTrack.id)}
            className={`px-3 py-1 rounded text-xs font-bold border transition-all active:scale-[0.97] ${
              activeTrack?.solo
                ? 'bg-omega-accent border-omega-accent text-white'
                : 'bg-[#181a1e] border-gray-700 text-gray-400'
            }`}
          >
            [S] {t('track.solo', 'Solo')}
          </button>

          {/* Volume Slider */}
          <div className="flex items-center gap-2 ml-2">
            <Volume2 size={14} className="text-gray-400" />
            <input
              type="range"
              min="0"
              max="1.5"
              step="0.01"
              value={activeTrack?.volume || 1.0}
              onChange={(e) => onVolumeChange(activeTrack.id, parseFloat(e.target.value))}
              className="w-20 h-1.5 bg-[#121417] rounded-lg cursor-pointer accent-omega-accent"
            />
            <span className="font-mono text-[10px] text-gray-400 w-8 text-right">
              {Math.round((activeTrack?.volume || 1.0) * 100)}%
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SingleTrackFocusView
