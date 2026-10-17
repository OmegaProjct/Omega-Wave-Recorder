/// <reference types="vite/client" />

declare module '*.png' {
  const value: string
  export default value
}

declare module '*.svg' {
  const content: string
  export default content
}

export interface ElectronAPI {
  getSettings?: () => Promise<any>
  saveSettings?: (settings: any) => Promise<boolean>
  getLocales?: () => Promise<Record<string, any>>
  openExternal?: (url: string) => Promise<void>
  openPath?: (path: string) => Promise<void>
  showOpenDialog?: (options: any) => Promise<any>
  showSaveDialog?: (options: any) => Promise<any>
  getAudioProcesses?: () => Promise<any[]>
  [key: string]: any
}

declare global {
  interface Window {
    api: import('../../preload/index').ElectronApi
  }
}
