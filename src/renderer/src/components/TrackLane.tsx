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
  recordStartPos?: number
  liveRecordedPeaks?: number[]
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
  recordStartPos = 0,
  liveRecordedPeaks = [],
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
  const laneHeight = track.height || 74

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
    ctx.strokeStyle = '#20242a'
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

        if (regWidth <= 0) return

        // Region background container
        ctx.fillStyle = 'rgba(0, 120, 215, 0.12)'
        ctx.fillRect(regStartX, 3, regWidth, height - 6)

        ctx.strokeStyle = '#1e3a5f'
        ctx.lineWidth = 1
        ctx.strokeRect(regStartX, 3, regWidth, height - 6)

        // Waveform styling - Crisp Omega-Blue
        ctx.fillStyle = '#0078d7'
        ctx.strokeStyle = '#0078d7'
        ctx.lineWidth = 1.5

        const sampleStep = 2 // 2px per bar
        const maxAmp = (height / 2) - 6

        ctx.beginPath()
        const peaks = region.peaks as number[] | undefined

        if (peaks && peaks.length > 0) {
          const totalBars = Math.floor(regWidth / sampleStep)
          for (let b = 0; b < totalBars; b++) {
            const peakIdx = Math.floor((b / totalBars) * peaks.length)
            const p = Math.min(1.0, (peaks[peakIdx] || 0) * (region.gain || 1.0) * (track.volume ?? 1.0))
            const barAmp = Math.max(2, p * maxAmp)
            const x = regStartX + b * sampleStep

            ctx.moveTo(x, centerY - barAmp)
            ctx.lineTo(x, centerY + barAmp)
          }
        } else {
          // Fallback realistic waveform contour
          for (let x = 0; x < regWidth; x += sampleStep) {
            const globalX = regStartX + x
            const harmonic = Math.sin((globalX + rIdx * 80) * 0.12) * Math.cos((globalX + rIdx * 40) * 0.06)
            const noise = Math.sin(globalX * 0.4) * 0.25
            const p = Math.min(1.0, Math.abs(harmonic + noise) * (region.gain || 1.0) * (track.volume ?? 1.0))
            const barAmp = Math.max(2, p * maxAmp)

            ctx.moveTo(globalX, centerY - barAmp)
            ctx.lineTo(globalX, centerY + barAmp)
          }
        }
        ctx.stroke()

        // Region label
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)'
        ctx.font = '10px sans-serif'
        ctx.fillText(region.name || `Take ${rIdx + 1}`, regStartX + 5, 14)
      })
    }

    // If Track is Actively Recording: Draw real growing take anchored at recordStartPos
    if (isRecording && isArmed) {
      const recStartX = recordStartPos * pixelsPerSecond
      const recEndX = currentTime * pixelsPerSecond
      const recWidth = Math.max(0, recEndX - recStartX)

      if (recWidth > 0) {
        // Live recording container glow
        ctx.fillStyle = 'rgba(239, 68, 68, 0.1)'
        ctx.fillRect(recStartX, 2, recWidth, height - 4)

        ctx.strokeStyle = '#ef4444'
        ctx.lineWidth = 1
        ctx.strokeRect(recStartX, 2, recWidth, height - 4)

        // Live waveform in bright neon green (#00ff66)
        ctx.strokeStyle = '#00ff66'
        ctx.lineWidth = 2
        ctx.shadowColor = 'rgba(0, 255, 102, 0.5)'
        ctx.shadowBlur = 4

        const liveStep = 2
        const maxLiveAmp = (height / 2) - 8
        const totalLiveBars = Math.floor(recWidth / liveStep)

        ctx.beginPath()
        if (liveRecordedPeaks && liveRecordedPeaks.length > 0) {
          for (let b = 0; b < totalLiveBars; b++) {
            const peakIdx = Math.floor((b / totalLiveBars) * liveRecordedPeaks.length)
            const p = Math.min(1.0, (liveRecordedPeaks[peakIdx] || 0) * (track.volume ?? 1.0))
            const barAmp = Math.max(2, p * maxLiveAmp)
            const x = recStartX + b * liveStep

            ctx.moveTo(x, centerY - barAmp)
            ctx.lineTo(x, centerY + barAmp)
          }
        } else {
          const currentPeak = livePeak ? Math.max(livePeak.peakL, livePeak.peakR) : 0.4
          for (let x = recStartX; x <= recEndX; x += liveStep) {
            const noise = (Math.sin(x * 0.3) + Math.cos(x * 0.15)) * 0.5
            const amp = Math.max(2, Math.abs(noise * currentPeak * maxLiveAmp))
            ctx.moveTo(x, centerY - amp)
            ctx.lineTo(x, centerY + amp)
          }
        }
        ctx.stroke()
        ctx.shadowBlur = 0 // reset shadow
      }
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
    ctx.strokeStyle = isRecording ? '#ef4444' : '#0078d7'
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
    recordStartPos,
    liveRecordedPeaks,
    pixelsPerSecond,
    selection,
    livePeak,
    effectiveDuration,
    laneWidth,
    laneHeight
  ])

  // Mouse selection & scrub handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const container = laneContainerRef.current
    if (!container) return

    const rect = container.getBoundingClientRect()
    const clickX = e.clientX - rect.left + container.scrollLeft
    const timeAtClick = Math.max(0, clickX / pixelsPerSecond)

    setIsDragging(true)
    setDragStartPos(timeAtClick)
    onSeek(timeAtClick)
    onSelectRange(null)
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging || dragStartPos === null) return
    const container = laneContainerRef.current
    if (!container) return

    const rect = container.getBoundingClientRect()
    const currentX = e.clientX - rect.left + container.scrollLeft
    const timeAtCurrent = Math.max(0, currentX / pixelsPerSecond)

    onSelectRange({
      start: Math.min(dragStartPos, timeAtCurrent),
      end: Math.max(dragStartPos, timeAtCurrent)
    })
  }

  const handleMouseUp = () => {
    setIsDragging(false)
    setDragStartPos(null)
  }

  return (
    <div className="flex border-b border-[#2d3036] bg-[#141619] hover:bg-[#181a1d] transition-colors relative h-[74px]">
      {/* Fixed Track Header on Left */}
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

      {/* Scrollable Waveform Canvas Lane */}
      <div
        ref={laneContainerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        className="flex-1 overflow-x-hidden relative cursor-crosshair select-none"
        style={{ height: `${laneHeight}px` }}
      >
        <canvas
          ref={canvasRef}
          style={{ width: `${laneWidth}px`, height: `${laneHeight}px` }}
          className="block"
        />

        {/* Empty Track Placeholder message if no regions and not recording */}
        {(!track.regions || track.regions.length === 0) && !isRecording && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-gray-700 font-medium text-[11px] tracking-wide select-none">
            Keine Aufnahmen auf dieser Spur
          </div>
        )}
      </div>
    </div>
  )
}

export default TrackLane
