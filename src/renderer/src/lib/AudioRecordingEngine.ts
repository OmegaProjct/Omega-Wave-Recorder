/**
 * AudioRecordingEngine.ts
 * High-performance Multi-Track Audio Recording Engine for Omega Wave Recorder.
 * 
 * Features:
 * - Hardware capture (Microphone/Line-In) via AudioWorklet with Float32Array chunks.
 * - Application loopback capture via WASAPI process IPC ('loopback-chunk').
 * - Real-time L/R peak calculation (-60 to 0 dBFS) with decay for VU meters.
 * - Direct Disk Streaming: Stream chunks to disk during recording to prevent RAM overflow.
 * - Clean start, pause, resume, and stop operations for multi-track takes.
 */

import type { InputSource, LivePeak, LoopbackChunkEvent } from '../../../common/types'

export interface RecordingTrackConfig {
  trackId: string
  inputSource: InputSource
  tempFilePath: string
}

export interface RecordingResult {
  trackId: string
  filePath: string
  duration: number
  sampleRate: number
  totalSamples: number
  channels: number
  peaks?: number[]
}

interface ActiveSession {
  trackId: string
  inputSource: InputSource
  tempFilePath: string
  sampleRate: number
  channels: number
  stream?: MediaStream
  sourceNode?: MediaStreamAudioSourceNode
  workletNode?: AudioWorkletNode
  silentGain?: GainNode
  totalSamples: number
  unwrittenL: Float32Array[]
  unwrittenR: Float32Array[]
  unwrittenSamples: number
  recordedPeaks: number[]
  peakL: number
  peakR: number
  peakLdBFS: number
  peakRdBFS: number
  lastPeakUpdate: number
  writeQueue: Promise<void>
  pendingSamples: number
}

// Falloff / decay rate for peaks (dB per millisecond)
const PEAK_DECAY_DB_PER_MS = 0.05

export class AudioRecordingEngine {
  private static instance: AudioRecordingEngine | null = null

  private audioCtx: AudioContext | null = null
  private workletLoaded: boolean = false
  private isRecordingState: boolean = false
  private isPausedState: boolean = false
  private isStartingState: boolean = false
  private isStoppingState: boolean = false
  private activeStopPromise: Promise<RecordingResult[]> | null = null

  private startTime: number = 0
  private pauseTime: number = 0
  private totalPausedDuration: number = 0

  private sessions: Map<string, ActiveSession> = new Map()
  private loopbackCleanup?: () => void
  private recordingError: Error | null = null
  private errorListeners = new Set<(error: Error) => void>()

  private peakListeners: Set<(peaks: Record<string, LivePeak>) => void> = new Set()
  private chunkListeners: Set<(trackId: string, left: Float32Array, right: Float32Array) => void> = new Set()
  private peakIntervalId?: number

  public static getInstance(): AudioRecordingEngine {
    if (!AudioRecordingEngine.instance) {
      AudioRecordingEngine.instance = new AudioRecordingEngine()
    }
    return AudioRecordingEngine.instance
  }

  constructor() {
    this.startPeakDecayLoop()
  }

  /**
   * Helper: Convert linear amplitude (0.0 to 1.0) to dBFS (-60 to 0 dBFS)
   */
  public static linearToDbFS(linear: number): number {
    if (linear <= 0.001) return -60.0
    const db = 20 * Math.log10(linear)
    return Math.max(-60.0, Math.min(0.0, Math.round(db * 10) / 10))
  }

  /**
   * Helper: Convert dBFS (-60 to 0) to linear amplitude (0.0 to 1.0)
   */
  public static dbFSToLinear(db: number): number {
    if (db <= -60) return 0.0
    return Math.pow(10, db / 20)
  }

  public isRecording(): boolean {
    return this.isRecordingState || this.isStartingState || this.isStoppingState
  }

  public isPaused(): boolean {
    return this.isPausedState
  }

  public getSampleRate(): number {
    return this.audioCtx?.sampleRate || 48000
  }

  public onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener)
    return () => { this.errorListeners.delete(listener) }
  }

  private failRecording(error: Error): void {
    if (this.recordingError) return
    this.recordingError = error
    this.pauseRecording()
    for (const session of this.sessions.values()) this.cleanupSession(session)
    for (const listener of this.errorListeners) listener(error)
  }

  public getDuration(): number {
    if (!this.isRecordingState) return 0
    if (this.isPausedState) {
      return (this.pauseTime - this.startTime - this.totalPausedDuration) / 1000
    }
    return (Date.now() - this.startTime - this.totalPausedDuration) / 1000
  }

  /**
   * Initialize or return the shared AudioContext
   */
  private async getAudioContext(): Promise<AudioContext> {
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      const AudioCtxClass = typeof window !== 'undefined'
        ? (window.AudioContext || (window as any).webkitAudioContext)
        : undefined
      if (AudioCtxClass) {
        this.audioCtx = new AudioCtxClass({ latencyHint: 'interactive' })
      }
      this.workletLoaded = false
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume()
    }
    await this.ensureWorkletModule()
    return this.audioCtx!
  }

  /**
   * Inlines and loads the AudioWorklet processor for ultra-low latency capture
   */
  private async ensureWorkletModule(): Promise<void> {
    if (this.workletLoaded || !this.audioCtx) return

    const workletCode = `
      class OmegaRecordingProcessor extends AudioWorkletProcessor {
        process(inputs, outputs, parameters) {
          const input = inputs[0];
          if (input && input.length > 0) {
            const left = input[0] || new Float32Array(128);
            const right = input.length > 1 ? input[1] : left;
            this.port.postMessage({
              left: left.slice(),
              right: right.slice()
            });
          }
          return true;
        }
      }
      registerProcessor('omega-recording-processor', OmegaRecordingProcessor);
    `

    const blob = new Blob([workletCode], { type: 'application/javascript' })
    const url = URL.createObjectURL(blob)
    try {
      await this.audioCtx.audioWorklet.addModule(url)
      this.workletLoaded = true
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  /**
   * Starts recording on all specified tracks simultaneously.
   * Dynamically aligns to actual AudioContext sample rate.
   */
  public async startRecording(
    tracks: RecordingTrackConfig[],
    _requestedSampleRate?: number
  ): Promise<void> {
    if (this.isStartingState || this.isRecordingState) {
      throw new Error('Recording is already in progress or starting.')
    }
    if (this.isStoppingState) {
      throw new Error('Cannot start recording while a recording session is stopping.')
    }

    if (tracks.length === 0) {
      throw new Error('No tracks configured for recording.')
    }

    this.isStartingState = true
    this.recordingError = null

    try {
      const ctx = await this.getAudioContext()
      if (!ctx) throw new Error('Web Audio ist nicht verfügbar.')
      const actualSampleRate = ctx.sampleRate
      this.sessions.clear()

      const api = typeof window !== 'undefined' ? (window as any).api : undefined
      if (!api?.initRecordingWav || !api?.appendRecordingChunk || !api?.finalizeRecordingWav) {
        throw new Error('Die Schnittstelle zum sicheren Speichern von Aufnahmen fehlt.')
      }
      if (new Set(tracks.map(track => track.trackId)).size !== tracks.length) {
        throw new Error('Aufnahmespuren müssen eindeutige IDs haben.')
      }

      // Setup active sessions for each track
      for (const track of tracks) {
        const session: ActiveSession = {
          trackId: track.trackId,
          inputSource: track.inputSource,
          tempFilePath: track.tempFilePath,
          sampleRate: track.inputSource.type === 'process' ? 48000 : actualSampleRate,
          channels: 2,
          totalSamples: 0,
          unwrittenL: [],
          unwrittenR: [],
          unwrittenSamples: 0,
          recordedPeaks: [],
          peakL: 0,
          peakR: 0,
          peakLdBFS: -60,
          peakRdBFS: -60,
          lastPeakUpdate: Date.now(),
          writeQueue: Promise.resolve(),
          pendingSamples: 0
        }
        this.sessions.set(track.trackId, session)

        // Initialize 44-byte WAV header on disk to enable O(1) in-place header patching
        if (api?.initRecordingWav) {
          const initRes = await api.initRecordingWav(
            session.trackId,
            session.tempFilePath,
            session.sampleRate,
            session.channels
          )
          if (!initRes?.success) {
            throw new Error(initRes.error || `Failed to initialize recording file for track ${session.trackId}`)
          }
        }

        if (track.inputSource.type === 'device') {
          // Hardware microphone capture via Web Audio API + AudioWorklet
          const deviceId = track.inputSource.deviceId || track.inputSource.id
          const isDefault = !deviceId || deviceId === 'default'
          const constraints: MediaStreamConstraints = {
            audio: {
              deviceId: isDefault ? undefined : { exact: deviceId },
              channelCount: { ideal: 2, min: 1 },
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false
            }
          }

          try {
            let stream: MediaStream
            try {
              stream = await navigator.mediaDevices.getUserMedia(constraints)
            } catch (constraintErr) {
              console.warn(`[AudioRecordingEngine] Preferred constraints failed for track ${track.trackId}, retrying with basic device constraints:`, constraintErr)
              stream = await navigator.mediaDevices.getUserMedia({
                audio: isDefault ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
                  : { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
              })
            }

            session.stream = stream
            const sourceNode = ctx.createMediaStreamSource(stream)
            session.sourceNode = sourceNode
            const workletNode = new AudioWorkletNode(ctx, 'omega-recording-processor')
            session.workletNode = workletNode

            workletNode.port.onmessage = (e) => {
              const { left, right } = e.data
              this.handleAudioChunk(track.trackId, left, right)
            }

            sourceNode.connect(workletNode)
            // Silent terminator so the graph pulls data without routing to speakers
            const silentGain = ctx.createGain()
            session.silentGain = silentGain
            silentGain.gain.value = 0
            workletNode.connect(silentGain)
            silentGain.connect(ctx.destination)

            session.stream = stream
            session.sourceNode = sourceNode
            session.workletNode = workletNode
            session.silentGain = silentGain
            this.sessions.set(track.trackId, session)
          } catch (err) {
            console.error(`[AudioRecordingEngine] Failed to initialize device input for track ${track.trackId}:`, err)
            this.cleanupSession(session)
            throw err
          }
        } else if (track.inputSource.type === 'process') {
          // Application WASAPI Loopback capture via Main process
          const pid = track.inputSource.pid || (track.inputSource.id ? parseInt(track.inputSource.id, 10) : undefined)
          if (pid && api?.startLoopbackCapture) {
            try {
              const started = await api.startLoopbackCapture(pid, track.trackId)
              if (!started?.success) throw new Error(started?.error || 'Programmaufnahme konnte nicht gestartet werden.')
              this.sessions.set(track.trackId, session)
            } catch (err) {
              console.warn(`[AudioRecordingEngine] Failed to start WASAPI loopback for PID ${pid}:`, err)
              throw err
            }
          } else {
            throw new Error(`Keine gültige Programmquelle für Spur ${track.trackId}. Bitte das Programm erneut auswählen.`)
          }
        }
      }

      if (this.sessions.size === 0) {
        throw new Error('Kein Audiogerät konnte für die Aufnahme initialisiert werden.')
      }

      // Attach loopback chunk IPC listener if any process tracks exist
      const hasProcessTracks = tracks.some((t) => t.inputSource.type === 'process')
      if (hasProcessTracks && api?.onLoopbackChunk) {
        this.loopbackCleanup = api.onLoopbackChunk((event: LoopbackChunkEvent) => {
          for (const session of this.sessions.values()) {
            const matches = event.trackId ? session.trackId === event.trackId : event.pid && session.inputSource.pid === event.pid
            if (matches) {
              if (event.sampleRate && event.sampleRate !== session.sampleRate) {
                this.failRecording(new Error('Die Abtastrate der Programmaufnahme hat sich geändert.'))
                return
              }
              const left = event.left instanceof Float32Array ? event.left : new Float32Array(event.left)
              const right = event.right instanceof Float32Array ? event.right : new Float32Array(event.right || event.left)
              this.handleAudioChunk(session.trackId, left, right)
            }
          }
        })
      }
      if (hasProcessTracks && api?.onLoopbackError) {
        const chunkCleanup = this.loopbackCleanup
        const errorCleanup = api.onLoopbackError((event: { trackId: string; error: string }) => {
          if (this.sessions.has(event.trackId)) this.failRecording(new Error(event.error))
        })
        this.loopbackCleanup = () => { chunkCleanup?.(); errorCleanup() }
      }

      this.isRecordingState = true
      this.isPausedState = false
      this.startTime = Date.now()
      this.pauseTime = 0
      this.totalPausedDuration = 0
    } catch (err) {
      this.releaseAllResources()
      throw err
    } finally {
      this.isStartingState = false
    }
  }

  /**
   * Processes a live chunk for a track: computes peaks, feeds waveform drawer,
   * buffers PCM, and triggers periodic disk flush.
   * Releases Float32Array audio chunk arrays immediately after flushing.
   */
  private handleAudioChunk(trackId: string, left: Float32Array, right: Float32Array): void {
    const session = this.sessions.get(trackId)
    if (!session) return

    // 1. Calculate live peak amplitudes (0.0 to 1.0 linear and dBFS)
    let pL = 0
    let pR = 0
    const len = left.length
    for (let i = 0; i < len; i++) {
      const vL = Math.abs(left[i])
      const vR = Math.abs(right[i])
      if (vL > pL) pL = vL
      if (vR > pR) pR = vR
    }

    session.peakL = pL
    session.peakR = pR
    session.peakLdBFS = AudioRecordingEngine.linearToDbFS(pL)
    session.peakRdBFS = AudioRecordingEngine.linearToDbFS(pR)
    session.lastPeakUpdate = Date.now()

    // 2. Notify chunk listeners for live oscilloscope rendering (always active for metering)
    for (const listener of this.chunkListeners) {
      listener(trackId, left, right)
    }

    // 3. If actively recording (and not paused), accumulate unwritten chunks and stream directly to disk
    if (this.isRecordingState && !this.isPausedState) {
      session.recordedPeaks.push(Math.max(pL, pR))
      session.totalSamples += len

      session.unwrittenL.push(left)
      session.unwrittenR.push(right)
      session.unwrittenSamples += len

      // Direct Disk Streaming: Stream chunks to prevent RAM overflow on long takes
      const flushThreshold = session.sampleRate || 48000
      if (session.unwrittenSamples >= flushThreshold) {
        this.flushSessionToDisk(session).catch((err) => {
          console.warn(`[AudioRecordingEngine] Disk streaming warning for track ${trackId}:`, err)
        })
      }
    }
  }

  /**
   * Flushes accumulated chunks for a track to disk via serialized IPC streaming.
   * Audio chunk arrays are discarded after conversion to avoid in-memory accumulation.
   */
  public async flushSessionToDisk(session: ActiveSession): Promise<void> {
    if (session.unwrittenSamples === 0) return

    const samplesToFlush = session.unwrittenSamples
    if ((session.pendingSamples || 0) + samplesToFlush > session.sampleRate * 5) {
      const error = new Error(`Die Festplatte ist zu langsam. Aufnahme abgebrochen: ${session.tempFilePath}`)
      this.failRecording(error)
      throw error
    }
    const chunksL = session.unwrittenL
    const chunksR = session.unwrittenR

    // Release chunk references from memory immediately
    session.unwrittenL = []
    session.unwrittenR = []
    session.unwrittenSamples = 0

    // Interleave into 16-bit PCM for disk append
    const interleaved = new Int16Array(samplesToFlush * 2)
    let offset = 0
    for (let c = 0; c < chunksL.length; c++) {
      const l = chunksL[c]
      const r = chunksR[c] || l
      for (let i = 0; i < l.length; i++) {
        const sL = Math.max(-1, Math.min(1, l[i]))
        const sR = Math.max(-1, Math.min(1, r[i]))
        interleaved[offset++] = sL < 0 ? sL * 0x8000 : sL * 0x7fff
        interleaved[offset++] = sR < 0 ? sR * 0x8000 : sR * 0x7fff
      }
    }

    // Serialize disk append operations per track via a promise chain
    const api = typeof window !== 'undefined' ? (window as any).api : undefined
    session.pendingSamples = (session.pendingSamples || 0) + samplesToFlush
    session.writeQueue = session.writeQueue.then(async () => {
      if (!api?.appendRecordingChunk) throw new Error('Die Aufnahmeschnittstelle ist nicht verfügbar.')
      const res = await api.appendRecordingChunk(session.trackId, session.tempFilePath, interleaved.buffer)
      if (!res?.success) {
        throw new Error(res?.error || `Failed to append recording chunk for track ${session.trackId}`)
      }
    }).finally(() => { session.pendingSamples -= samplesToFlush })
    void session.writeQueue.catch(error => {
      if (this.sessions.get(session.trackId) === session) this.failRecording(error)
    })

    return session.writeQueue
  }

  /**
   * Pause ongoing recording. VU metering remains live.
   */
  public pauseRecording(): void {
    if (!this.isRecordingState || this.isPausedState) return
    this.isPausedState = true
    this.pauseTime = Date.now()
  }

  /**
   * Resume paused recording.
   */
  public resumeRecording(): void {
    if (!this.isRecordingState || !this.isPausedState) return
    this.totalPausedDuration += Date.now() - this.pauseTime
    this.isPausedState = false
  }

  /**
   * Stops recording on all tracks, flushes data to disk, finalizes WAV files in O(1) constant memory,
   * cleans up hardware media streams and WASAPI loopback, and returns results.
   * Protected against concurrent invocations.
   */
  public async stopRecording(): Promise<RecordingResult[]> {
    if (!this.isRecordingState && !this.isStoppingState) {
      return []
    }

    if (this.isStoppingState && this.activeStopPromise) {
      return this.activeStopPromise
    }

    this.isStoppingState = true

    this.activeStopPromise = (async () => {
      try {
        this.isRecordingState = false
        this.isPausedState = false

        // 1. Immediately release all hardware streams, nodes, and loopback captures
        for (const session of this.sessions.values()) {
          this.cleanupSession(session)
        }

        if (this.loopbackCleanup) {
          try {
            this.loopbackCleanup()
          } catch {}
          this.loopbackCleanup = undefined
        }

        const results: RecordingResult[] = []
        const errors: Error[] = []
        const api = typeof window !== 'undefined' ? (window as any).api : undefined

        for (const session of this.sessions.values()) {
          try {
            await session.writeQueue
            // 2. Flush any remaining unwritten chunks
            await this.flushSessionToDisk(session)

            // 3. Await all pending serialized disk appends
            await session.writeQueue

            // 4. Finalize WAV file on disk (O(1) constant memory)
            let finalFilePath = session.tempFilePath
            if (api?.finalizeRecordingWav) {
              const finRes = await api.finalizeRecordingWav(
                session.trackId,
                session.tempFilePath,
                session.totalSamples,
                session.sampleRate,
                session.channels
              )
              if (!finRes || finRes.success === false) {
                throw new Error(finRes?.error || `Fehler beim Finalisieren der WAV-Datei für Spur ${session.trackId}`)
              }
              if (finRes.filePath) {
                finalFilePath = finRes.filePath
              }
            }

            const duration = session.sampleRate > 0 ? session.totalSamples / session.sampleRate : 0

            results.push({
              trackId: session.trackId,
              filePath: finalFilePath,
              duration: Math.max(0, duration),
              sampleRate: session.sampleRate,
              totalSamples: session.totalSamples,
              channels: session.channels,
              peaks: session.recordedPeaks
            })
          } catch (trackErr) {
            console.error(`[AudioRecordingEngine] Error finalizing recording for track ${session.trackId}:`, trackErr)
            errors.push(trackErr instanceof Error ? trackErr : new Error(String(trackErr)))
          }
        }

        this.sessions.clear()
        if (errors.length) throw Object.assign(new Error(errors.map(error => error.message).join('; ')), { recordings: results })
        return results
      } finally {
        this.isStoppingState = false
        this.activeStopPromise = null
      }
    })()

    return this.activeStopPromise
  }

  /**
   * Clean up hardware streams and Web Audio nodes for an individual session.
   */
  private cleanupSession(session: ActiveSession): void {
    if (session.stream) {
      try {
        session.stream.getTracks().forEach((track) => track.stop())
      } catch (e) {
        console.warn('[AudioRecordingEngine] Error stopping media track:', e)
      }
      session.stream = undefined
    }
    if (session.sourceNode) {
      try {
        session.sourceNode.disconnect()
      } catch (e) {
        console.warn('[AudioRecordingEngine] Error disconnecting sourceNode:', e)
      }
      session.sourceNode = undefined
    }
    if (session.workletNode) {
      try {
        session.workletNode.disconnect()
      } catch (e) {
        console.warn('[AudioRecordingEngine] Error disconnecting workletNode:', e)
      }
      session.workletNode = undefined
    }
    if (session.silentGain) {
      try {
        session.silentGain.disconnect()
      } catch (e) {
        console.warn('[AudioRecordingEngine] Error disconnecting silentGain:', e)
      }
      session.silentGain = undefined
    }
    if (session.inputSource.type === 'process') {
      const pid = session.inputSource.pid || (session.inputSource.id ? parseInt(session.inputSource.id, 10) : undefined)
      const api = typeof window !== 'undefined' ? (window as any).api : undefined
      if (pid && api?.stopLoopbackCapture) {
        api.stopLoopbackCapture(pid, session.trackId).catch(() => {})
      }
    }
  }

  /**
   * Release all session resources and reset engine state.
   */
  private releaseAllResources(): void {
    for (const session of this.sessions.values()) {
      this.cleanupSession(session)
    }
    this.sessions.clear()
    if (this.loopbackCleanup) {
      try {
        this.loopbackCleanup()
      } catch {}
      this.loopbackCleanup = undefined
    }
    this.isRecordingState = false
    this.isPausedState = false
  }

  /**
   * Retrieves the live recorded peak array for an active recording session.
   */
  public getLivePeaks(trackId: string): number[] {
    const session = this.sessions.get(trackId)
    return session ? session.recordedPeaks : []
  }

  /**
   * Retrieves the current peak measurement for a given track.
   */
  public getPeak(trackId: string): LivePeak {
    const session = this.sessions.get(trackId)
    if (!session) {
      return { peakL: 0, peakR: 0, peakLdBFS: -60, peakRdBFS: -60, clippingL: false, clippingR: false }
    }
    return {
      peakL: session.peakL,
      peakR: session.peakR,
      peakLdBFS: session.peakLdBFS,
      peakRdBFS: session.peakRdBFS,
      clippingL: session.peakL >= 0.99,
      clippingR: session.peakR >= 0.99
    }
  }

  /**
   * Retrieves peaks for all currently tracked channels.
   */
  public getAllPeaks(): Record<string, LivePeak> {
    const result: Record<string, LivePeak> = {}
    for (const [trackId, session] of this.sessions.entries()) {
      result[trackId] = {
        peakL: session.peakL,
        peakR: session.peakR,
        peakLdBFS: session.peakLdBFS,
        peakRdBFS: session.peakRdBFS,
        clippingL: session.peakL >= 0.99,
        clippingR: session.peakR >= 0.99
      }
    }
    return result
  }

  /**
   * Subscribes to live peak updates (ideal for 60fps VU-Meter rendering).
   */
  public onPeaks(callback: (peaks: Record<string, LivePeak>) => void): () => void {
    this.peakListeners.add(callback)
    return () => {
      this.peakListeners.delete(callback)
    }
  }

  /**
   * Subscribes to raw Float32Array chunks (for live oscilloscope canvas drawing).
   */
  public onChunk(callback: (trackId: string, left: Float32Array, right: Float32Array) => void): () => void {
    this.chunkListeners.add(callback)
    return () => {
      this.chunkListeners.delete(callback)
    }
  }

  /**
   * Background decay loop to naturally simulate analog needle / LED VU meter falloff.
   */
  private startPeakDecayLoop(): void {
    if (typeof requestAnimationFrame === 'undefined') return

    let lastTick = Date.now()
    const tick = () => {
      const now = Date.now()
      const deltaMs = now - lastTick
      lastTick = now

      if (this.sessions.size > 0) {
        for (const session of this.sessions.values()) {
          const timeSinceUpdate = now - session.lastPeakUpdate
          if (timeSinceUpdate > 30) {
            // Apply exponential/linear decay
            const decay = PEAK_DECAY_DB_PER_MS * deltaMs
            session.peakLdBFS = Math.max(-60, session.peakLdBFS - decay)
            session.peakRdBFS = Math.max(-60, session.peakRdBFS - decay)
            session.peakL = AudioRecordingEngine.dbFSToLinear(session.peakLdBFS)
            session.peakR = AudioRecordingEngine.dbFSToLinear(session.peakRdBFS)
          }
        }

        const peaks = this.getAllPeaks()
        for (const listener of this.peakListeners) {
          listener(peaks)
        }
      }

      this.peakIntervalId = requestAnimationFrame(tick) as any
    }

    this.peakIntervalId = requestAnimationFrame(tick) as any
  }

  /**
   * Flattens array of chunks into a single Float32Array.
   */
  private flattenChunks(chunks: Float32Array[], totalLength: number): Float32Array {
    const flat = new Float32Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      flat.set(chunk, offset)
      offset += chunk.length
    }
    return flat
  }

  /**
   * Encodes stereo Float32 channels to standard 16-Bit PCM WAV buffer.
   */
  public encodeWAV(buffers: Float32Array[], sampleRate: number, numChannels: number = 2): ArrayBuffer {
    const ch0 = buffers[0] || new Float32Array(0)
    const ch1 = buffers[1] || ch0
    const totalSamples = ch0.length * numChannels
    const buffer = new ArrayBuffer(44 + totalSamples * 2)
    const view = new DataView(buffer)

    const writeStr = (pos: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(pos + i, str.charCodeAt(i))
      }
    }

    // RIFF identifier & file size
    writeStr(0, 'RIFF')
    view.setUint32(4, 36 + totalSamples * 2, true)
    writeStr(8, 'WAVE')

    // Format Chunk
    writeStr(12, 'fmt ')
    view.setUint32(16, 16, true) // SubChunk1Size (16 for PCM)
    view.setUint16(20, 1, true) // AudioFormat: 1 = PCM
    view.setUint16(22, numChannels, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * numChannels * 2, true) // ByteRate
    view.setUint16(32, numChannels * 2, true) // BlockAlign
    view.setUint16(34, 16, true) // BitsPerSample: 16-bit

    // Data Chunk
    writeStr(36, 'data')
    view.setUint32(40, totalSamples * 2, true)

    // Write interleaved 16-bit PCM samples
    let offset = 44
    const len = ch0.length
    for (let i = 0; i < len; i++) {
      let s0 = Math.max(-1, Math.min(1, ch0[i]))
      view.setInt16(offset, s0 < 0 ? s0 * 0x8000 : s0 * 0x7fff, true)
      offset += 2

      if (numChannels > 1) {
        let s1 = Math.max(-1, Math.min(1, ch1[i]))
        view.setInt16(offset, s1 < 0 ? s1 * 0x8000 : s1 * 0x7fff, true)
        offset += 2
      }
    }

    return buffer
  }

  /**
   * Helper: enumerate available hardware microphones
   */
  public static async getAvailableMicrophones(): Promise<MediaDeviceInfo[]> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      return devices.filter((d) => d.kind === 'audioinput')
    } catch (e) {
      console.warn('[AudioRecordingEngine] Unable to enumerate audio devices:', e)
      return []
    }
  }
}
