import { ipcMain, desktopCapturer, BrowserWindow } from 'electron'
import { exec } from 'child_process'
import { logger } from '../logger'
import {
  resolveWindowProcessId,
  startProcessLoopback,
  stopProcessLoopback
} from './processLoopback'

export interface VisibleAppWindow {
  id: string
  title: string
  name: string
  processName: string
  pid: number
  iconUrl?: string
}

let monitoredProcesses = new Map<string, { pid?: number; processName: string; interval: NodeJS.Timeout }>()

/**
 * Checks if a process is running on Windows by PID or Process Name.
 */
function checkProcessAlive(pid?: number, processName?: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (pid && pid > 0) {
      try {
        // process.kill with 0 tests for existence without killing
        process.kill(pid, 0)
        return resolve(true)
      } catch (err: any) {
        if (err.code === 'EPERM') return resolve(true)
        if (err.code === 'ESRCH') return resolve(false)
      }
    }

    if (processName) {
      const cleanName = processName.replace(/["'\\]/g, '')
      exec(`tasklist /FI "IMAGENAME eq ${cleanName}" /NH`, (err, stdout) => {
        if (err || !stdout) return resolve(false)
        const isRunning = stdout.toLowerCase().includes(cleanName.toLowerCase())
        resolve(isRunning)
      })
      return
    }

    resolve(false)
  })
}

/**
 * Helper to fetch list of running processes with window handles / names.
 */
async function getRunningProcessMap(): Promise<Map<string, { pid: number; name: string }>> {
  const map = new Map<string, { pid: number; name: string }>()
  return new Promise((resolve) => {
    // tasklist /fo csv /nh
    exec('tasklist /FO CSV /NH', (err, stdout) => {
      if (err || !stdout) {
        return resolve(map)
      }
      const lines = stdout.split('\r\n')
      for (const line of lines) {
        if (!line.trim()) continue
        // Format: "Image Name","PID","Session Name","Session#","Mem Usage"
        const parts = line.split('","').map((s) => s.replace(/(^"|"$)/g, '').trim())
        if (parts.length >= 2) {
          const name = parts[0]
          const pid = parseInt(parts[1], 10)
          if (name && !isNaN(pid)) {
            map.set(name.toLowerCase(), { pid, name })
          }
        }
      }
      resolve(map)
    })
  })
}

export function registerLoopbackIpc(): void {
  // Scans and returns all visible application windows for audio loopback
  ipcMain.handle('get-visible-windows', async () => {
    logger.debug('Loopback', 'Scanne sichtbare Anwendungsfenster')
    try {
      const [sources, processMap] = await Promise.all([
        desktopCapturer.getSources({ types: ['window'], fetchWindowIcons: true }),
        getRunningProcessMap().catch(() => new Map<string, { pid: number; name: string }>())
      ])

      const pidToName = new Map<number, string>()
      for (const info of processMap.values()) {
        pidToName.set(info.pid, info.name)
      }

      const windows: VisibleAppWindow[] = await Promise.all(
        sources
          .filter((source) => source.name && source.name.trim() !== '')
          .map(async (source) => {
            let detectedProcessName = 'Application.exe'
            let detectedPid = 0

            // Extract window HWND handle from desktopCapturer source.id (format "window:HWND:index" or "window:HWND")
            const idParts = source.id.split(':')
            const hwndStr = idParts.length >= 2 ? idParts[1] : null

            if (hwndStr && /^\d+$/.test(hwndStr) && hwndStr !== '0') {
              try {
                detectedPid = await resolveWindowProcessId(hwndStr)
              } catch (err) {
                logger.debug('Loopback', `Could not resolve PID for HWND ${hwndStr}:`, err)
              }
            }

            // If PID was resolved, look up exact process name from running processes
            if (detectedPid > 0 && pidToName.has(detectedPid)) {
              detectedProcessName = pidToName.get(detectedPid)!
            } else {
              // Heuristic fallback matching with running process map
              const lowerTitle = source.name.toLowerCase()
              for (const [procKey, procInfo] of processMap.entries()) {
                const baseName = procKey.replace('.exe', '')
                if (lowerTitle.includes(baseName) || baseName.includes(lowerTitle)) {
                  detectedProcessName = procInfo.name
                  if (detectedPid === 0) detectedPid = procInfo.pid
                  break
                }
              }

              // Common application title matches
              if (detectedProcessName === 'Application.exe') {
                if (lowerTitle.includes('spotify')) {
                  detectedProcessName = 'Spotify.exe'
                } else if (lowerTitle.includes('discord')) {
                  detectedProcessName = 'Discord.exe'
                } else if (lowerTitle.includes('chrome')) {
                  detectedProcessName = 'chrome.exe'
                } else if (lowerTitle.includes('firefox')) {
                  detectedProcessName = 'firefox.exe'
                } else if (lowerTitle.includes('edge')) {
                  detectedProcessName = 'msedge.exe'
                } else {
                  detectedProcessName = `${source.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.exe`
                }
              }
            }

            const iconUrl = source.appIcon ? source.appIcon.toDataURL() : undefined

            return {
              id: source.id,
              title: source.name,
              name: source.name,
              processName: detectedProcessName,
              pid: detectedPid,
              iconUrl
            }
          })
      )

      logger.debug('Loopback', `${windows.length} sichtbare Fenster gefunden`)
      return windows
    } catch (err: any) {
      logger.error('Loopback', 'Fehler beim Scannen der Fenster', err)
      return []
    }
  })

  // Start monitoring a target process for disconnection / reconnect detection
  ipcMain.handle('start-process-monitoring', (event, { processName, pid }: { processName: string; pid?: number }) => {
    logger.info('Loopback', `Starte Überwachung für ${processName} (PID: ${pid})`)
    const targetWebContents = event.sender
    const key = `${processName}_${pid || 0}`

    if (monitoredProcesses.has(key)) {
      clearInterval(monitoredProcesses.get(key)!.interval)
    }

    let wasAlive = true
    const interval = setInterval(async () => {
      const isAlive = await checkProcessAlive(pid, processName)
      if (wasAlive && !isAlive) {
        wasAlive = false
        logger.warn('Loopback', `Prozess getrennt: ${processName}`)
        if (!targetWebContents.isDestroyed()) {
          targetWebContents.send('loopback:process-status', {
            processName,
            pid,
            status: 'closed'
          })
        }
      } else if (!wasAlive && isAlive) {
        wasAlive = true
        logger.info('Loopback', `Prozess wiederverbunden: ${processName}`)
        if (!targetWebContents.isDestroyed()) {
          targetWebContents.send('loopback:process-status', {
            processName,
            pid,
            status: 'reconnected'
          })
        }
      }
    }, 1500)

    monitoredProcesses.set(key, { pid, processName, interval })
    return { success: true }
  })

  // Stop monitoring target process
  ipcMain.handle('stop-process-monitoring', (_, { processName, pid }: { processName: string; pid?: number }) => {
    const key = `${processName}_${pid || 0}`
    const entry = monitoredProcesses.get(key)
    if (entry) {
      clearInterval(entry.interval)
      monitoredProcesses.delete(key)
      logger.info('Loopback', `Überwachung gestoppt für ${processName}`)
    }
    return { success: true }
  })

  // Start loopback capture for a specific PID and track
  ipcMain.handle('start-loopback-capture', async (event, pid: number, trackId?: string) => {
    logger.info('Loopback', `Starte Loopback-Erfassung für PID ${pid} (Spur: ${trackId})`)
    if (!trackId || typeof trackId !== 'string') {
      return {
        success: false,
        error: 'Ungültige Spur-ID für Loopback-Erfassung',
        unsupported: false
      }
    }

    try {
      const result = await startProcessLoopback(pid, trackId, event.sender)
      return result
    } catch (err: any) {
      const msg = err?.message || 'WASAPI Loopback capture failed'
      const isUnsupported =
        msg.includes('Windows build 20348 or higher required') ||
        msg.includes('only supported on Windows') ||
        msg.includes('not supported')
      logger.warn('Loopback', `Loopback nicht unterstützt oder fehlgeschlagen für PID ${pid} (Spur: ${trackId}): ${msg}`)
      return {
        success: false,
        error: msg,
        unsupported: isUnsupported
      }
    }
  })

  // Stop loopback capture
  ipcMain.handle('stop-loopback-capture', async (_, pid: number, trackId?: string) => {
    logger.info('Loopback', `Stoppe Loopback-Erfassung für PID ${pid} (Spur: ${trackId})`)
    try {
      return await stopProcessLoopback(pid, trackId)
    } catch (err: any) {
      logger.warn('Loopback', `Fehler beim Stoppen von Loopback: ${err.message}`)
      return { success: false, error: err.message }
    }
  })

  // Check if process is alive once
  ipcMain.handle('is-process-running', async (_, { processName, pid }: { processName: string; pid?: number }) => {
    return await checkProcessAlive(pid, processName)
  })
}
