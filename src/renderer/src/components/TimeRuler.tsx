import React, { useRef, useState, useEffect, useCallback } from 'react'

interface TimeRulerProps {
  totalDuration: number
  currentTime: number
  selection: { start: number; end: number } | null
  pixelsPerSecond?: number
  scrollLeft?: number
  onSeek: (time: number) => void
  onSelectRange: (range: { start: number; end: number } | null) => void
}

function formatRulerTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  const tenths = Math.floor((seconds % 1) * 10)
  if (seconds < 60) {
    return `${secs}.${tenths}s`
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export const TimeRuler: React.FC<TimeRulerProps> = ({
  totalDuration,
  currentTime,
  selection,
  pixelsPerSecond = 50,
  scrollLeft = 0,
  onSeek,
  onSelectRange
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragStartPos, setDragStartPos] = useState<number | null>(null)

  // Ensure minimum duration visible
  const effectiveDuration = Math.max(totalDuration, 30)
  const rulerWidth = Math.max(800, effectiveDuration * pixelsPerSecond)

  // Calculate ticks
  const calculateTickInterval = () => {
    if (pixelsPerSecond >= 100) return 1 // Every second
    if (pixelsPerSecond >= 40) return 2 // Every 2 seconds
    if (pixelsPerSecond >= 20) return 5 // Every 5 seconds
    return 10 // Every 10 seconds
  }

  const majorInterval = calculateTickInterval()
  const minorInterval = majorInterval / 5

  const ticks: { time: number; isMajor: boolean; label?: string }[] = []
  for (let t = 0; t <= effectiveDuration; t += minorInterval) {
    const isMajor = Math.abs(t % majorInterval) < 0.001
    ticks.push({
      time: t,
      isMajor,
      label: isMajor ? formatRulerTime(t) : undefined
    })
  }

  const getTimeFromEvent = useCallback(
    (clientX: number): number => {
      if (!containerRef.current) return 0
      const rect = containerRef.current.getBoundingClientRect()
      const x = clientX - rect.left + scrollLeft
      const time = Math.max(0, x / pixelsPerSecond)
      return time
    },
    [pixelsPerSecond, scrollLeft]
  )

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // Left click only
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

  const handleDoubleClick = () => {
    onSelectRange(null)
  }

  const playheadX = currentTime * pixelsPerSecond
  const selStartX = selection ? Math.min(selection.start, selection.end) * pixelsPerSecond : 0
  const selEndX = selection ? Math.max(selection.start, selection.end) * pixelsPerSecond : 0
  const selWidth = selEndX - selStartX

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      className="h-7 w-full bg-[#181a1e] border-b border-[#2d3036] relative select-none cursor-pointer overflow-hidden text-[10px] font-mono text-gray-400"
      title="Klick: Playhead setzen | Ziehen: Bereich markieren | Doppelklick: Markierung aufheben"
    >
      <div
        className="h-full relative pointer-events-none"
        style={{
          width: `${rulerWidth}px`,
          transform: `translateX(-${scrollLeft}px)`
        }}
      >
        {/* Selection Highlight in Ruler */}
        {selection && selWidth > 0 && (
          <div
            className="absolute top-0 bottom-0 bg-[#0078d7]/30 border-x border-[#0078d7] z-10"
            style={{
              left: `${selStartX}px`,
              width: `${selWidth}px`
            }}
          >
            {/* Selection range labels */}
            <span className="absolute left-1 top-0.5 text-[9px] text-blue-300 font-sans font-medium">
              In: {selection.start.toFixed(2)}s
            </span>
            <span className="absolute right-1 top-0.5 text-[9px] text-blue-300 font-sans font-medium">
              Out: {selection.end.toFixed(2)}s
            </span>
          </div>
        )}

        {/* Ticks and Labels */}
        {ticks.map((tick, index) => {
          const x = tick.time * pixelsPerSecond
          return (
            <div
              key={index}
              className="absolute top-0 flex flex-col items-start"
              style={{ left: `${x}px` }}
            >
              {tick.isMajor ? (
                <>
                  <div className="h-3 w-px bg-gray-500" />
                  <span className="text-[9px] text-gray-400 -translate-x-1/2 mt-0.5 select-none">
                    {tick.label}
                  </span>
                </>
              ) : (
                <div className="h-1.5 w-px bg-gray-700 mt-1.5" />
              )}
            </div>
          )
        })}

        {/* Playhead Scrubber Triangle */}
        <div
          className="absolute top-0 z-30 -translate-x-1/2 flex flex-col items-center pointer-events-none"
          style={{ left: `${playheadX}px` }}
        >
          {/* Top triangle */}
          <div className="w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[7px] border-t-omega-accent" />
          {/* Vertical indicator line into ruler */}
          <div className="w-0.5 h-6 bg-omega-accent shadow-[0_0_8px_rgba(0,120,215,0.8)]" />
        </div>
      </div>
    </div>
  )
}

export default TimeRuler
