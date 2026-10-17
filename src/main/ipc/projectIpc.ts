import { ipcMain, dialog, app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { logger } from '../logger'
import { isSafePath } from '../utils/pathUtils'
import { getDocumentsDir } from '../settingsIpc'

let startupFile: string | null = null

export function setStartupFile(filePath: string | null): void {
  startupFile = filePath
}

export function getDefaultProjectsPath(): string {
  const documentsDir = getDocumentsDir()
  const projDir = path.join(documentsDir, 'Projects')
  if (!fs.existsSync(projDir)) {
    try {
      fs.mkdirSync(projDir, { recursive: true })
    } catch {}
  }
  return projDir
}

export function registerProjectIpc(): void {
  // Show native file open dialog
  ipcMain.handle('show-open-dialog', async (_, options: any) => {
    const opts = typeof options === 'object' && options !== null ? { ...options } : {}
    if (!opts.defaultPath) {
      opts.defaultPath = getDefaultProjectsPath()
    }
    if (!opts.filters) {
      opts.filters = [
        { name: 'Omega Wave Recorder / Editor Projekte (*.owrp, *.owep)', extensions: ['owrp', 'owep', 'json'] },
        { name: 'Alle Dateien (*.*)', extensions: ['*'] }
      ]
    }
    return await dialog.showOpenDialog(opts)
  })

  // Show native file save dialog
  ipcMain.handle('show-save-dialog', async (_, options: any) => {
    const opts = typeof options === 'object' && options !== null ? { ...options } : {}
    if (!opts.defaultPath) {
      opts.defaultPath = path.join(getDefaultProjectsPath(), 'Neues Projekt.owrp')
    }
    if (!opts.filters) {
      opts.filters = [
        { name: 'Omega Wave Recorder Projekt (*.owrp)', extensions: ['owrp'] },
        { name: 'Omega Wave Editor Projekt (*.owep)', extensions: ['owep'] },
        { name: 'Alle Dateien (*.*)', extensions: ['*'] }
      ]
    }
    return await dialog.showSaveDialog(opts)
  })

  // Save project (.owrp / .owep) with relative audio file paths
  ipcMain.handle('save-project', async (_, filePath: string, projectData: any) => {
    logger.info('Project', 'Projekt speichern angefordert', { filePath })
    if (!isSafePath(filePath)) {
      logger.warn('Project', 'Speichern abgebrochen: Ungültiger Pfad', { filePath })
      return { success: false, error: 'Ungültiger Pfad' }
    }

    try {
      let targetPath = filePath
      if (!targetPath.endsWith('.owrp') && !targetPath.endsWith('.owep')) {
        targetPath = targetPath.replace(/\.[a-zA-Z0-9]+$/, '') + '.owrp'
      }

      const projectDir = path.dirname(targetPath)
      const dataToSave = JSON.parse(JSON.stringify(projectData))

      if (!dataToSave.format) {
        dataToSave.format = 'OWRP'
      }
      if (!dataToSave.metadata) {
        dataToSave.metadata = {
          createdAt: Math.floor(Date.now() / 1000),
          updatedAt: Math.floor(Date.now() / 1000),
          author: 'Omega Wave Recorder'
        }
      } else {
        dataToSave.metadata.updatedAt = Math.floor(Date.now() / 1000)
      }

      // Convert absolute file paths in regions to relative paths
      if (dataToSave && Array.isArray(dataToSave.tracks)) {
        dataToSave.tracks.forEach((track: any) => {
          if (track && Array.isArray(track.regions)) {
            track.regions.forEach((region: any) => {
              if (region?.file?.path) {
                const fileAbsPath = region.file.path
                if (path.isAbsolute(fileAbsPath)) {
                  const relativePath = path.relative(projectDir, fileAbsPath)
                  if (!path.isAbsolute(relativePath)) {
                    region.file.path = relativePath.replace(/\\/g, '/')
                  }
                }
              }
            })
          }
        })
      }

      await fs.promises.mkdir(projectDir, { recursive: true })
      await fs.promises.writeFile(targetPath, JSON.stringify(dataToSave, null, 2), 'utf-8')
      logger.info('Project', 'Projekt erfolgreich gespeichert', { targetPath })
      return { success: true, filePath: targetPath }
    } catch (err: any) {
      logger.error('Project', 'Fehler beim Speichern des Projekts', { filePath, error: err.message })
      return { success: false, error: err.message }
    }
  })

  // Save project backup (.bak)
  ipcMain.handle('save-project-backup', async (_, filePath: string, projectData: any) => {
    logger.debug('Project', 'Projekt-Backup anfordern', { filePath })
    if (!isSafePath(filePath)) {
      return { success: false, error: 'Ungültiger Pfad' }
    }

    try {
      const backupPath = filePath.endsWith('.bak') ? filePath : `${filePath}.bak`
      const projectDir = path.dirname(backupPath)
      const dataToSave = JSON.parse(JSON.stringify(projectData))

      // Relative paths
      if (dataToSave && Array.isArray(dataToSave.tracks)) {
        dataToSave.tracks.forEach((track: any) => {
          if (track && Array.isArray(track.regions)) {
            track.regions.forEach((region: any) => {
              if (region?.file?.path && path.isAbsolute(region.file.path)) {
                const rel = path.relative(projectDir, region.file.path)
                if (!path.isAbsolute(rel)) {
                  region.file.path = rel.replace(/\\/g, '/')
                }
              }
            })
          }
        })
      }

      await fs.promises.mkdir(projectDir, { recursive: true })
      await fs.promises.writeFile(backupPath, JSON.stringify(dataToSave, null, 2), 'utf-8')
      logger.debug('Project', 'Projekt-Backup erfolgreich geschrieben', { backupPath })
      return { success: true }
    } catch (err: any) {
      logger.error('Project', 'Fehler beim Schreiben des Backups', err)
      return { success: false, error: err.message }
    }
  })

  // Open and load project (supporting both 'open-project' and 'load-project')
  const handleLoadProject = async (filePath: string) => {
    logger.info('Project', 'Projekt laden angefordert', { filePath })
    if (!isSafePath(filePath)) {
      logger.warn('Project', 'Laden abgebrochen: Ungültiger Pfad', { filePath })
      return { success: false, error: 'Ungültiger Pfad' }
    }

    try {
      const resolvedPath = path.resolve(filePath)
      if (!fs.existsSync(resolvedPath)) {
        return { success: false, error: 'Projektdatei existiert nicht' }
      }

      const content = await fs.promises.readFile(resolvedPath, 'utf-8')
      const projectData = JSON.parse(content)
      const projectDir = path.dirname(resolvedPath)

      // Resolve relative file paths to absolute paths
      if (projectData && Array.isArray(projectData.tracks)) {
        projectData.tracks.forEach((track: any) => {
          if (track && Array.isArray(track.regions)) {
            track.regions.forEach((region: any) => {
              if (region?.file?.path) {
                const pathInJson = region.file.path
                if (!path.isAbsolute(pathInJson)) {
                  region.file.path = path.resolve(projectDir, pathInJson)
                }
              }
            })
          }
        })
      }

      // Check for backup recovery file
      const bakPath = resolvedPath + '.bak'
      let hasBackup = false
      let backupData = null
      if (fs.existsSync(bakPath)) {
        try {
          const statMain = fs.statSync(resolvedPath)
          const statBak = fs.statSync(bakPath)
          if (statBak.mtimeMs > statMain.mtimeMs) {
            const bakContent = await fs.promises.readFile(bakPath, 'utf-8')
            backupData = JSON.parse(bakContent)
            if (backupData && Array.isArray(backupData.tracks)) {
              backupData.tracks.forEach((track: any) => {
                if (track && Array.isArray(track.regions)) {
                  track.regions.forEach((region: any) => {
                    if (region?.file?.path && !path.isAbsolute(region.file.path)) {
                      region.file.path = path.resolve(projectDir, region.file.path)
                    }
                  })
                }
              })
            }
            hasBackup = true
          }
        } catch (bakErr) {
          logger.warn('Project', 'Fehler beim Lesen der Backup-Datei', bakErr)
        }
      }

      logger.info('Project', 'Projekt erfolgreich geladen', { filePath: resolvedPath, hasBackup })
      return { success: true, data: projectData, hasBackup, backupData, filePath: resolvedPath }
    } catch (err: any) {
      logger.error('Project', 'Fehler beim Laden des Projekts', { filePath, error: err.message })
      return { success: false, error: err.message }
    }
  }

  ipcMain.handle('open-project', async (_, filePath: string) => handleLoadProject(filePath))
  ipcMain.handle('load-project', async (_, filePath: string) => handleLoadProject(filePath))

  // Startup file (if application opened via file association or argument)
  ipcMain.handle('get-startup-file', () => {
    const file = startupFile
    startupFile = null
    return file
  })
}
