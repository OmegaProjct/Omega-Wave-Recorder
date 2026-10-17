/**
 * WaveformDrawer.ts
 * High-performance HTML5 Canvas Waveform and Oscilloscope Renderer.
 * 
 * Features:
 * - Mode 1 (Live Recording): Real-time Neon-Green (#00ff66) CRT oscilloscope trace
 *   pulsing dynamically with live audio amplitude (authentic classic Windows WAV recorder look).
 * - Mode 2 (Playback / Static Timeline): Crisp Omega-Blue (#0078d7) multi-region waveform,
 *   In/Out selection overlay (rgba(0,120,215,0.35)), and high-precision playhead cursor line.
 * - Retina / High-DPI support with automatic devicePixelRatio compensation.
 * - Cached min/max peak decimation for stutter-free 60fps performance on long recordings.
 */

import type { Region } from '../../../common/types'

export interface WaveformTheme {
  scopeBg: string
  scopeGrid: string
  scopeLive: string
  scopeWave: string
  scopeSelection: string
  playhead: string
}

export const DEFAULT_WAVEFORM_THEME: WaveformTheme = {
  scopeBg: '#0e1114',
  scopeGrid: '#1c2420',
  scopeLive: '#00ff66',
  scopeWave: '#0078d7',
  scopeSelection: 'rgba(0, 120, 215, 0.35)',
  playhead: '#38bdf8'
}

export interface PeakData {
  min: Float32Array
  max: Float32Array
}

export class WaveformDrawer {
  private static peakCache: WeakMap<AudioBuffer, Map<number, PeakData>> = new WeakMap()

  /**
   * Adjusts canvas resolution for crisp Retina/HiDPI displays.
   */
  public static resizeCanvasToDisplay(canvas: HTMLCanvasElement): { width: number; height: number; dpr: number } {
    const dpr = window.devicePixelRatio || 1
    const width = canvas.clientWidth || 300
    const height = canvas.clientHeight || 80

    const targetWidth = Math.floor(width * dpr)
    const targetHeight = Math.floor(height * dpr)

    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth
      canvas.height = targetHeight
    }

    return { width, height, dpr }
  }

  /**
   * Mode 1: Live Recording Oscilloscope.
   * Renders a glowing neon-green CRT beam pulsing with real-time audio chunk data.
   */
  public static drawLiveOscilloscope(
    canvas: HTMLCanvasElement,
    chunk: Float32Array | null,
    peakLinear: number = 0,
    isRecording: boolean = true,
    theme: WaveformTheme = DEFAULT_WAVEFORM_THEME
  ): void {
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { width, height, dpr } = this.resizeCanvasToDisplay(canvas)

    ctx.save()
    ctx.scale(dpr, dpr)

    // 1. Draw CRT Dark Background
    ctx.fillStyle = theme.scopeBg
    ctx.fillRect(0, 0, width, height)

    // 2. Draw CRT Grid Lines
    this.drawScopeGrid(ctx, width, height, theme.scopeGrid)

    const centerY = height / 2

    // 3. Oscilloscope Beam Glow Setup
    const glowIntensity = Math.min(18, 6 + peakLinear * 24)
    ctx.shadowColor = theme.scopeLive
    ctx.shadowBlur = glowIntensity
    ctx.strokeStyle = theme.scopeLive
    ctx.lineWidth = isRecording ? 2.0 : 1.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    ctx.beginPath()

    if (chunk && chunk.length > 0) {
      const step = Math.max(1, Math.floor(chunk.length / width))
      const pointsCount = Math.min(width, Math.floor(chunk.length / step))

      for (let i = 0; i < pointsCount; i++) {
        const sampleIdx = i * step
        const sample = chunk[sampleIdx] || 0
        const x = (i / pointsCount) * width
        // Amplitude scaling (allow up to 90% of half-height)
        const y = centerY - sample * (height * 0.44)

        if (i === 0) {
          ctx.moveTo(x, y)
        } else {
          ctx.lineTo(x, y)
        }
      }
    } else {
      // Resting center line with subtle analog jitter
      ctx.moveTo(0, centerY)
      const jitter = (Math.random() - 0.5) * 1.5
      ctx.lineTo(width, centerY + jitter)
    }

    ctx.stroke()

    // 4. Center Line Highlight
    ctx.shadowBlur = 0
    ctx.strokeStyle = 'rgba(0, 255, 102, 0.2)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, centerY)
    ctx.lineTo(width, centerY)
    ctx.stroke()

    ctx.restore()
  }

  /**
   * Mode 2: Static Timeline & Playback Waveform.
   * Renders the assembled regions in Omega-Blue (#0078d7), with In/Out selection and playhead.
   */
  public static drawTimelineWaveform(options: {
    canvas: HTMLCanvasElement
    regions: Region[]
    bufferResolver: (filePath: string) => AudioBuffer | null
    totalDuration: number
    playheadPos: number
    selectionRange?: { start: number; end: number } | null
    theme?: WaveformTheme
  }): void {
    const {
      canvas,
      regions,
      bufferResolver,
      totalDuration,
      playheadPos,
      selectionRange,
      theme = DEFAULT_WAVEFORM_THEME
    } = options

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { width, height, dpr } = this.resizeCanvasToDisplay(canvas)

    ctx.save()
    ctx.scale(dpr, dpr)

    // Background
    ctx.fillStyle = theme.scopeBg
    ctx.fillRect(0, 0, width, height)

    // Grid
    this.drawScopeGrid(ctx, width, height, theme.scopeGrid)

    const centerY = height / 2
    const safeDuration = Math.max(1.0, totalDuration)

    // Render each audio region
    for (const region of regions) {
      const buffer = region.file?.path ? bufferResolver(region.file.path) : null
      const regStartPx = (region.startPos / safeDuration) * width
      const regWidthPx = (region.duration / safeDuration) * width

      if (regWidthPx <= 0) continue

      // Subtle region background box
      ctx.fillStyle = 'rgba(0, 120, 215, 0.08)'
      ctx.fillRect(regStartPx, 0, regWidthPx, height)

      // Draw Region Waveform peaks if buffer exists
      if (buffer) {
        const peaks = this.getOrCreatePeaks(buffer, Math.max(10, Math.floor(regWidthPx)))
        this.renderPeakBars(ctx, peaks, regStartPx, regWidthPx, height, centerY, theme.scopeWave)
      } else {
        // Fallback placeholder waveform bar
        ctx.fillStyle = theme.scopeWave
        ctx.fillRect(regStartPx, centerY - 2, regWidthPx, 4)
      }

      // Region border divider line
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.4)'
      ctx.lineWidth = 1
      ctx.strokeRect(regStartPx, 0, regWidthPx, height)
    }

    // Render In/Out Selection Range
    if (selectionRange && selectionRange.end > selectionRange.start) {
      const selStartPx = (selectionRange.start / safeDuration) * width
      const selEndPx = (selectionRange.end / safeDuration) * width
      const selWidthPx = Math.max(1, selEndPx - selStartPx)

      ctx.fillStyle = theme.scopeSelection
      ctx.fillRect(selStartPx, 0, selWidthPx, height)

      // In/Out boundary lines
      ctx.strokeStyle = '#60a5fa'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(selStartPx, 0)
      ctx.lineTo(selStartPx, height)
      ctx.moveTo(selEndPx, 0)
      ctx.lineTo(selEndPx, height)
      ctx.stroke()
    }

    // Render Playhead Line
    const playheadPx = (playheadPos / safeDuration) * width
    if (playheadPx >= 0 && playheadPx <= width) {
      ctx.strokeStyle = theme.playhead
      ctx.lineWidth = 2
      ctx.shadowColor = theme.playhead
      ctx.shadowBlur = 4
      ctx.beginPath()
      ctx.moveTo(playheadPx, 0)
      ctx.lineTo(playheadPx, height)
      ctx.stroke()

      // Small cursor triangle on top
      ctx.fillStyle = theme.playhead
      ctx.beginPath()
      ctx.moveTo(playheadPx - 4, 0)
      ctx.lineTo(playheadPx + 4, 0)
      ctx.lineTo(playheadPx, 6)
      ctx.closePath()
      ctx.fill()
    }

    ctx.restore()
  }

  /**
   * Draws oscilloscope background grid with center horizontal axis.
   */
  private static drawScopeGrid(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    gridColor: string
  ): void {
    ctx.strokeStyle = gridColor
    ctx.lineWidth = 1

    const stepX = 40
    const stepY = 20

    ctx.beginPath()
    // Vertical grid ticks
    for (let x = 0; x <= width; x += stepX) {
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
    }
    // Horizontal grid ticks
    for (let y = 0; y <= height; y += stepY) {
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
    }
    ctx.stroke()

    // Stronger center horizontal baseline
    const centerY = height / 2
    ctx.strokeStyle = '#26332c'
    ctx.beginPath()
    ctx.moveTo(0, centerY)
    ctx.lineTo(width, centerY)
    ctx.stroke()
  }

  /**
   * Renders downsampled min/max peak bars with a clean gradient.
   */
  private static renderPeakBars(
    ctx: CanvasRenderingContext2D,
    peaks: PeakData,
    startX: number,
    renderWidth: number,
    height: number,
    centerY: number,
    waveColor: string
  ): void {
    const len = peaks.min.length
    if (len === 0) return

    ctx.fillStyle = waveColor
    const barWidth = Math.max(1, renderWidth / len)

    for (let i = 0; i < len; i++) {
      const minVal = peaks.min[i]
      const maxVal = peaks.max[i]

      const topY = centerY - maxVal * (height * 0.44)
      const bottomY = centerY - minVal * (height * 0.44)
      const barHeight = Math.max(1, bottomY - topY)
      const x = startX + (i / len) * renderWidth

      ctx.fillRect(x, topY, barWidth, barHeight)
    }
  }

  /**
   * Calculates or retrieves cached min/max peak arrays for an AudioBuffer.
   */
  public static getOrCreatePeaks(buffer: AudioBuffer, targetPixels: number): PeakData {
    let bufferMap = this.peakCache.get(buffer)
    if (!bufferMap) {
      bufferMap = new Map()
      this.peakCache.set(buffer, bufferMap)
    }

    const cached = bufferMap.get(targetPixels)
    if (cached) return cached

    const channelData = buffer.getChannelData(0)
    const totalSamples = channelData.length
    const samplesPerPixel = Math.max(1, Math.floor(totalSamples / targetPixels))
    const actualPixels = Math.min(targetPixels, Math.ceil(totalSamples / samplesPerPixel))

    const minArr = new Float32Array(actualPixels)
    const maxArr = new Float32Array(actualPixels)

    for (let p = 0; p < actualPixels; p++) {
      const start = p * samplesPerPixel
      const end = Math.min(totalSamples, start + samplesPerPixel)
      let min = 0
      let max = 0

      for (let s = start; s < end; s++) {
        const val = channelData[s]
        if (val < min) min = val
        if (val > max) max = val
      }

      minArr[p] = min
      maxArr[p] = max
    }

    const peakData: PeakData = { min: minArr, max: maxArr }
    bufferMap.set(targetPixels, peakData)
    return peakData
  }
}
