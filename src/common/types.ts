/**
 * types.ts
 * Unified core type definitions for the Omega Wave Recorder ecosystem.
 * 100% compatible with Omega Wave Editor (OWEP) data model.
 * Shared across Main Process, Preload, and Renderer.
 */

export interface FileEntry {
  name: string
  path: string
  isDirectory?: boolean
}

export type RegionFile = FileEntry

export interface Effects {
  eqActive?: boolean
  eqGains?: number[] // 10-band values (-15 to +15 dB)
  compActive?: boolean
  compThreshold?: number // dB
  compRatio?: number // e.g. 1 to 20
  reverbMix?: number // %
  reverbTime?: number // seconds
  delayFeedback?: number // %
  delayTime?: number // ms
  deEsserActive?: boolean
  deEsserReduction?: number // dB
  pitchRate?: number // multiplier (0.5 to 2.0)
  keepPitch?: boolean
  [key: string]: any
}

export interface Region {
  id: string
  file: FileEntry
  startPos: number // in seconds in timeline
  duration: number // in seconds
  sourceOffset?: number // starting offset in original audio file in seconds
  gain?: number // multiplier (e.g. 0.0 to 2.0, default 1.0)
  fadeIn?: number // fade-in duration in seconds (e.g. 0.003 for 3ms micro-fade)
  fadeOut?: number // fade-out duration in seconds (e.g. 0.003 for 3ms micro-fade)
  effects?: Effects
  stereoMode?: 'stereo' | 'left-only' | 'right-only'
  name?: string
  fileDuration?: number
  color?: string
  groupId?: string
  channels?: number
  [key: string]: any
}

export interface InputSource {
  type: 'device' | 'process'
  id: string
  name: string
  deviceId?: string // alias for id when type === 'device'
  processName?: string // executable name when type === 'process' (e.g. 'Spotify.exe')
  pid?: number // process ID if known
  label?: string // human readable display label
  title?: string // window or stream title
  iconUrl?: string // executable or window icon
}

export interface Track {
  id: string
  index: number
  name: string
  regions: Region[]
  muted: boolean
  solo: boolean
  locked: boolean
  visible: boolean
  volume: number // multiplier (0.0 to 1.5, default 1.0)
  inputSource?: InputSource
  color?: string // Hex or CSS color string (e.g. '#0078d7')
  pan?: number // -1.0 to 1.0
  armed?: boolean // true if track is armed for recording
  preMuteVolume?: number // remember volume before mute toggle
  height?: number // visual height in pixels
  automation?: any[] // parameter automation curves
  denoise?: number // reduction in dB (0 to 24)
  dehiss?: number // reduction in dB (0 to 24)
  [key: string]: any
}

// Backward compatibility alias
export type TrackData = Track

export interface MetadataTags {
  title?: string
  artist?: string
  album?: string
  year?: string
  genre?: string
  comment?: string
  track?: string
  coverPath?: string
}

export interface ExportSettings {
  format: 'wav' | 'mp3' | 'flac' | 'ogg' | 'm4a' | 'opus'
  path: string
  sampleRate: number // e.g. 44100, 48000, 96000
  bitDepth?: string // e.g. "16 Bit", "24 Bit", "32 Bit float"
  bitrate?: string // e.g. "128", "192", "320" kbps
  channels: 'Stereo' | 'Mono'
  playAfterExport: boolean
  id3Tags?: MetadataTags
  mode?: 'mixdown' | 'stems'
}

export interface ProjectSettings {
  zoomLevel: number
  sampleRate: number
  playheadPos: number
  exportSettings?: ExportSettings
  timeSignature?: string
  bpm?: number
  [key: string]: any
}

export interface ProjectMetadata {
  createdAt: number
  updatedAt: number
  author: string
  title?: string
  description?: string
}

export interface Project {
  format: 'OWRP' | 'OWEP'
  version: string // e.g. "1.0.0"
  tracks: Track[]
  settings: ProjectSettings
  metadata: ProjectMetadata
}

// Backward compatibility alias
export type ProjectData = Project

/** Real-time peak measurement values for VU meter */
export interface LivePeak {
  peakL: number // linear 0.0 to 1.0
  peakR: number // linear 0.0 to 1.0
  peakLdBFS: number // dBFS -60.0 to 0.0
  peakRdBFS: number // dBFS -60.0 to 0.0
  clippingL?: boolean
  clippingR?: boolean
}

/** Information about running audio applications for WASAPI process loopback */
export interface AudioProcessInfo {
  pid: number
  processName: string
  title: string
  iconUrl?: string
}

export type ProcessLoopbackTarget = AudioProcessInfo

export interface AudioInputDevice {
  deviceId: string
  label: string
  groupId?: string
}

/** Loopback audio chunk received via IPC */
export interface LoopbackChunkEvent {
  trackId?: string
  pid?: number
  left: Float32Array | number[]
  right: Float32Array | number[]
  sampleRate?: number
}

export interface AppSettings {
  language: string
  defaultSampleRate: number
  defaultOutputDevice: string
  recordingsPath: string
  projectsPath: string
  exportsPath: string
  bufferSize: number
  mutedWarnings: string[]
}
