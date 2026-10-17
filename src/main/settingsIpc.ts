import { ipcMain, app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { logger } from './logger'
import { isSafePath } from './utils/pathUtils'

export interface AppSettings {
  projPath: string
  expPath: string
  recPath: string
  tempPath: string
  dlPath: string
  localesPath: string
  sampleRate: number
  defaultOutputDevice: string
  viewMode: 'multitrack' | 'focus'
  maxTracks: number
  language: string
  autoSave: boolean
  autoSaveInterval: number
  appendMode: 'append' | 'cursor'
  mutedWarnings: string[]
  recentProjects: string[]
  waveformColor: string
}

export function getAppDataDir(): string {
  let appData = ''
  try {
    appData = app.getPath('appData')
  } catch {
    appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  }
  return path.join(appData, 'OmegaProjects', 'Omega Media Core', 'Omega Wave Recorder')
}

export function getDocumentsDir(): string {
  let docPath = ''
  try {
    docPath = app.getPath('documents')
  } catch {
    docPath = path.join(os.homedir(), 'Documents')
  }
  return path.join(docPath, 'OmegaProjects', 'Omega Media Core', 'Omega Wave Recorder')
}

export function getSettingsPath(): string {
  return path.join(getAppDataDir(), 'settings.json')
}

export function ensureDirectoryStructure(): void {
  const documentsDir = getDocumentsDir()
  const appDataDir = getAppDataDir()

  if (!fs.existsSync(appDataDir)) {
    fs.mkdirSync(appDataDir, { recursive: true })
  }

  const subDirs = ['Projects', 'Recordings', 'Exports', 'AudioTemp', 'Locales', 'Downloads']
  subDirs.forEach((sub) => {
    const fullPath = path.join(documentsDir, sub)
    if (!fs.existsSync(fullPath)) {
      try {
        fs.mkdirSync(fullPath, { recursive: true })
      } catch (err) {
        logger.error('Settings', `Konnte Ordner nicht erstellen: ${fullPath}`, err)
      }
    }
  })
}

function getDefaultSettings(): AppSettings {
  const documentsDir = getDocumentsDir()
  return {
    projPath: path.join(documentsDir, 'Projects'),
    expPath: path.join(documentsDir, 'Exports'),
    recPath: path.join(documentsDir, 'Recordings'),
    tempPath: path.join(documentsDir, 'AudioTemp'),
    dlPath: path.join(documentsDir, 'Downloads'),
    localesPath: path.join(documentsDir, 'Locales'),
    sampleRate: 48000,
    defaultOutputDevice: 'default',
    viewMode: 'multitrack',
    maxTracks: 4,
    language: 'de',
    autoSave: true,
    autoSaveInterval: 5,
    appendMode: 'append',
    mutedWarnings: [],
    recentProjects: [],
    waveformColor: '#0078d7'
  }
}

export function loadSettings(): AppSettings {
  ensureDirectoryStructure()
  const settingsPath = getSettingsPath()
  const defaults = getDefaultSettings()

  try {
    if (fs.existsSync(settingsPath)) {
      const raw = fs.readFileSync(settingsPath, 'utf-8')
      const parsed = JSON.parse(raw)
      return { ...defaults, ...parsed }
    } else {
      fs.writeFileSync(settingsPath, JSON.stringify(defaults, null, 2), 'utf-8')
      return defaults
    }
  } catch (err) {
    logger.error('Settings', 'Fehler beim Laden von settings.json, nutze Standardwerte', err)
    return defaults
  }
}

export function saveSettings(newSettings: Partial<AppSettings>): boolean {
  try {
    ensureDirectoryStructure()
    const settingsPath = getSettingsPath()
    const current = loadSettings()
    const merged = { ...current, ...newSettings }
    fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2), 'utf-8')
    logger.info('Settings', 'Einstellungen erfolgreich gespeichert')
    return true
  } catch (err) {
    logger.error('Settings', 'Fehler beim Speichern der Einstellungen', err)
    return false
  }
}

const defaultDeLocale = {
  app: {
    name: "Omega Wave Recorder",
    version_title: "Omega Wave Recorder — Studio Multitrack Audio Recorder",
    tagline: "Präziser Mehrspur-Audiorecorder für Omega Media Core"
  },
  menu: {
    file: "Datei",
    new_project: "Neues Projekt",
    open_project: "Projekt öffnen...",
    save_project: "Projekt speichern",
    save_project_as: "Speichern unter...",
    export_audio: "Audio exportieren...",
    settings: "Einstellungen",
    quit: "Beenden",
    edit: "Bearbeiten",
    undo: "Rückgängig",
    redo: "Wiederholen",
    cut: "Bereich schneiden",
    delete_before: "Vor Abspielposition löschen",
    delete_after: "Nach Abspielposition löschen",
    delete: "Löschen",
    help: "Hilfe",
    manual: "Benutzerhandbuch",
    changelog: "Changelog",
    check_updates: "Auf Updates prüfen",
    logs: "Logs anzeigen",
    feedback: "Feedback senden",
    about: "Über Omega Wave Recorder",
    support_paypal: "❤️ Projekt unterstützen (PayPal)"
  },
  transport: {
    play: "Wiedergabe",
    pause: "Pause",
    stop: "Stopp",
    record: "Aufnahme",
    rewind_start: "An den Anfang",
    forward_end: "Ans Ende",
    step_back: "1 Sekunde zurück",
    step_forward: "1 Sekunde vor",
    append_mode: "Anhängen (Append)",
    cursor_mode: "Ab Cursor"
  },
  tracks: {
    track: "Spur",
    arm: "Scharfschalten",
    mute: "Stumm (M)",
    solo: "Solo (S)",
    volume: "Lautstärke",
    input: "Audioquelle",
    hardware_inputs: "Audiogeräte",
    application_inputs: "Laufende Programme (Loopback)",
    no_tracks_armed: "Keine Spur für die Aufnahme scharfgeschaltet!"
  },
  export: {
    title: "Audio exportieren",
    format: "Format",
    sample_rate: "Samplerate",
    bitrate: "Bitrate",
    mode: "Export-Modus",
    master_mixdown: "Master-Mixdown (alle Spuren)",
    stems: "Einzelspuren (Stems exportieren)",
    id3_tags: "Metadaten & ID3v2-Tags",
    id3_title: "Titel",
    id3_artist: "Interpret / Artist",
    id3_album: "Album",
    id3_year: "Jahr",
    id3_genre: "Genre",
    id3_track: "Track-Nummer",
    id3_comment: "Kommentar",
    cover_art: "Cover-Bild (JPG/PNG)",
    select_cover: "Bild wählen...",
    start_export: "Exportieren"
  },
  settings: {
    title: "Einstellungen",
    general: "Allgemein",
    audio: "Audio-Routing",
    language: "Sprache",
    warnings: "Meldungen & Warnungen",
    open_locales_folder: "Sprachordner im Explorer öffnen",
    default_sample_rate: "Standard-Samplerate",
    output_device: "Master-Audioausgang",
    reset_warnings: "Alle stummgeschalteten Warnungen zurücksetzen",
    save: "Speichern",
    cancel: "Abbrechen"
  },
  notifications: {
    process_closed: "{{process}} wurde geschlossen. Die Spur nimmt Stille auf und wartet auf Reconnect.",
    dont_show_again: "Diesen Hinweis nicht mehr anzeigen",
    recording_saved: "Aufnahme erfolgreich gespeichert."
  }
}

const defaultEnLocale = {
  app: {
    name: "Omega Wave Recorder",
    version_title: "Omega Wave Recorder — Studio Multitrack Audio Recorder",
    tagline: "Lean Multitrack Audio Recorder for Omega Media Core"
  },
  menu: {
    file: "File",
    new_project: "New Project",
    open_project: "Open Project...",
    save_project: "Save Project",
    save_project_as: "Save As...",
    export_audio: "Export Audio...",
    settings: "Settings",
    quit: "Exit",
    edit: "Edit",
    undo: "Undo",
    redo: "Redo",
    cut: "Cut Selection",
    delete_before: "Delete Before Playhead",
    delete_after: "Delete After Playhead",
    delete: "Delete",
    help: "Help",
    manual: "User Manual",
    changelog: "Changelog",
    check_updates: "Check for Updates",
    logs: "View Logs",
    feedback: "Send Feedback",
    about: "About Omega Wave Recorder",
    support_paypal: "❤️ Support Project (PayPal)"
  },
  transport: {
    play: "Play",
    pause: "Pause",
    stop: "Stop",
    record: "Record",
    rewind_start: "Rewind to Start",
    forward_end: "Forward to End",
    step_back: "1 Second Back",
    step_forward: "1 Second Forward",
    append_mode: "Append Mode",
    cursor_mode: "Cursor Mode"
  },
  tracks: {
    track: "Track",
    arm: "Arm Recording",
    mute: "Mute (M)",
    solo: "Solo (S)",
    volume: "Volume",
    input: "Audio Input",
    hardware_inputs: "Audio Devices",
    application_inputs: "Running Applications (Loopback)",
    no_tracks_armed: "No tracks armed for recording!"
  },
  export: {
    title: "Export Audio",
    format: "Format",
    sample_rate: "Sample Rate",
    bitrate: "Bitrate",
    mode: "Export Mode",
    master_mixdown: "Master Mixdown (All Tracks)",
    stems: "Individual Tracks (Export Stems)",
    id3_tags: "Metadata & ID3v2 Tags",
    id3_title: "Title",
    id3_artist: "Artist",
    id3_album: "Album",
    id3_year: "Year",
    id3_genre: "Genre",
    id3_track: "Track Number",
    id3_comment: "Comment",
    cover_art: "Cover Art (JPG/PNG)",
    select_cover: "Select Image...",
    start_export: "Export"
  },
  settings: {
    title: "Settings",
    general: "General",
    audio: "Audio Routing",
    language: "Language",
    warnings: "Notifications & Warnings",
    open_locales_folder: "Open Locales Folder in Explorer",
    default_sample_rate: "Default Sample Rate",
    output_device: "Master Audio Output",
    reset_warnings: "Reset All Dismissed Warnings",
    save: "Save",
    cancel: "Cancel"
  },
  notifications: {
    process_closed: "{{process}} was closed. Track is recording silence and awaiting reconnect.",
    dont_show_again: "Do not show this message again",
    recording_saved: "Recording successfully saved."
  }
}

const customExampleLocale = {
  app: {
    name: "Omega Wave Recorder [Custom]",
    tagline: "Translate this into your custom language."
  },
  menu: {
    file: "Custom File",
    settings: "Custom Settings"
  }
}

export function setupSettingsIpc(): void {
  ensureDirectoryStructure()

  ipcMain.handle('get-settings', () => {
    return loadSettings()
  })

  ipcMain.handle('save-settings', (_, settings: Partial<AppSettings>) => {
    return saveSettings(settings)
  })

  ipcMain.handle('get-locales', () => {
    const documentsDir = getDocumentsDir()
    const localesDir = path.join(documentsDir, 'Locales')

    if (!fs.existsSync(localesDir)) {
      fs.mkdirSync(localesDir, { recursive: true })
    }

    const dePath = path.join(localesDir, 'de.json')
    const enPath = path.join(localesDir, 'en.json')
    const examplePath = path.join(localesDir, 'custom_example.json')

    // Generate defaults if missing
    if (!fs.existsSync(dePath)) {
      fs.writeFileSync(dePath, JSON.stringify(defaultDeLocale, null, 2), 'utf-8')
    }
    if (!fs.existsSync(enPath)) {
      fs.writeFileSync(enPath, JSON.stringify(defaultEnLocale, null, 2), 'utf-8')
    }
    if (!fs.existsSync(examplePath)) {
      fs.writeFileSync(examplePath, JSON.stringify(customExampleLocale, null, 2), 'utf-8')
    }

    const locales: Record<string, any> = {}
    try {
      const files = fs.readdirSync(localesDir)
      for (const file of files) {
        if (file.endsWith('.json')) {
          const langCode = path.basename(file, '.json')
          try {
            const content = fs.readFileSync(path.join(localesDir, file), 'utf-8')
            locales[langCode] = JSON.parse(content)
          } catch (err) {
            logger.error('Settings', `Fehler beim Parsen der Sprachdatei ${file}`, err)
          }
        }
      }
    } catch (err) {
      logger.error('Settings', 'Fehler beim Lesen des Locales-Ordners', err)
    }

    return locales
  })

  ipcMain.handle('save-locale', (_, { lang, content }: { lang: string; content: any }) => {
    if (!lang || typeof lang !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(lang)) {
      return { success: false, error: 'Ungültiger Sprachcode' }
    }

    try {
      const documentsDir = getDocumentsDir()
      const localesDir = path.join(documentsDir, 'Locales')
      if (!fs.existsSync(localesDir)) {
        fs.mkdirSync(localesDir, { recursive: true })
      }

      const filePath = path.join(localesDir, `${lang}.json`)
      fs.writeFileSync(filePath, JSON.stringify(content, null, 2), 'utf-8')
      logger.info('Settings', `Sprachpaket ${lang} erfolgreich gespeichert`)
      return { success: true }
    } catch (err: any) {
      logger.error('Settings', `Fehler beim Speichern des Sprachpakets ${lang}`, err)
      return { success: false, error: err.message }
    }
  })

  // Returns array of available locale codes (e.g. ['de', 'en', 'custom_example'])
  ipcMain.handle('get-available-locales', () => {
    const documentsDir = getDocumentsDir()
    const localesDir = path.join(documentsDir, 'Locales')
    if (!fs.existsSync(localesDir)) return ['de', 'en']
    try {
      const files = fs.readdirSync(localesDir)
      const list = files
        .filter((f) => f.endsWith('.json'))
        .map((f) => path.basename(f, '.json'))
      return list.length > 0 ? list : ['de', 'en']
    } catch {
      return ['de', 'en']
    }
  })

  // Opens the Locales directory in Windows Explorer
  ipcMain.handle('open-locales-folder', async () => {
    const documentsDir = getDocumentsDir()
    const localesDir = path.join(documentsDir, 'Locales')
    if (!fs.existsSync(localesDir)) {
      fs.mkdirSync(localesDir, { recursive: true })
    }
    const { shell } = await import('electron')
    await shell.openPath(localesDir)
    return true
  })

  let startCpuUsage = process.cpuUsage()
  let startTime = process.hrtime()

  ipcMain.handle('get-performance-stats', async () => {
    try {
      const totalMem = os.totalmem()
      const freeMem = os.freemem()
      const systemRamPct = Math.round(((totalMem - freeMem) / totalMem) * 100)
      const processRamBytes = process.memoryUsage().heapUsed

      const elapCpu = process.cpuUsage(startCpuUsage)
      const elapTime = process.hrtime(startTime)
      startCpuUsage = process.cpuUsage()
      startTime = process.hrtime()

      const elapTimeMs = elapTime[0] * 1000 + elapTime[1] / 1000000
      const elapCpuMs = (elapCpu.user + elapCpu.system) / 1000
      const cpuPercent = elapTimeMs > 0 ? Math.min(100, Math.round((elapCpuMs / elapTimeMs) * 100)) : 0

      return {
        cpuUsage: cpuPercent,
        processRamBytes,
        systemRamPct
      }
    } catch (err) {
      return {
        cpuUsage: 0,
        processRamBytes: 0,
        systemRamPct: 0
      }
    }
  })
}
