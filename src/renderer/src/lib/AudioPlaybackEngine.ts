/**
 * AudioPlaybackEngine.ts
 * Multi-Track Web Audio API Playback Engine for Omega Wave Recorder.
 * 
 * Features:
 * - Multi-track playback, pause, stop, and seek operations.
 * - Per-track volume gain nodes, solo, and mute routing.
 * - Anti-click gain ramping and micro-fade execution for cut transitions.
 * - Dynamic audio output routing via AudioContext.setSinkId(deviceId) with Chromium safeguards.
 * - AudioBuffer caching and high-precision playhead time tracking.
 */

import type { Track, Region } from '../../../common/types'

export type PlaybackState = 'stopped' | 'playing' | 'paused'

export interface TrackNodeGroup {
  trackGain: GainNode
  panner?: StereoPannerNode
  sources: { source: AudioBufferSourceNode; gainNode: GainNode }[]
}

export class AudioPlaybackEngine {
  private static instance: AudioPlaybackEngine | null = null

  private ctx: AudioContext | null = null
  private masterGain: GainNode | null = null
  private trackNodes: Map<string, TrackNodeGroup> = new Map()
  private bufferCache: Map<string, AudioBuffer> = new Map()

  private currentState: PlaybackState = 'stopped'
  private playheadPos: number = 0 // in seconds
  private contextStartTime: number = 0 // AudioContext.currentTime at playback start
  private activeDeviceId: string = 'default'
  private currentTracks: Track[] = []

  private rafId?: number
  private timeListeners: Set<(pos: number) => void> = new Set()
  private stateListeners: Set<(state: PlaybackState) => void> = new Set()

  public static getInstance(): AudioPlaybackEngine {
    if (!AudioPlaybackEngine.instance) {
      AudioPlaybackEngine.instance = new AudioPlaybackEngine()
    }
    return AudioPlaybackEngine.instance
  }

  constructor() {
    this.initContext()
  }

  private initContext(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext
      this.ctx = new AudioCtxClass({ latencyHint: 'interactive' })
      this.masterGain = this.ctx.createGain()
      this.masterGain.gain.value = 1.0
      this.masterGain.connect(this.ctx.destination)
    }
    return this.ctx
  }

  public getState(): PlaybackState {
    return this.currentState
  }

  public getPlayhead(): number {
    return this.playheadPos
  }

  /**
   * Sets the master playback volume (0.0 to 1.5).
   */
  public setMasterVolume(volume: number): void {
    if (!this.masterGain || !this.ctx) return
    const clamped = Math.max(0, Math.min(1.5, volume))
    this.masterGain.gain.setTargetAtTime(clamped, this.ctx.currentTime, 0.015)
  }

  /**
   * Routes the output to a specific audio hardware device (speakers, headphones).
   * Incorporates safety checks against Chromium's auto-resume behavior on setSinkId.
   */
  public async setOutputDevice(deviceId: string): Promise<boolean> {
    this.activeDeviceId = deviceId
    if (!this.ctx) return false

    try {
      if ((this.ctx as any).setSinkId) {
        const wasPlaying = this.currentState === 'playing'
        const stateBefore = this.ctx.state

        await (this.ctx as any).setSinkId(deviceId)

        // Chromium may inadvertently transition the AudioContext to 'running'
        // after setSinkId. Restore previous suspended state if playback was stopped/paused.
        if (!wasPlaying && this.ctx.state === 'running' && stateBefore !== 'running') {
          await this.ctx.suspend().catch(() => {})
        }
        return true
      }
    } catch (err) {
      console.warn('[AudioPlaybackEngine] Error setting sink ID:', err)
    }
    return false
  }

  public getActiveDeviceId(): string {
    return this.activeDeviceId
  }

  /**
   * Decodes and caches an audio buffer from a file path.
   */
  public async loadAudioBuffer(filePath: string): Promise<AudioBuffer | null> {
    if (this.bufferCache.has(filePath)) {
      return this.bufferCache.get(filePath)!
    }

    try {
      let arrayBuffer: ArrayBuffer
      if (window.api?.readFileBuffer) {
        arrayBuffer = await window.api.readFileBuffer(filePath)
      } else {
        const res = await fetch(filePath)
        arrayBuffer = await res.arrayBuffer()
      }

      const ctx = this.initContext()
      // Use slice(0) to prevent buffer detaching issues across Web Audio decoders
      const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0))
      this.bufferCache.set(filePath, decoded)
      return decoded
    } catch (err) {
      console.error(`[AudioPlaybackEngine] Failed to decode audio file ${filePath}:`, err)
      return null
    }
  }

  /**
   * Preloads all region audio files for the given tracks.
   */
  public async preloadTracks(tracks: Track[]): Promise<void> {
    const promises: Promise<any>[] = []
    for (const track of tracks) {
      for (const region of track.regions) {
        if (region.file?.path && !this.bufferCache.has(region.file.path)) {
          promises.push(this.loadAudioBuffer(region.file.path))
        }
      }
    }
    await Promise.all(promises)
  }

  /**
   * Prepares the gain node routing for a track.
   */
  private getOrCreateTrackNode(trackId: string): TrackNodeGroup {
    const ctx = this.initContext()
    let group = this.trackNodes.get(trackId)
    if (!group) {
      const trackGain = ctx.createGain()
      trackGain.gain.value = 1.0
      trackGain.connect(this.masterGain!)

      group = {
        trackGain,
        sources: []
      }
      this.trackNodes.set(trackId, group)
    }
    return group
  }

  /**
   * Updates solo, mute, and volume parameters across all tracks in real-time.
   */
  public updateRouting(tracks: Track[]): void {
    this.currentTracks = tracks
    if (!this.ctx) return

    const hasAnySolo = tracks.some((t) => t.solo)
    const currentTime = this.ctx.currentTime

    for (const track of tracks) {
      const group = this.getOrCreateTrackNode(track.id)

      let isAudible = false
      if (hasAnySolo) {
        isAudible = track.solo && !track.muted
      } else {
        isAudible = !track.muted
      }

      const targetGain = isAudible ? Math.max(0, Math.min(1.5, track.volume ?? 1.0)) : 0.0
      // Smooth anti-click gain transition (15ms time constant)
      group.trackGain.gain.setTargetAtTime(targetGain, currentTime, 0.015)
    }
  }

  /**
   * Calculate project total duration based on furthest region end.
   */
  public getTotalDuration(tracks: Track[]): number {
    let max = 0
    for (const track of tracks) {
      for (const r of track.regions) {
        const end = r.startPos + r.duration
        if (end > max) max = end
      }
    }
    return max
  }

  /**
   * Starts playback from playheadPos or current position.
   */
  public async play(tracks: Track[], fromPos?: number): Promise<void> {
    const ctx = this.initContext()
    if (ctx.state === 'suspended') {
      await ctx.resume()
    }

    // Stop any existing playing nodes
    this.stopSources()

    if (fromPos !== undefined) {
      this.playheadPos = Math.max(0, fromPos)
    }

    const totalDuration = this.getTotalDuration(tracks)
    if (totalDuration > 0 && this.playheadPos >= totalDuration) {
      this.playheadPos = 0
    }

    this.currentTracks = tracks
    this.updateRouting(tracks)

    const baseCtxTime = ctx.currentTime
    this.contextStartTime = baseCtxTime

    // Schedule audio nodes for all visible/unlocked tracks
    for (const track of tracks) {
      const group = this.getOrCreateTrackNode(track.id)

      for (const region of track.regions) {
        const regionStart = region.startPos
        const regionDuration = region.duration
        const regionEnd = regionStart + regionDuration

        // Skip if region is entirely before playhead
        if (regionEnd <= this.playheadPos) continue

        // Load buffer from cache
        const audioBuffer = region.file?.path ? this.bufferCache.get(region.file.path) : null
        if (!audioBuffer) continue

        let scheduleDelay = 0
        let bufferOffset = region.sourceOffset || 0
        let playDuration = regionDuration

        if (regionStart >= this.playheadPos) {
          // Region starts in the future relative to playhead
          scheduleDelay = regionStart - this.playheadPos
          bufferOffset = region.sourceOffset || 0
          playDuration = regionDuration
        } else {
          // Playhead is inside the region
          const offsetIntoRegion = this.playheadPos - regionStart
          scheduleDelay = 0
          bufferOffset = (region.sourceOffset || 0) + offsetIntoRegion
          playDuration = regionDuration - offsetIntoRegion
        }

        if (playDuration <= 0) continue

        // Create buffer source
        const source = ctx.createBufferSource()
        source.buffer = audioBuffer

        // Create region gain node (volume & micro-fades)
        const regionGain = ctx.createGain()
        const startTarget = region.gain !== undefined ? region.gain : 1.0
        regionGain.gain.setValueAtTime(startTarget, baseCtxTime + scheduleDelay)

        // Apply Micro-Fade-In (e.g. 3ms ripple cut micro-fade)
        const fadeIn = region.fadeIn || 0.003
        if (fadeIn > 0 && scheduleDelay > 0) {
          const fadeStart = baseCtxTime + scheduleDelay
          regionGain.gain.setValueAtTime(0.0001, fadeStart)
          regionGain.gain.exponentialRampToValueAtTime(Math.max(0.0001, startTarget), fadeStart + fadeIn)
        }

        // Apply Micro-Fade-Out
        const fadeOut = region.fadeOut || 0.003
        if (fadeOut > 0) {
          const fadeStart = baseCtxTime + scheduleDelay + playDuration - fadeOut
          if (fadeStart > baseCtxTime + scheduleDelay) {
            regionGain.gain.setValueAtTime(Math.max(0.0001, startTarget), fadeStart)
            regionGain.gain.exponentialRampToValueAtTime(0.0001, fadeStart + fadeOut)
          }
        }

        source.connect(regionGain)
        regionGain.connect(group.trackGain)

        const startWhen = baseCtxTime + scheduleDelay
        source.start(startWhen, bufferOffset, playDuration)

        group.sources.push({ source, gainNode: regionGain })
      }
    }

    this.currentState = 'playing'
    this.notifyStateChange('playing')
    this.startTrackingLoop(totalDuration)
  }

  /**
   * Pauses playback.
   */
  public pause(): void {
    if (this.currentState !== 'playing') return
    this.stopSources()
    this.currentState = 'paused'
    this.cancelTrackingLoop()
    this.notifyStateChange('paused')
  }

  /**
   * Stops playback and resets playhead to 0 or keeps playhead position.
   */
  public stop(resetPlayhead: boolean = false): void {
    this.stopSources()
    if (resetPlayhead) {
      this.playheadPos = 0
      this.notifyTimeUpdate(0)
    }
    this.currentState = 'stopped'
    this.cancelTrackingLoop()
    this.notifyStateChange('stopped')
  }

  /**
   * Seeks to a specific playhead timestamp.
   */
  public seek(position: number, tracks?: Track[]): void {
    const clamped = Math.max(0, position)
    this.playheadPos = clamped
    this.notifyTimeUpdate(clamped)

    if (this.currentState === 'playing') {
      const activeTracks = tracks || this.currentTracks
      this.play(activeTracks, clamped)
    }
  }

  /**
   * Disconnects and stops all active source nodes.
   */
  private stopSources(): void {
    for (const group of this.trackNodes.values()) {
      for (const item of group.sources) {
        try {
          item.source.stop()
          item.source.disconnect()
          item.gainNode.disconnect()
        } catch {
          // Ignore errors from already stopped nodes
        }
      }
      group.sources = []
    }
  }

  /**
   * Continuous high-precision playhead time tracking loop using requestAnimationFrame.
   */
  private startTrackingLoop(totalDuration: number): void {
    this.cancelTrackingLoop()

    const loop = () => {
      if (this.currentState !== 'playing' || !this.ctx) return

      const elapsed = this.ctx.currentTime - this.contextStartTime
      const currentPos = this.playheadPos + elapsed

      this.notifyTimeUpdate(currentPos)

      if (totalDuration > 0 && currentPos >= totalDuration) {
        // Reached end of audio
        this.stop(true)
        return
      }

      this.rafId = requestAnimationFrame(loop)
    }

    this.rafId = requestAnimationFrame(loop)
  }

  private cancelTrackingLoop(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = undefined
    }
  }

  public onTimeUpdate(callback: (pos: number) => void): () => void {
    this.timeListeners.add(callback)
    return () => this.timeListeners.delete(callback)
  }

  public onStateChange(callback: (state: PlaybackState) => void): () => void {
    this.stateListeners.add(callback)
    return () => this.stateListeners.delete(callback)
  }

  private notifyTimeUpdate(pos: number): void {
    for (const listener of this.timeListeners) {
      listener(pos)
    }
  }

  private notifyStateChange(state: PlaybackState): void {
    for (const listener of this.stateListeners) {
      listener(state)
    }
  }

  /**
   * Clear cached audio buffers to free memory.
   */
  public clearCache(): void {
    this.bufferCache.clear()
  }
}
