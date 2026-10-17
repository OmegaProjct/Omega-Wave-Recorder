import { ipcMain, app, BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { spawn } from 'child_process'
import * as https from 'https'
import * as http from 'http'
import { URL } from 'url'
import { logger } from './logger'
import { getDocumentsDir } from './settingsIpc'

let downloadedInstallerPath: string | null = null
let runInstallerOnQuit = false
let activeDownloadRequest: http.ClientRequest | null = null
let activeFileStream: fs.WriteStream | null = null
let isDownloadCancelled = false

function isNewerVersion(current: string, latest: string): boolean {
  if (!current || !latest) return false
  const parse = (v: string) => {
    const parts = v.replace(/^v/, '').split('.').map((p) => parseInt(p, 10) || 0)
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0]
  }
  const [currMajor, currMinor, currPatch] = parse(current)
  const [lateMajor, lateMinor, latePatch] = parse(latest)

  if (lateMajor > currMajor) return true
  if (lateMajor < currMajor) return false
  if (lateMinor > currMinor) return true
  if (lateMinor < currMinor) return false
  return latePatch > currPatch
}

function executeInstaller(filePath: string): void {
  try {
    logger.info('Updater', `Führe Installer aus: ${filePath}`)
    const isWin = process.platform === 'win32'

    if (isWin) {
      const child = spawn(filePath, [], {
        detached: true,
        stdio: 'ignore'
      })
      child.unref()
    } else if (process.platform === 'darwin') {
      spawn('open', [filePath], {
        detached: true,
        stdio: 'ignore'
      }).unref()
    } else {
      fs.chmodSync(filePath, '755')
      spawn(filePath, [], {
        detached: true,
        stdio: 'ignore'
      }).unref()
    }
  } catch (err) {
    logger.error('Updater', 'Fehler beim Starten des Installers', err)
  }
}

function downloadFileHttps(
  urlStr: string,
  destPath: string,
  onProgress: (percent: number, downloaded: number, total: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    function makeRequest(currentUrl: string, redirectCount = 0) {
      if (redirectCount > 10) {
        reject(new Error('Zu viele Weiterleitungen beim Update-Download'))
        return
      }

      try {
        const parsedUrl = new URL(currentUrl)
        const client = parsedUrl.protocol === 'http:' ? http : https
        const options = {
          protocol: parsedUrl.protocol,
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || (parsedUrl.protocol === 'http:' ? 80 : 443),
          path: parsedUrl.pathname + parsedUrl.search,
          method: 'GET',
          headers: {
            'User-Agent': 'Omega-Wave-Recorder-Updater',
            'Accept': 'application/octet-stream'
          },
          timeout: 45000
        }

        const req = client.request(options, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume()
            const nextUrl = new URL(res.headers.location, currentUrl).toString()
            makeRequest(nextUrl, redirectCount + 1)
            return
          }

          if (res.statusCode !== 200) {
            reject(new Error(`Server meldet HTTP ${res.statusCode}: ${res.statusMessage}`))
            return
          }

          const totalBytes = parseInt(res.headers['content-length'] || '0', 10)
          let downloadedBytes = 0

          const fileStream = fs.createWriteStream(destPath)
          activeFileStream = fileStream

          fileStream.on('error', (err) => {
            activeFileStream = null
            try { fs.unlinkSync(destPath) } catch {}
            reject(err)
          })

          res.on('data', (chunk) => {
            if (isDownloadCancelled) {
              res.destroy()
              fileStream.destroy()
              activeFileStream = null
              activeDownloadRequest = null
              try { fs.unlinkSync(destPath) } catch {}
              reject(new Error('Canceled'))
              return
            }
            fileStream.write(chunk)
            downloadedBytes += chunk.length
            const percent = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0
            onProgress(percent, downloadedBytes, totalBytes)
          })

          res.on('end', () => {
            fileStream.end(() => {
              activeFileStream = null
              activeDownloadRequest = null
              resolve()
            })
          })

          res.on('error', (err) => {
            fileStream.destroy()
            activeFileStream = null
            activeDownloadRequest = null
            try { fs.unlinkSync(destPath) } catch {}
            reject(err)
          })
        })

        activeDownloadRequest = req

        req.on('timeout', () => {
          req.destroy()
          activeDownloadRequest = null
          reject(new Error('Verbindungstimeout beim Download'))
        })

        req.on('error', (err) => {
          activeDownloadRequest = null
          if ((err as any).code === 'ECONNRESET' && isDownloadCancelled) {
            return
          }
          reject(err)
        })

        req.end()
      } catch (err) {
        reject(err)
      }
    }

    makeRequest(urlStr)
  })
}

export function setupUpdateDownloader(mainWindow?: BrowserWindow | null): void {
  // Check for updates
  ipcMain.handle('check-for-updates', async () => {
    const currentVersion = app.getVersion()
    logger.info('Updater', 'Prüfe auf Updates...', { currentVersion })

    try {
      const response = await fetch('https://api.github.com/repos/OmegaProjct/Omega-Wave-Recorder/releases/latest', {
        headers: {
          'User-Agent': 'Omega-Wave-Recorder-Updater',
          'Accept': 'application/vnd.github.v3+json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache'
        },
        cache: 'no-store'
      })

      if (response.status === 404) {
        return {
          available: false,
          currentVersion,
          latestVersion: currentVersion,
          url: 'https://github.com/OmegaProjct/Omega-Wave-Recorder/releases',
          body: ''
        }
      }

      if (!response.ok) {
        throw new Error(`GitHub API meldet Status ${response.status}`)
      }

      const latestRelease: any = await response.json()
      const latestVersion = (latestRelease.tag_name || '').replace(/^v/, '')
      const updateAvailable = isNewerVersion(currentVersion, latestVersion)

      const assets = latestRelease.assets || []
      let downloadUrl = ''

      if (process.platform === 'win32') {
        let targetAsset = assets.find((a: any) => a.name.endsWith('.exe') && !a.name.toLowerCase().includes('portable'))
        if (!targetAsset) {
          targetAsset = assets.find((a: any) => a.name.endsWith('.exe'))
        }
        downloadUrl = targetAsset?.browser_download_url || ''
      }

      return {
        available: updateAvailable,
        updateAvailable,
        currentVersion,
        version: latestRelease.tag_name || latestVersion,
        latestVersion: latestRelease.tag_name || latestVersion,
        url: latestRelease.html_url || 'https://github.com/OmegaProjct/Omega-Wave-Recorder/releases',
        downloadUrl,
        body: latestRelease.body || 'Keine Versionshinweise verfügbar.',
        releaseNotes: latestRelease.body || 'Keine Versionshinweise verfügbar.'
      }
    } catch (err: any) {
      logger.error('Updater', 'Fehler bei der Update-Prüfung', err)
      return {
        error: err.message,
        currentVersion,
        available: false
      }
    }
  })

  // Start download
  ipcMain.handle('start-update-download', async (event, { url, latestVersion }: { url?: string; latestVersion?: string }) => {
    const targetWebContents = event.sender || mainWindow?.webContents
    if (!targetWebContents) {
      throw new Error('Kein Zielfenster für Fortschrittsmeldungen vorhanden')
    }

    try {
      isDownloadCancelled = false
      let downloadUrl = url || ''
      let assetName = ''

      if (downloadUrl && downloadUrl.endsWith('.exe')) {
        assetName = decodeURIComponent(downloadUrl.split('/').pop() || 'Omega-Wave-Recorder-Setup.exe')
      } else {
        const response = await fetch('https://api.github.com/repos/OmegaProjct/Omega-Wave-Recorder/releases/latest', {
          headers: {
            'User-Agent': 'Omega-Wave-Recorder-Updater'
          }
        })
        if (!response.ok) {
          throw new Error(`GitHub API Fehler: HTTP ${response.status}`)
        }
        const data: any = await response.json()
        const assets = data.assets || []
        const targetAsset = assets.find((a: any) => a.name.endsWith('.exe') && !a.name.toLowerCase().includes('portable')) ||
                            assets.find((a: any) => a.name.endsWith('.exe'))

        if (!targetAsset || !targetAsset.browser_download_url) {
          throw new Error('Kein passendes Installationspaket in Release gefunden.')
        }

        downloadUrl = targetAsset.browser_download_url
        assetName = targetAsset.name
      }

      const downloadsDir = path.join(getDocumentsDir(), 'Downloads')
      if (!fs.existsSync(downloadsDir)) {
        fs.mkdirSync(downloadsDir, { recursive: true })
      }

      const tempFilePath = path.join(downloadsDir, assetName)
      downloadedInstallerPath = tempFilePath

      if (fs.existsSync(tempFilePath)) {
        try { fs.unlinkSync(tempFilePath) } catch {}
      }

      logger.info('Updater', `Starte Download von ${downloadUrl} nach ${tempFilePath}`)

      const startTime = Date.now()
      let lastProgressSent = 0

      await downloadFileHttps(downloadUrl, tempFilePath, (percent, downloadedBytes, totalBytes) => {
        const now = Date.now()
        if (now - lastProgressSent > 150 || percent === 100) {
          lastProgressSent = now
          const elapsedSec = (now - startTime) / 1000
          const speedBps = elapsedSec > 0 ? downloadedBytes / elapsedSec : 0
          const remainingBytes = totalBytes - downloadedBytes
          const remainingSeconds = speedBps > 0 ? remainingBytes / speedBps : 0

          if (!targetWebContents.isDestroyed()) {
            targetWebContents.send('download-progress', {
              percent,
              status: 'downloading',
              downloadedBytes,
              totalBytes,
              speedBps,
              remainingSeconds
            })
          }
        }
      })

      if (isDownloadCancelled) {
        throw new Error('Canceled')
      }

      downloadedInstallerPath = tempFilePath
      logger.info('Updater', `Download erfolgreich abgeschlossen: ${tempFilePath}`)

      if (!targetWebContents.isDestroyed()) {
        targetWebContents.send('download-progress', {
          percent: 100,
          status: 'completed',
          downloadedBytes: fs.statSync(tempFilePath).size,
          totalBytes: fs.statSync(tempFilePath).size,
          speedBps: 0,
          remainingSeconds: 0
        })
      }

      return { success: true, filePath: tempFilePath }
    } catch (err: any) {
      const isCanceled = isDownloadCancelled || err.message === 'Canceled'
      if (!targetWebContents.isDestroyed()) {
        targetWebContents.send('download-progress', {
          percent: 0,
          status: isCanceled ? 'cancelled' : 'error',
          error: isCanceled ? 'Canceled' : err.message
        })
      }
      return { success: false, error: err.message }
    }
  })

  // Cancel download
  ipcMain.handle('cancel-update-download', async () => {
    logger.info('Updater', 'Update-Download abgebrochen')
    isDownloadCancelled = true

    if (activeDownloadRequest) {
      try { activeDownloadRequest.destroy() } catch {}
      activeDownloadRequest = null
    }

    if (activeFileStream) {
      try { activeFileStream.destroy() } catch {}
      activeFileStream = null
    }

    if (downloadedInstallerPath && fs.existsSync(downloadedInstallerPath)) {
      try {
        fs.unlinkSync(downloadedInstallerPath)
        logger.info('Updater', 'Teilweise heruntergeladene Datei gelöscht')
      } catch {}
    }

    downloadedInstallerPath = null
    return { success: true }
  })

  // Install update
  ipcMain.handle('install-update', (_, { installNow }: { installNow?: boolean }) => {
    if (!downloadedInstallerPath || !fs.existsSync(downloadedInstallerPath)) {
      return { success: false, error: 'Kein heruntergeladener Installer vorhanden.' }
    }

    if (installNow) {
      runInstallerOnQuit = true
      executeInstaller(downloadedInstallerPath)
      app.quit()
      return { success: true }
    } else {
      runInstallerOnQuit = true
      return { success: true, deferred: true }
    }
  })

  app.on('quit', () => {
    if (runInstallerOnQuit && downloadedInstallerPath && fs.existsSync(downloadedInstallerPath)) {
      executeInstaller(downloadedInstallerPath)
    }
  })
}
