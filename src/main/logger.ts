import { app, shell, ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface SessionLogInfo {
  filename: string
  size: number
  mtime: number
}

class Logger {
  private logFilePath: string = ''
  private logDir: string = ''
  private initialized: boolean = false

  private getFormattedTimestamp(): string {
    const now = new Date()
    const pad = (n: number) => n.toString().padStart(2, '0')
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
  }

  /**
   * Initializes the logging directory and session-based log file.
   * Cleans up old logs keeping maximum 30 session files.
   */
  init(): void {
    if (this.initialized) return

    try {
      let appDataPath = ''
      try {
        appDataPath = app.getPath('appData')
      } catch {
        appDataPath = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
      }

      this.logDir = path.join(
        appDataPath,
        'OmegaProjects',
        'Omega Media Core',
        'Omega Wave Recorder',
        'logs'
      )

      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true })
      }

      this.logFilePath = path.join(this.logDir, `session_${this.getFormattedTimestamp()}.log`)

      // Auto-cleanup: keep only newest 30 session log files
      this.cleanupOldLogs(30)

      this.initialized = true
      this.info('System', '=== OMEGA WAVE RECORDER LOGGING INITIALIZED ===')
    } catch (err) {
      console.error('Failed to initialize logger:', err)
    }
  }

  /**
   * Cleans up older session logs, retaining only the most recent N files.
   */
  private cleanupOldLogs(maxLogs: number = 30): void {
    try {
      if (!fs.existsSync(this.logDir)) return

      const files = fs.readdirSync(this.logDir)
        .filter((f) => f.startsWith('session_') && f.endsWith('.log'))
        .map((f) => {
          const filePath = path.join(this.logDir, f)
          try {
            return {
              name: f,
              path: filePath,
              mtime: fs.statSync(filePath).mtimeMs
            }
          } catch {
            return null
          }
        })
        .filter((item): item is { name: string; path: string; mtime: number } => item !== null)
        .sort((a, b) => b.mtime - a.mtime)

      if (files.length > maxLogs) {
        const toDelete = files.slice(maxLogs)
        for (const file of toDelete) {
          try {
            fs.unlinkSync(file.path)
          } catch (err) {
            console.error(`Error deleting old log file ${file.name}:`, err)
          }
        }
      }
    } catch (err) {
      console.error('Error during log file cleanup:', err)
    }
  }

  getLogPath(): string {
    if (!this.initialized) this.init()
    return this.logFilePath
  }

  /**
   * Writes a log entry to file and console.
   */
  write(level: LogLevel, moduleName: string, message: string, details?: any): void {
    if (!this.initialized) {
      this.init()
    }

    const timestamp = new Date().toISOString()
    const levelStr = level.toUpperCase().padEnd(5)
    const moduleStr = moduleName.toUpperCase()

    let detailStr = ''
    if (details !== undefined) {
      if (details instanceof Error) {
        detailStr = `\n${details.stack || details.message}`
      } else if (typeof details === 'object') {
        try {
          detailStr = ` | Details: ${JSON.stringify(details)}`
        } catch {
          detailStr = ` | Details: [Unserializable Object]`
        }
      } else {
        detailStr = ` | Details: ${details}`
      }
    }

    const logLine = `[${timestamp}] [${levelStr}] [${moduleStr}] ${message}${detailStr}\n`

    if (level === 'error') {
      console.error(logLine.trim())
    } else if (level === 'warn') {
      console.warn(logLine.trim())
    } else {
      console.log(logLine.trim())
    }

    if (this.logFilePath) {
      try {
        fs.appendFileSync(this.logFilePath, logLine, 'utf-8')
      } catch (err) {
        console.error('Failed to write to log file:', err)
      }
    }
  }

  debug(moduleName: string, message: string, details?: any): void {
    this.write('debug', moduleName, message, details)
  }

  info(moduleName: string, message: string, details?: any): void {
    this.write('info', moduleName, message, details)
  }

  warn(moduleName: string, message: string, details?: any): void {
    this.write('warn', moduleName, message, details)
  }

  error(moduleName: string, message: string, details?: any): void {
    this.write('error', moduleName, message, details)
  }

  /**
   * Retrieves the most recent log lines.
   */
  getRecentLogs(limit: number = 100): string[] {
    if (!this.initialized) this.init()
    if (!this.logFilePath || !fs.existsSync(this.logFilePath)) return []

    try {
      const content = fs.readFileSync(this.logFilePath, 'utf-8')
      const lines = content.split('\n').filter((l) => l.trim().length > 0)
      return lines.slice(-limit)
    } catch (err) {
      this.error('Logger', 'Failed to read recent logs', err)
      return []
    }
  }

  /**
   * Clears current log or a specified file.
   */
  clearLogs(filename?: string): void {
    if (!this.initialized) this.init()
    if (filename && path.basename(filename) !== filename) {
      throw new Error('Ungültiger Dateiname')
    }

    const targetFile = filename ? path.join(this.logDir, filename) : this.logFilePath
    if (targetFile && fs.existsSync(targetFile)) {
      try {
        fs.writeFileSync(targetFile, '', 'utf-8')
        this.info('Logger', `--- LOG ZURÜCKGESETZT: ${path.basename(targetFile)} ---`)
      } catch (err) {
        this.error('Logger', `Fehler beim Leeren der Logdatei ${path.basename(targetFile)}`, err)
      }
    }
  }

  /**
   * Opens the logs directory in Windows Explorer.
   */
  async openFolder(): Promise<void> {
    if (!this.initialized) this.init()
    if (this.logDir && fs.existsSync(this.logDir)) {
      await shell.openPath(this.logDir)
    }
  }

  /**
   * Returns complete content of a log file.
   */
  getLogContent(filename?: string): string {
    if (!this.initialized) this.init()
    if (filename && path.basename(filename) !== filename) {
      throw new Error('Ungültiger Dateiname')
    }

    const targetFile = filename ? path.join(this.logDir, filename) : this.logFilePath
    if (targetFile && fs.existsSync(targetFile)) {
      try {
        return fs.readFileSync(targetFile, 'utf-8')
      } catch (err) {
        return `Fehler beim Lesen der Log-Datei: ${err}`
      }
    }
    return 'Log-Datei existiert nicht.'
  }

  /**
   * Lists all session log files in descending chronological order.
   */
  listSessionLogs(): SessionLogInfo[] {
    if (!this.initialized) this.init()
    if (!fs.existsSync(this.logDir)) return []

    try {
      const files = fs.readdirSync(this.logDir)
      return files
        .filter((f) => f.startsWith('session_') && f.endsWith('.log'))
        .map((f) => {
          const filePath = path.join(this.logDir, f)
          const stats = fs.statSync(filePath)
          return {
            filename: f,
            size: stats.size,
            mtime: stats.mtimeMs
          }
        })
        .sort((a, b) => b.mtime - a.mtime)
    } catch (err) {
      console.error('Failed to list session logs:', err)
      return []
    }
  }

  /**
   * Deletes a specific session log file.
   */
  deleteSessionLog(filename: string): boolean {
    if (!this.initialized) this.init()
    if (path.basename(filename) !== filename || !filename.endsWith('.log')) {
      return false
    }

    const targetPath = path.join(this.logDir, filename)
    try {
      if (fs.existsSync(targetPath)) {
        if (targetPath === this.logFilePath) {
          this.clearLogs()
          return true
        }
        fs.unlinkSync(targetPath)
        return true
      }
      return false
    } catch (err) {
      console.error(`Failed to delete session log ${filename}:`, err)
      return false
    }
  }
}

export const logger = new Logger()

/**
 * Registers IPC handlers for logging.
 */
export function registerLogIpc(): void {
  ipcMain.handle('write-log', (_, level: LogLevel, moduleName: string, message: string, details?: any) => {
    logger.write(level, moduleName, message, details)
    return true
  })

  ipcMain.handle('get-log-path', () => logger.getLogPath())
  ipcMain.handle('get-recent-logs', (_, limit?: number) => logger.getRecentLogs(limit))
  ipcMain.handle('get-log-content', (_, filename?: string) => logger.getLogContent(filename))
  ipcMain.handle('clear-log', (_, filename?: string) => {
    logger.clearLogs(filename)
    return true
  })
  ipcMain.handle('get-session-logs', () => logger.listSessionLogs())
  ipcMain.handle('delete-session-log', (_, filename: string) => logger.deleteSessionLog(filename))
  ipcMain.handle('open-log-folder', async () => {
    await logger.openFolder()
    return true
  })
}
