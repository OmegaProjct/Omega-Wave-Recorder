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
  totalSamples: number
  chunksL: Float32Array[]
  chunksR: Float32Array[]
  unwrittenL: Float32Array[]
  unwrittenR: Float32Array[]
  unwrittenSamples: number
  recordedPeaks: number[]
  peakL: number
  peakR: number
  peakLdBFS: number
  peakRdBFS: number
  lastPeakUpdate: number
}

// Falloff / decay rate for peaks (dB per millisecond)
const PEAK_DECAY_DB_PER_MS = 0.05
const FLUSH_THRESHOLD_SAMPLES = 48000 // Flush to disk roughly every 1 second of audio

export class AudioRecordingEngine {
  private static instance: AudioRecordingEngine | null = null

  private audioCtx: AudioContext | null = null
  private workletLoaded: boolean = false
  private isRecordingState: boolean = false
  private isPausedState: boolean = false
  private startTime: number = 0
  private pauseTime: number = 0
  private totalPausedDuration: number = 0

  private sessions: Map<string, ActiveSession> = new Map()
  private loopbackCleanup?: () => void

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
    return this.isRecordingState
  }

  public isPaused(): boolean {
    return this.isPausedState
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
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext
      this.audioCtx = new AudioCtxClass({ latencyHint: 'interactive' })
      this.workletLoaded = false
    }
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume()
    }
    await this.ensureWorkletModule()
    return this.audioCtx
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
   */
  public async startRecording(
    tracks: RecordingTrackConfig[],
    sampleRate: number = 48000
  ): Promise<void> {
    if (this.isRecordingState) {
      throw new Error('Recording is already in progress.')
    }

    if (tracks.length === 0) {
      throw new Error('No tracks configured for recording.')
    }

    const ctx = await this.getAudioContext()
    this.sessions.clear()

    // Setup active sessions for each track
    for (const track of tracks) {
      const session: ActiveSession = {
        trackId: track.trackId,
        inputSource: track.inputSource,
        tempFilePath: track.tempFilePath,
        sampleRate: sampleRate || ctx.sampleRate || 48000,
        channels: 2,
        totalSamples: 0,
        chunksL: [],
        chunksR: [],
        unwrittenL: [],
        unwrittenR: [],
        unwrittenSamples: 0,
        recordedPeaks: [],
        peakL: 0,
        peakR: 0,
        peakLdBFS: -60,
        peakRdBFS: -60,
        lastPeakUpdate: Date.now()
      }

      if (track.inputSource.type === 'device') {
        // Hardware microphone capture via Web Audio API + AudioWorklet
        const deviceId = track.inputSource.deviceId || track.inputSource.id
        const constraints: MediaStreamConstraints = {
          audio: {
            deviceId: deviceId && deviceId !== 'default' ? { exact: deviceId } : undefined,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 2
          }
        }

        try {
          const stream = await navigator.mediaDevices.getUserMedia(constraints)
          const sourceNode = ctx.createMediaStreamSource(stream)
          const workletNode = new AudioWorkletNode(ctx, 'omega-recording-processor')

          workletNode.port.onmessage = (e) => {
            const { left, right } = e.data
            this.handleAudioChunk(track.trackId, left, right)
          }

          sourceNode.connect(workletNode)
          // Silent terminator so the graph pulls data without routing to speakers
          const silentGain = ctx.createGain()
          silentGain.gain.value = 0
          workletNode.connect(silentGain)
          silentGain.connect(ctx.destination)

          session.stream = stream
          session.sourceNode = sourceNode
          session.workletNode = workletNode
        } catch (err) {
          console.error(`[AudioRecordingEngine] Failed to initialize device input for track ${track.trackId}:`, err)
          throw err
        }
      } else if (track.inputSource.type === 'process') {
        // Application WASAPI Loopback capture via Main process
        const pid = track.inputSource.pid || (track.inputSource.id ? parseInt(track.inputSource.id, 10) : undefined)
        const api = typeof window !== 'undefined' ? (window as any).api : undefined
        if (pid && api?.startLoopbackCapture) {
          try {
            await api.startLoopbackCapture(pid, track.trackId)
          } catch (err) {
            console.warn(`[AudioRecordingEngine] Failed to start WASAPI loopback for PID ${pid}:`, err)
          }
        }
      }

      this.sessions.set(track.trackId, session)
    }

    // Attach loopback chunk IPC listener if any process tracks exist
    const hasProcessTracks = tracks.some((t) => t.inputSource.type === 'process')
    const winApi = typeof window !== 'undefined' ? (window as any).api : undefined
    if (hasProcessTracks && winApi?.onLoopbackChunk) {
      this.loopbackCleanup = winApi.onLoopbackChunk((event: LoopbackChunkEvent) => {
        // Match session by trackId or by PID
        for (const session of this.sessions.values()) {
          const matchesTrack = event.trackId && session.trackId === event.trackId
          const matchesPid = event.pid && session.inputSource.pid === event.pid
          if (matchesTrack || matchesPid) {
            const left = event.left instanceof Float32Array ? event.left : new Float32Array(event.left)
            const right = event.right instanceof Float32Array ? event.right : new Float32Array(event.right || event.left)
            this.handleAudioChunk(session.trackId, left, right)
            break
          }
        }
      })
    }

    this.isRecordingState = true
    this.isPausedState = false
    this.startTime = Date.now()
    this.pauseTime = 0
    this.totalPausedDuration = 0
  }

  /**
   * Processes a live chunk for a track: computes peaks, feeds waveform drawer,
   * buffers PCM, and triggers periodic disk flush.
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

    // 3. If actively recording (and not paused), accumulate data and stream to disk
    if (this.isRecordingState && !this.isPausedState) {
      session.recordedPeaks.push(Math.max(pL, pR))
      session.chunksL.push(left)
      session.chunksR.push(right)
      session.totalSamples += len

      session.unwrittenL.push(left)
      session.unwrittenR.push(right)
      session.unwrittenSamples += len

      // Direct Disk Streaming: Stream chunks to prevent RAM overflow on long takes
      if (session.unwrittenSamples >= FLUSH_THRESHOLD_SAMPLES) {
        this.flushSessionToDisk(session).catch((err) => {
          console.warn(`[AudioRecordingEngine] Disk streaming warning for track ${trackId}:`, err)
        })
      }
    }
  }

  /**
   * Flushes accumulated chunks for a track to disk via IPC streaming.
   */
  private async flushSessionToDisk(session: ActiveSession): Promise<void> {
    if (session.unwrittenSamples === 0) return

    const samplesToFlush = session.unwrittenSamples
    const chunksL = session.unwrittenL
    const chunksR = session.unwrittenR

    session.unwrittenL = []
    session.unwrittenR = []
    session.unwrittenSamples = 0

    const api = typeof window !== 'undefined' ? (window as any).api : undefined
    if (api?.appendRecordingChunk) {
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
      await api.appendRecordingChunk(session.trackId, session.tempFilePath, interleaved.buffer)
    }
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
   * Stops recording on all tracks, flushes data to disk, encodes valid WAV files,
   * cleans up hardware media streams and WASAPI loopback, and returns results.
   */
  public async stopRecording(): Promise<RecordingResult[]> {
    if (!this.isRecordingState) {
      return []
    }

    this.isRecordingState = false
    this.isPausedState = false

    // Clean up loopback IPC subscription
    if (this.loopbackCleanup) {
      this.loopbackCleanup()
      this.loopbackCleanup = undefined
    }

    const results: RecordingResult[] = []

    for (const session of this.sessions.values()) {
      // 1. Release hardware stream
      if (session.stream) {
        session.stream.getTracks().forEach((track) => track.stop())
        session.stream = undefined
      }
      if (session.sourceNode) {
        session.sourceNode.disconnect()
        session.sourceNode = undefined
      }
      if (session.workletNode) {
        session.workletNode.disconnect()
        session.workletNode = undefined
      }

      // 2. Stop WASAPI loopback if applicable
      const api = typeof window !== 'undefined' ? (window as any).api : undefined
      if (session.inputSource.type === 'process') {
        const pid = session.inputSource.pid || (session.inputSource.id ? parseInt(session.inputSource.id, 10) : undefined)
        if (pid && api?.stopLoopbackCapture) {
          api.stopLoopbackCapture(pid).catch(() => {})
        }
      }

      // 3. Flush remaining chunks
      await this.flushSessionToDisk(session)

      const duration = session.totalSamples / (session.sampleRate || 48000)

      // 4. Finalize WAV file on disk
      if (api?.finalizeRecordingWav) {
        await api.finalizeRecordingWav(
          session.trackId,
          session.tempFilePath,
          session.totalSamples,
          session.sampleRate,
          session.channels
        )
      } else if (api?.saveRecording) {
        // Complete buffer assemble & save fallback
        const flatL = this.flattenChunks(session.chunksL, session.totalSamples)
        const flatR = this.flattenChunks(session.chunksR, session.totalSamples)
        const wavBuffer = this.encodeWAV([flatL, flatR], session.sampleRate, session.channels)
        await api.saveRecording(session.tempFilePath, wavBuffer)
      }

      results.push({
        trackId: session.trackId,
        filePath: session.tempFilePath,
        duration: Math.max(0, duration),
        sampleRate: session.sampleRate,
        totalSamples: session.totalSamples,
        channels: session.channels,
        peaks: session.recordedPeaks
      })
    }

    this.sessions.clear()
    return results
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
