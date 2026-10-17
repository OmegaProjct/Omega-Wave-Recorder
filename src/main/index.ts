import { app, BrowserWindow, protocol, session } from 'electron'
import { join } from 'path'
import * as fs from 'fs'
import { logger, registerLogIpc } from './logger'
import { setupSettingsIpc, ensureDirectoryStructure } from './settingsIpc'
import { registerSystemIpc } from './ipc/systemIpc'
import { registerAudioIpc } from './ipc/audioIpc'
import { registerLoopbackIpc } from './ipc/loopbackIpc'
import { registerProjectIpc, setStartupFile } from './ipc/projectIpc'
import { setupUpdateDownloader } from './updateDownloader'

// Configure custom AppData folder: AppData/Roaming/OmegaProjects/Omega Media Core/Omega Wave Recorder
const appDataPath = app.getPath('appData')
const customUserDataPath = join(appDataPath, 'OmegaProjects', 'Omega Media Core', 'Omega Wave Recorder')
app.setPath('userData', customUserDataPath)

// Initialize session-based logger and global error handlers
logger.init()
registerLogIpc()

process.on('uncaughtException', (err) => {
  logger.error('System', 'Uncaught Exception im Hauptprozess', err)
})
process.on('unhandledRejection', (reason) => {
  logger.error('System', 'Unhandled Rejection im Hauptprozess', reason)
})

logger.info('System', 'Omega Wave Recorder Hauptprozess startet', {
  version: app.getVersion(),
  platform: process.platform,
  arch: process.arch,
  argv: process.argv
})

// Helper to extract project file (*.owrp or *.owep) from command-line arguments
function findProjectFile(args: string[]): string | null {
  for (const arg of args) {
    if (arg.endsWith('.owrp') || arg.endsWith('.owep')) {
      try {
        if (fs.existsSync(arg)) {
          return join(arg)
        }
      } catch {
        return arg
      }
    }
  }
  return null
}

const initialFile = findProjectFile(process.argv)
if (initialFile) {
  setStartupFile(initialFile)
  logger.info('System', 'Startdatei übergeben', { file: initialFile })
}

// Enforce Single-Instance Lock
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  logger.warn('System', 'Zweite Instanz erkannt. Beende diesen Prozess.')
  app.quit()
}

let mainWindow: BrowserWindow | null = null

function createMainWindow(): BrowserWindow {
  ensureDirectoryStructure()

  const appRoot = app.getAppPath()
  const iconPath = join(appRoot, 'assets', 'app_icon.png')
  const fallbackIconPath = join(appRoot, 'assets', 'logo.png')
  const icon = fs.existsSync(iconPath) ? iconPath : fs.existsSync(fallbackIconPath) ? fallbackIconPath : undefined

  mainWindow = new BrowserWindow({
    width: 920,
    height: 580,
    minWidth: 520,
    minHeight: 340,
    center: true,
    frame: false,
    backgroundColor: '#1a1d21',
    show: false,
    autoHideMenuBar: true,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })

  // Register all IPC modules
  setupSettingsIpc()
  registerSystemIpc()
  registerAudioIpc()
  registerLoopbackIpc()
  registerProjectIpc()
  setupUpdateDownloader(mainWindow)

  mainWindow.once('ready-to-show', () => {
    if (mainWindow) {
      mainWindow.center()
      mainWindow.show()
      mainWindow.setAlwaysOnTop(true)
      mainWindow.focus()
      mainWindow.setAlwaysOnTop(false)
      logger.info('System', 'Hauptfenster wird zentriert angezeigt und in den Vordergrund geholt')
    }
  })

  // Safety fallback timeout ensuring window is displayed
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.center()
      mainWindow.show()
      mainWindow.setAlwaysOnTop(true)
      mainWindow.focus()
      mainWindow.setAlwaysOnTop(false)
      logger.info('System', 'Hauptfenster über Timeout forciert angezeigt')
    }
  }, 1200)

  mainWindow.on('closed', () => {
    mainWindow = null
    logger.info('System', 'Hauptfenster geschlossen')
  })

  // Maximize / Unmaximize window state notification to renderer
  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window-maximize-changed', true)
  })
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window-maximize-changed', false)
  })

  // Load renderer view (dev server or production index.html)
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

if (gotTheLock) {
  app.on('second-instance', (_event, commandLine) => {
    logger.info('System', 'Zweite Instanz versucht zu starten, fokussiere existierendes Fenster')
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()

      const projectFile = findProjectFile(commandLine)
      if (projectFile) {
        mainWindow.webContents.send('open-project-from-association', projectFile)
      }
    }
  })

  app.whenReady().then(() => {
    logger.info('System', 'Electron app ready, erstelle Hauptfenster')
    createMainWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow()
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      logger.info('System', 'Alle Fenster geschlossen, beende Anwendung')
      app.quit()
    }
  })
}
