import { ipcMain, shell, app, BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { logger } from '../logger'
import { isSafePath, isSafeUrl } from '../utils/pathUtils'

export function registerSystemIpc(): void {
  // Window Controls
  ipcMain.on('minimize-window', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.minimize()
  })

  ipcMain.handle('minimize-window', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.minimize()
    return true
  })

  ipcMain.on('maximize-window', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize()
      } else {
        win.maximize()
      }
    }
  })

  ipcMain.handle('maximize-window', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize()
        return false
      } else {
        win.maximize()
        return true
      }
    }
    return false
  })

  ipcMain.on('close-window', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.close()
  })

  ipcMain.handle('close-window', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.close()
    return true
  })

  ipcMain.handle('is-maximized', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win ? win.isMaximized() : false
  })

  // External URLs (Strict HTTPS/HTTP only)
  ipcMain.handle('open-external-link', async (_, url: string) => {
    if (!isSafeUrl(url)) {
      logger.warn('System', 'Versuch, unsichere URL zu öffnen blockiert', { url })
      return { success: false, error: 'Ungültige oder unsichere URL' }
    }
    try {
      await shell.openExternal(url)
      return { success: true }
    } catch (err: any) {
      logger.error('System', `Fehler beim Öffnen von ${url}`, err)
      return { success: false, error: err.message }
    }
  })

  // Open directory or file in Windows Explorer
  ipcMain.handle('open-path', async (_, targetPath: string) => {
    if (!isSafePath(targetPath)) {
      logger.warn('System', 'Ungültiger Pfad für open-path abgelehnt', { targetPath })
      return { success: false, error: 'Ungültiger Pfad' }
    }
    try {
      const resolved = path.resolve(targetPath)
      if (!fs.existsSync(resolved)) {
        return { success: false, error: 'Pfad existiert nicht' }
      }
      const err = await shell.openPath(resolved)
      if (err) {
        return { success: false, error: err }
      }
      return { success: true }
    } catch (err: any) {
      logger.error('System', `Fehler beim Öffnen des Pfads: ${targetPath}`, err)
      return { success: false, error: err.message }
    }
  })

  // App version
  ipcMain.handle('get-app-version', () => {
    return app.getVersion()
  })

  // Read CHANGELOG.md
  ipcMain.handle('read-changelog', async () => {
    const candidates = [
      path.join(process.resourcesPath, 'CHANGELOG.md'),
      path.join(app.getAppPath(), 'CHANGELOG.md'),
      path.join(__dirname, '../../CHANGELOG.md'),
      path.join(__dirname, '../../../CHANGELOG.md')
    ]
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) {
          return fs.readFileSync(p, 'utf-8')
        }
      } catch {}
    }
    return ''
  })

  // Show item in Windows Explorer folder
  ipcMain.handle('show-item-in-folder', async (_, filePath: string) => {
    if (!isSafePath(filePath)) return { success: false, error: 'Ungültiger Pfad' }
    try {
      const resolved = path.resolve(filePath)
      if (!fs.existsSync(resolved)) {
        return { success: false, error: 'Datei oder Ordner existiert nicht' }
      }
      shell.showItemInFolder(resolved)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Delete file to recycle bin
  ipcMain.handle('delete-file', async (_, filePath: string) => {
    if (!isSafePath(filePath)) return { success: false, error: 'Ungültiger Pfad' }
    try {
      const resolved = path.resolve(filePath)
      if (!fs.existsSync(resolved)) {
        return { success: false, error: 'Datei oder Ordner existiert nicht' }
      }
      await shell.trashItem(resolved)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Path helpers
  ipcMain.handle('get-home-dir', () => {
    return os.homedir()
  })

  // Open logs folder
  ipcMain.handle('open-logs-folder', async () => {
    await logger.openFolder()
    return true
  })

  // Submit user feedback
  ipcMain.handle('submit-feedback', async (_, feedbackData: any) => {
    logger.info('Feedback', 'Nutzer-Feedback eingegangen', feedbackData)
    try {
      const logsDir = path.dirname(logger.getLogPath())
      const feedbackFile = path.join(logsDir, `feedback_${Date.now()}.json`)
      await fs.promises.writeFile(feedbackFile, JSON.stringify(feedbackData, null, 2), 'utf-8')
      return { success: true }
    } catch (err: any) {
      logger.error('Feedback', 'Fehler beim Speichern des Feedbacks', err)
      return { success: false, error: err.message }
    }
  })
}
