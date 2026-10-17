import React, { useRef, useEffect, useState, useCallback } from 'react'
import TrackHeader from './TrackHeader'
import type { Track, InputSource, LivePeak, AudioProcessInfo, Region } from '../../../common/types'

interface TrackLaneProps {
  track: Track
  isArmed: boolean
  isRecording: boolean
  isPlaying: boolean
  currentTime: number
  totalDuration: number
  pixelsPerSecond?: number
  scrollLeft?: number
  selection: { start: number; end: number } | null
  livePeak?: LivePeak
  audioDevices: { deviceId: string; label: string }[]
  runningProcesses: AudioProcessInfo[]
  onToggleArm: () => void
  onToggleMute: () => void
  onToggleSolo: () => void
  onVolumeChange: (volume: number) => void
  onInputChange: (input: InputSource) => void
  onRenameTrack: (newName: string) => void
  onSeek: (time: number) => void
  onSelectRange: (range: { start: number; end: number } | null) => void
  onRefreshProcesses?: () => void
}

export const TrackLane: React.FC<TrackLaneProps> = ({
  track,
  isArmed,
  isRecording,
  isPlaying,
  currentTime,
  totalDuration,
  pixelsPerSecond = 50,
  scrollLeft = 0,
  selection,
  livePeak,
  audioDevices,
  runningProcesses,
  onToggleArm,
  onToggleMute,
  onToggleSolo,
  onVolumeChange,
  onInputChange,
  onRenameTrack,
  onSeek,
  onSelectRange,
  onRefreshProcesses
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const laneContainerRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragStartPos, setDragStartPos] = useState<number | null>(null)

  const effectiveDuration = Math.max(totalDuration, 30)
  const laneWidth = Math.max(800, effectiveDuration * pixelsPerSecond)
  const laneHeight = track.height || 100

  // Draw Waveform Canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const width = laneWidth
    const height = laneHeight

    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr
      canvas.height = height * dpr
    }

    ctx.save()
    ctx.scale(dpr, dpr)

    // Clear background
    ctx.fillStyle = '#141619'
    ctx.fillRect(0, 0, width, height)

    // Center baseline
    const centerY = height / 2
    ctx.strokeStyle = '#22262c'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, centerY)
    ctx.lineTo(width, centerY)
    ctx.stroke()

    // Draw Subtle Vertical Second Ticks
    ctx.strokeStyle = '#1a1d22'
    for (let t = 0; t <= effectiveDuration; t += 1) {
      const x = t * pixelsPerSecond
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
      ctx.stroke()
    }

    // Draw Track Regions (Waveforms)
    if (track.regions && track.regions.length > 0) {
      track.regions.forEach((region: Region, rIdx: number) => {
        const regStartX = region.startPos * pixelsPerSecond
        const regWidth = region.duration * pixelsPerSecond

        // Region background container
        ctx.fillStyle = 'rgba(0, 120, 215, 0.08)'
        ctx.fillRect(regStartX, 4, regWidth, height - 8)

        ctx.strokeStyle = '#284566'
        ctx.lineWidth = 1
        ctx.strokeRect(regStartX, 4, regWidth, height - 8)

        // Waveform styling
        ctx.fillStyle = '#0078d7'
        ctx.strokeStyle = '#0078d7'
        ctx.lineWidth = 1.5

        // Generate synthetic or cached visual peaks for aesthetic representation
        const sampleStep = 3 // every 3px
        const maxAmp = (height / 2) - 8

        ctx.beginPath()
        for (let x = 0; x < regWidth; x += sampleStep) {
          const globalX = regStartX + x
          // Deterministic pseudorandom audio waveform based on region & position
          const seed = Math.sin((globalX + rIdx * 100) * 0.1) * Math.cos((globalX + rIdx * 50) * 0.05)
          const amp = Math.min(1.0, Math.abs(seed) * (region.gain || 1.0) * track.volume) * maxAmp

          ctx.moveTo(globalX, centerY - amp)
          ctx.lineTo(globalX, centerY + amp)
        }
        ctx.stroke()

        // Region label
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
        ctx.font = '10px sans-serif'
        ctx.fillText(region.name || `Take ${rIdx + 1}`, regStartX + 6, 16)
      })
    }

    // If Track is Actively Recording: Draw Neon-Green Live Oscilloscope
    if (isRecording && isArmed) {
      const recHeadX = currentTime * pixelsPerSecond
      const liveWindowSec = 4.0 // Show 4 seconds of live tail
      const liveStartX = Math.max(0, recHeadX - liveWindowSec * pixelsPerSecond)
      const liveWidth = recHeadX - liveStartX

      // Live recording background glow
      ctx.fillStyle = 'rgba(0, 255, 102, 0.06)'
      ctx.fillRect(liveStartX, 4, liveWidth, height - 8)

      // Live waveform neon green
      ctx.strokeStyle = '#00ff66'
      ctx.lineWidth = 2
      ctx.shadowColor = 'rgba(0, 255, 102, 0.6)'
      ctx.shadowBlur = 6

      const liveStep = 2
      const maxLiveAmp = (height / 2) - 10
      const currentPeak = livePeak ? Math.max(livePeak.peakL, livePeak.peakR) : 0.5

      ctx.beginPath()
      for (let x = liveStartX; x <= recHeadX; x += liveStep) {
        const noise = (Math.sin(x * 0.3) + Math.cos(x * 0.15)) * 0.5
        const amp = (noise * currentPeak * maxLiveAmp)
        ctx.moveTo(x, centerY - Math.abs(amp))
        ctx.lineTo(x, centerY + Math.abs(amp))
      }
      ctx.stroke()
      ctx.shadowBlur = 0 // reset shadow
    }

    // In/Out Selection Highlight on this Track
    if (selection) {
      const selStartX = Math.min(selection.start, selection.end) * pixelsPerSecond
      const selEndX = Math.max(selection.start, selection.end) * pixelsPerSecond
      const selWidth = selEndX - selStartX

      if (selWidth > 0) {
        ctx.fillStyle = 'rgba(0, 120, 215, 0.25)'
        ctx.fillRect(selStartX, 0, selWidth, height)

        ctx.strokeStyle = '#0078d7'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(selStartX, 0)
        ctx.lineTo(selStartX, height)
        ctx.moveTo(selEndX, 0)
        ctx.lineTo(selEndX, height)
        ctx.stroke()
      }
    }

    // Playhead Line across this track
    const playheadX = currentTime * pixelsPerSecond
    ctx.strokeStyle = '#0078d7'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(playheadX, 0)
    ctx.lineTo(playheadX, height)
    ctx.stroke()

    ctx.restore()
  }, [
    track,
    isArmed,
    isRecording,
    currentTime,
    totalDuration,
    pixelsPerSecond,
    selection,
    livePeak,
    effectiveDuration,
    laneWidth,
    laneHeight
  ])

  const getTimeFromEvent = useCallback(
    (clientX: number): number => {
      if (!laneContainerRef.current) return 0
      const rect = laneContainerRef.current.getBoundingClientRect()
      const x = clientX - rect.left + scrollLeft
      return Math.max(0, x / pixelsPerSecond)
    },
    [pixelsPerSecond, scrollLeft]
  )

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const clickTime = getTimeFromEvent(e.clientX)
    setDragStartPos(clickTime)
    setIsDragging(true)
    onSeek(clickTime)
  }

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || dragStartPos === null) return
      const curTime = getTimeFromEvent(e.clientX)
      const start = Math.min(dragStartPos, curTime)
      const end = Math.max(dragStartPos, curTime)

      if (Math.abs(end - start) > 0.05) {
        onSelectRange({ start, end })
      } else {
        onSelectRange(null)
      }
    },
    [isDragging, dragStartPos, getTimeFromEvent, onSelectRange]
  )

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
    setDragStartPos(null)
  }, [])

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  return (
    <div
      className="flex border-b border-[#2d3036] hover:bg-[#181a1d] transition-colors overflow-hidden shrink-0"
      style={{ height: `${laneHeight}px` }}
    >
      {/* Left: Track Header with Controls & Input */}
      <TrackHeader
        track={track}
        isArmed={isArmed}
        isRecording={isRecording}
        livePeak={livePeak}
        audioDevices={audioDevices}
        runningProcesses={runningProcesses}
        onToggleArm={onToggleArm}
        onToggleMute={onToggleMute}
        onToggleSolo={onToggleSolo}
        onVolumeChange={onVolumeChange}
        onInputChange={onInputChange}
        onRenameTrack={onRenameTrack}
        onRefreshProcesses={onRefreshProcesses}
      />

      {/* Right: Waveform Lane Canvas */}
      <div
        ref={laneContainerRef}
        onMouseDown={handleMouseDown}
        onDoubleClick={() => onSelectRange(null)}
        className="flex-1 relative cursor-crosshair overflow-hidden bg-[#141619]"
      >
        <canvas
          ref={canvasRef}
          style={{
            width: `${laneWidth}px`,
            height: `${laneHeight}px`,
            transform: `translateX(-${scrollLeft}px)`
          }}
          className="pointer-events-none block"
        />

        {/* Empty state hint when no audio and not recording */}
        {(!track.regions || track.regions.length === 0) && !isRecording && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-gray-600 text-xs font-mono">
            Keine Aufnahmen auf dieser Spur
          </div>
        )}
      </div>
    </div>
  )
}

export default TrackLane
