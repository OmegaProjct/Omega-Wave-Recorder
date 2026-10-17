import { contextBridge, ipcRenderer } from 'electron'

export interface VisibleAppWindow {
  id: string
  title: string
  name: string
  processName: string
  pid: number
  iconUrl?: string
}

export interface Id3Metadata {
  title?: string
  artist?: string
  album?: string
  year?: string
  genre?: string
  track?: string
  comment?: string
  coverPath?: string
}

export interface TranscodeOptions {
  format?: 'wav' | 'mp3' | 'ogg' | 'flac' | string
  sampleRate?: number | string
  bitrate?: number | string
  deleteSource?: boolean
}

export interface UpdateDownloadProgress {
  percent: number
  status: string
  downloadedBytes: number
  totalBytes: number
  speedBps: number
  remainingSeconds: number
  error?: string
}

const api = {
  // Window Controls
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  maximizeWindow: () => ipcRenderer.invoke('maximize-window'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  isMaximized: () => ipcRenderer.invoke('is-maximized'),
  onMaximizeChange: (callback: (isMaximized: boolean) => void) => {
    const handler = (_: any, state: boolean) => callback(state)
    ipcRenderer.on('window-maximize-changed', handler)
    return () => {
      ipcRenderer.removeListener('window-maximize-changed', handler)
    }
  },

  // System & Navigation
  openExternalLink: (url: string) => ipcRenderer.invoke('open-external-link', url),
  openExternal: (url: string) => ipcRenderer.invoke('open-external-link', url),
  openPath: (targetPath: string) => ipcRenderer.invoke('open-path', targetPath),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  readChangelog: () => ipcRenderer.invoke('read-changelog'),
  showItemInFolder: (filePath: string) => ipcRenderer.invoke('show-item-in-folder', filePath),
  deleteFile: (filePath: string) => ipcRenderer.invoke('delete-file', filePath),
  getHomeDir: () => ipcRenderer.invoke('get-home-dir'),
  getSystemPath: (name: string) => ipcRenderer.invoke('get-system-path', name),

  // Settings & Locales
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: any) => ipcRenderer.invoke('save-settings', settings),
  getLocales: () => ipcRenderer.invoke('get-locales'),
  saveLocale: (lang: string, content: any) => ipcRenderer.invoke('save-locale', { lang, content }),
  getPerformanceStats: () => ipcRenderer.invoke('get-performance-stats'),

  // Audio Operations
  saveRecording: (outputPath: string, arrayBuffer: ArrayBuffer) =>
    ipcRenderer.invoke('save-recording', outputPath, arrayBuffer),
  transcodeExport: (tempWavPath: string, outputPath: string, options: TranscodeOptions, id3Tags?: Id3Metadata) =>
    ipcRenderer.invoke('transcode-export', tempWavPath, outputPath, options, id3Tags),
  getMediaInfo: (filePath: string) => ipcRenderer.invoke('get-media-info', filePath),
  readFileBuffer: (filePath: string) => ipcRenderer.invoke('read-file-buffer', filePath),
  exportProject: (tracksData: any[], outputPath: string, id3Tags?: Id3Metadata) =>
    ipcRenderer.invoke('export-project', tracksData, outputPath, id3Tags),

  // Loopback & Window Enumeration
  getVisibleWindows: (): Promise<VisibleAppWindow[]> => ipcRenderer.invoke('get-visible-windows'),
  getAudioProcesses: (): Promise<VisibleAppWindow[]> => ipcRenderer.invoke('get-visible-windows'),
  startProcessMonitoring: (payload: { processName: string; pid?: number }) =>
    ipcRenderer.invoke('start-process-monitoring', payload),
  stopProcessMonitoring: (payload: { processName: string; pid?: number }) =>
    ipcRenderer.invoke('stop-process-monitoring', payload),
  isProcessRunning: (payload: { processName: string; pid?: number }) =>
    ipcRenderer.invoke('is-process-running', payload),
  onProcessStatus: (callback: (data: { processName: string; pid?: number; status: 'closed' | 'reconnected' }) => void) => {
    const handler = (_: any, data: any) => callback(data)
    ipcRenderer.on('loopback:process-status', handler)
    return () => {
      ipcRenderer.removeListener('loopback:process-status', handler)
    }
  },

  // Projects (.owrp / .owep)
  showOpenDialog: (options?: any) => ipcRenderer.invoke('show-open-dialog', options),
  showSaveDialog: (options?: any) => ipcRenderer.invoke('show-save-dialog', options),
  saveProject: (filePath: string, data: any) => ipcRenderer.invoke('save-project', filePath, data),
  saveProjectBackup: (filePath: string, data: any) => ipcRenderer.invoke('save-project-backup', filePath, data),
  openProject: (filePath: string) => ipcRenderer.invoke('open-project', filePath),
  loadProject: (filePath: string) => ipcRenderer.invoke('load-project', filePath),
  getStartupFile: () => ipcRenderer.invoke('get-startup-file'),
  onOpenProjectFromAssociation: (callback: (filePath: string) => void) => {
    const handler = (_: any, filePath: string) => callback(filePath)
    ipcRenderer.on('open-project-from-association', handler)
    return () => {
      ipcRenderer.removeListener('open-project-from-association', handler)
    }
  },

  // Software Update
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  startUpdateDownload: (payload: { url?: string; latestVersion?: string }) =>
    ipcRenderer.invoke('start-update-download', payload),
  cancelUpdateDownload: () => ipcRenderer.invoke('cancel-update-download'),
  installUpdate: (payload: { installNow?: boolean }) => ipcRenderer.invoke('install-update', payload),
  onDownloadProgress: (callback: (data: UpdateDownloadProgress) => void) => {
    const handler = (_: any, data: UpdateDownloadProgress) => callback(data)
    ipcRenderer.on('download-progress', handler)
    return () => {
      ipcRenderer.removeListener('download-progress', handler)
    }
  },

  // Logging & Diagnostics
  log: (level: 'debug' | 'info' | 'warn' | 'error', moduleName: string, message: string, details?: any) =>
    ipcRenderer.invoke('write-log', level, moduleName, message, details),
  getLogPath: () => ipcRenderer.invoke('get-log-path'),
  getRecentLogs: (limit?: number) => ipcRenderer.invoke('get-recent-logs', limit),
  getLogContent: (filename?: string) => ipcRenderer.invoke('get-log-content', filename),
  clearLog: (filename?: string) => ipcRenderer.invoke('clear-log', filename),
  getSessionLogs: () => ipcRenderer.invoke('get-session-logs'),
  deleteSessionLog: (filename: string) => ipcRenderer.invoke('delete-session-log', filename),
  openLogFolder: () => ipcRenderer.invoke('open-log-folder'),

  // Convenience aliases for renderer components
  minimize: () => ipcRenderer.invoke('minimize-window'),
  maximize: () => ipcRenderer.invoke('maximize-window'),
  close: () => ipcRenderer.invoke('close-window'),
  openLogsFolder: () => ipcRenderer.invoke('open-log-folder'),
  readLogFile: (filename?: string) => ipcRenderer.invoke('get-log-content', filename),
  getDeviceId: () => Promise.resolve('DEV-' + Math.random().toString(36).substring(2, 10).toUpperCase()),
  submitFeedback: (payload: any) => ipcRenderer.invoke('submit-feedback', payload),
  getAvailableLocales: () => ipcRenderer.invoke('get-available-locales'),
  openLocalesFolder: () => ipcRenderer.invoke('open-locales-folder'),
  exportAudio: (settings: any) => ipcRenderer.invoke('export-project', [], settings.path, settings.id3Tags),
  downloadUpdate: (url?: string) => ipcRenderer.invoke('start-update-download', { url }),

  // Real-time chunk streaming & loopback capture for AudioRecordingEngine
  startLoopbackCapture: (pid: number, trackId?: string) =>
    ipcRenderer.invoke('start-loopback-capture', pid, trackId),
  stopLoopbackCapture: (pid: number) =>
    ipcRenderer.invoke('stop-loopback-capture', pid),
  onLoopbackChunk: (callback: (data: any) => void) => {
    const handler = (_: any, data: any) => callback(data)
    ipcRenderer.on('loopback-chunk', handler)
    return () => {
      ipcRenderer.removeListener('loopback-chunk', handler)
    }
  },
  appendRecordingChunk: (trackId: string, filePath: string, buffer: ArrayBuffer) =>
    ipcRenderer.invoke('append-recording-chunk', trackId, filePath, buffer),
  finalizeRecordingWav: (trackId: string, filePath: string, totalSamples: number, sampleRate?: number, channels?: number) =>
    ipcRenderer.invoke('finalize-recording-wav', trackId, filePath, totalSamples, sampleRate, channels)
}

export type ElectronApi = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (err) {
    console.error('Failed to expose api bridge via contextBridge', err)
  }
} else {
  // @ts-ignore (define in dts)
  window.api = api
}
