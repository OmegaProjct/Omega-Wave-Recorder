/**
 * ProjectManager.ts
 * Project file handling and non-destructive / ripple audio cutting engine.
 * 
 * Features:
 * - 100% compatibility with Omega Wave Editor (.owrp / .owep) format.
 * - Project lifecycle: create, load, save with automatic relative path resolution.
 * - Non-destructive Ripple Cut with 3ms anti-click micro-crossfades:
 *   - cutRange(tracks, start, end, targetTrackIds?): Cuts interval, ripples following audio left, applies micro-fades.
 *   - cutBefore(tracks, playheadPos, targetTrackIds?): Deletes everything before playhead, ripples remainder to 0.00.
 *   - cutAfter(tracks, playheadPos, targetTrackIds?): Deletes everything after playhead, trims edge with micro-fade.
 */

import type { Project, Track, Region } from '../../../common/types'
import { deepClone } from './useHistory'

export const MICRO_FADE_SECONDS = 0.003 // 3 milliseconds anti-click micro-fade

export class ProjectManager {
  /**
   * Generates a fresh, ready-to-record Project with 4 standardized tracks.
   */
  public static createNewProject(options?: {
    name?: string
    sampleRate?: number
    trackCount?: number
  }): Project {
    const sampleRate = options?.sampleRate || 48000
    const trackCount = Math.max(1, Math.min(8, options?.trackCount || 4))

    const defaultTracks: Track[] = [
      {
        id: 'track-1',
        index: 0,
        name: 'Spur 1 - Mikrofon',
        regions: [],
        muted: false,
        solo: false,
        locked: false,
        visible: true,
        volume: 1.0,
        height: 74,
        color: '#0078d7', // Omega Blue
        inputSource: {
          type: 'device',
          id: 'default',
          deviceId: 'default',
          name: 'Mikrofon (Standard)',
          label: 'Mikrofon (Standard)'
        }
      },
      {
        id: 'track-2',
        index: 1,
        name: 'Spur 2 - Desktop / App',
        regions: [],
        muted: false,
        solo: false,
        locked: false,
        visible: true,
        volume: 1.0,
        height: 74,
        color: '#10b981', // Emerald
        inputSource: {
          type: 'process',
          id: 'spotify',
          processName: 'Spotify.exe',
          name: 'Spotify',
          label: 'Spotify'
        }
      },
      {
        id: 'track-3',
        index: 2,
        name: 'Spur 3 - Discord / Chat',
        regions: [],
        muted: false,
        solo: false,
        locked: false,
        visible: true,
        volume: 1.0,
        height: 74,
        color: '#8b5cf6', // Purple
        inputSource: {
          type: 'process',
          id: 'discord',
          processName: 'Discord.exe',
          name: 'Discord',
          label: 'Discord'
        }
      },
      {
        id: 'track-4',
        index: 3,
        name: 'Spur 4 - FX / Line-In',
        regions: [],
        muted: false,
        solo: false,
        locked: false,
        visible: true,
        volume: 1.0,
        height: 74,
        color: '#f59e0b', // Amber
        inputSource: {
          type: 'device',
          id: 'line-in',
          name: 'Line-In',
          label: 'Line-In'
        }
      }
    ]

    return {
      format: 'OWRP',
      version: '1.0.0',
      tracks: defaultTracks.slice(0, trackCount),
      settings: {
        sampleRate,
        zoomLevel: 1.0,
        playheadPos: 0.0
      },
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        author: 'Omega Wave Recorder',
        title: options?.name || 'Unbenanntes Projekt'
      }
    }
  }

  /**
   * Saves a project file (.owrp) to disk via window.api with relative path relativization.
   */
  public static async saveProject(
    filePath: string,
    project: Project
  ): Promise<{ success: boolean; filePath?: string; error?: string }> {
    const api = typeof window !== 'undefined' ? (window as any).api : undefined
    if (!api?.saveProject) {
      return { success: false, error: 'window.api.saveProject is not available' }
    }

    try {
      const cloned = deepClone(project)
      cloned.metadata.updatedAt = Date.now()

      // Relativize region file paths relative to the project directory
      const projectDir = this.getDirectoryName(filePath)
      for (const track of cloned.tracks) {
        for (const region of track.regions) {
          if (region.file?.path) {
            region.file.path = this.makeRelativePath(projectDir, region.file.path)
          }
        }
      }

      const res = await window.api.saveProject(filePath, cloned)
      return res
    } catch (err: any) {
      console.error('[ProjectManager] Error saving project:', err)
      return { success: false, error: err?.message || String(err) }
    }
  }

  /**
   * Loads a project file (.owrp / .owep) and resolves relative paths back to absolute.
   */
  public static async loadProject(
    filePath: string
  ): Promise<{ success: boolean; project?: Project; filePath?: string; error?: string }> {
    const api = typeof window !== 'undefined' ? (window as any).api : undefined
    if (!api?.loadProject) {
      return { success: false, error: 'window.api.loadProject is not available' }
    }

    try {
      const res = await window.api.loadProject(filePath)
      if (!res.success || !res.data) {
        return { success: false, error: res.error || 'Failed to load project data' }
      }

      const project: Project = res.data

      // Validate format
      if (project.format !== 'OWRP' && project.format !== 'OWEP') {
        return { success: false, error: `Unsupported project format: ${(project as any).format}` }
      }

      // Resolve relative file paths to absolute paths
      const projectDir = this.getDirectoryName(filePath)
      for (const track of project.tracks) {
        for (const region of track.regions) {
          if (region.file?.path && !this.isAbsolutePath(region.file.path)) {
            region.file.path = this.resolveAbsolutePath(projectDir, region.file.path)
          }
        }
      }

      return { success: true, project, filePath: res.filePath || filePath }
    } catch (err: any) {
      console.error('[ProjectManager] Error loading project:', err)
      return { success: false, error: err?.message || String(err) }
    }
  }

  // ==========================================
  // SMART-CUTTING SYSTEM (Ripple Cut & Micro-Fade)
  // ==========================================

  /**
   * Schnitt-Modus 1: Bereich schneiden (In/Out Cut).
   * 
   * - Schneidet das Intervall [start, end].
   * - Alle nachfolgenden Regionen rücken um (end - start) nach links auf (Ripple Cut).
   * - An Schnittkanten wird ein 3ms Micro-Crossfade (fadeIn/fadeOut) appliziert,
   *   um Knacken und Klicks vollständig zu unterdrücken.
   * - targetTrackIds: Wenn angegeben, wird nur auf den spezifizierten Spuren geschnitten.
   *   Wenn weggelassen oder leer, werden alle Spuren synchron geschnitten (Time-Ruler-Schnitt).
   */
  public static cutRange(
    tracks: Track[],
    start: number,
    end: number,
    targetTrackIds?: string[]
  ): Track[] {
    const t0 = Math.max(0, Math.min(start, end))
    const t1 = Math.max(0, Math.max(start, end))
    const delta = t1 - t0

    if (delta <= 0.0001) {
      return deepClone(tracks)
    }

    const clonedTracks = deepClone(tracks)
    const isTargeted = targetTrackIds && targetTrackIds.length > 0

    for (const track of clonedTracks) {
      if (isTargeted && !targetTrackIds.includes(track.id)) {
        continue
      }

      const newRegions: Region[] = []

      for (const region of track.regions) {
        const regStart = region.startPos
        const regDuration = region.duration
        const regEnd = regStart + regDuration

        // Fall 1: Region liegt vollständig vor dem Schnittbereich -> bleibt unberührt
        if (regEnd <= t0) {
          newRegions.push(region)
          continue
        }

        // Fall 2: Region liegt vollständig nach dem Schnittbereich -> rückt um delta nach links auf
        if (regStart >= t1) {
          newRegions.push({
            ...region,
            startPos: Math.max(0, regStart - delta)
          })
          continue
        }

        // Fall 3: Region liegt vollständig innerhalb des Schnittbereichs -> wird komplett entfernt
        if (regStart >= t0 && regEnd <= t1) {
          continue
        }

        // Fall 4: Schnittbereich teilt die Region mittig in zwei Hälften
        if (regStart < t0 && regEnd > t1) {
          // Linker Teil: endet bei t0, erhält 3ms Fade-Out
          const leftPart: Region = {
            ...region,
            id: `${region.id}_cut_L_${Math.round(t0 * 1000)}`,
            startPos: regStart,
            duration: t0 - regStart,
            sourceOffset: region.sourceOffset || 0,
            fadeOut: Math.max(region.fadeOut || 0, MICRO_FADE_SECONDS)
          }

          // Rechter Teil: beginnt bei t0 (aufgerückt), erhält 3ms Fade-In
          const rightPart: Region = {
            ...region,
            id: `${region.id}_cut_R_${Math.round(t1 * 1000)}`,
            startPos: t0,
            duration: regEnd - t1,
            sourceOffset: (region.sourceOffset || 0) + (t1 - regStart),
            fadeIn: Math.max(region.fadeIn || 0, MICRO_FADE_SECONDS)
          }

          newRegions.push(leftPart)
          newRegions.push(rightPart)
          continue
        }

        // Fall 5: Schnitt schneidet das Ende der Region ab (regStart < t0 && regEnd <= t1)
        if (regStart < t0 && regEnd > t0 && regEnd <= t1) {
          newRegions.push({
            ...region,
            duration: t0 - regStart,
            fadeOut: Math.max(region.fadeOut || 0, MICRO_FADE_SECONDS)
          })
          continue
        }

        // Fall 6: Schnitt schneidet den Anfang der Region ab (regStart >= t0 && regStart < t1 && regEnd > t1)
        if (regStart >= t0 && regStart < t1 && regEnd > t1) {
          newRegions.push({
            ...region,
            startPos: t0,
            duration: regEnd - t1,
            sourceOffset: (region.sourceOffset || 0) + (t1 - regStart),
            fadeIn: Math.max(region.fadeIn || 0, MICRO_FADE_SECONDS)
          })
          continue
        }
      }

      track.regions = newRegions
    }

    return clonedTracks
  }

  /**
   * Schnitt-Modus 2: Vor Abspielposition löschen.
   * 
   * Löscht alles von 00:00.00 bis zum aktuellen Playhead.
   * Das verbleibende Audio rückt nahtlos an den Nullpunkt 00:00.00 vor.
   */
  public static cutBefore(
    tracks: Track[],
    playheadPos: number,
    targetTrackIds?: string[]
  ): Track[] {
    if (playheadPos <= 0.0001) return deepClone(tracks)
    return this.cutRange(tracks, 0, playheadPos, targetTrackIds)
  }

  /**
   * Schnitt-Modus 3: Nach Abspielposition löschen.
   * 
   * Löscht alles vom aktuellen Playhead bis zum Ende.
   * Regionen, die über den Playhead hinausragen, werden bei playheadPos gekürzt
   * und mit 3ms Micro-Fade versehen.
   */
  public static cutAfter(
    tracks: Track[],
    playheadPos: number,
    targetTrackIds?: string[]
  ): Track[] {
    const pos = Math.max(0, playheadPos)
    const clonedTracks = deepClone(tracks)
    const isTargeted = targetTrackIds && targetTrackIds.length > 0

    for (const track of clonedTracks) {
      if (isTargeted && !targetTrackIds.includes(track.id)) {
        continue
      }

      const newRegions: Region[] = []

      for (const region of track.regions) {
        const regStart = region.startPos
        const regEnd = regStart + region.duration

        // Region liegt komplett vor dem Playhead -> bleibt erhalten
        if (regEnd <= pos) {
          newRegions.push(region)
          continue
        }

        // Region beginnt am oder nach dem Playhead -> wird gelöscht
        if (regStart >= pos) {
          continue
        }

        // Region ragt über den Playhead hinaus -> trimmen bei playheadPos mit 3ms Micro-Fade
        if (regStart < pos && regEnd > pos) {
          newRegions.push({
            ...region,
            duration: pos - regStart,
            fadeOut: Math.max(region.fadeOut || 0, MICRO_FADE_SECONDS)
          })
        }
      }

      track.regions = newRegions
    }

    return clonedTracks
  }

  // ==========================================
  // Path Utilities & Name Helpers
  // ==========================================

  public static getDirectoryName(p: string): string {
    const normalized = p.replace(/\\/g, '/')
    const idx = normalized.lastIndexOf('/')
    return idx === -1 ? '.' : normalized.substring(0, idx)
  }

  public static isAbsolutePath(p: string): boolean {
    return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/')
  }

  public static makeRelativePath(fromDir: string, toPath: string): string {
    const fromNorm = fromDir.replace(/\\/g, '/').replace(/\/$/, '')
    const toNorm = toPath.replace(/\\/g, '/')

    if (toNorm.startsWith(fromNorm + '/')) {
      return toNorm.substring(fromNorm.length + 1)
    }
    return toNorm
  }

  public static resolveAbsolutePath(fromDir: string, relPath: string): string {
    if (this.isAbsolutePath(relPath)) return relPath
    const fromNorm = fromDir.replace(/\\/g, '/').replace(/\/$/, '')
    const relNorm = relPath.replace(/\\/g, '/').replace(/^\.\//, '')
    return `${fromNorm}/${relNorm}`
  }

  /**
   * Determines whether a project path is unassigned or unnamed.
   */
  public static isUnnamed(filePath: string | null | undefined): boolean {
    if (!filePath || typeof filePath !== 'string') return true
    const trimmed = filePath.trim()
    if (!trimmed || trimmed === 'Unbenannt.owrp' || trimmed === 'Neues Projekt.owrp') return true
    return !this.isAbsolutePath(trimmed)
  }

  /**
   * Extracts clean display name from a project path.
   */
  public static getDisplayName(filePath: string | null | undefined, fallback: string = 'Unbenannt.owrp'): string {
    if (!filePath || typeof filePath !== 'string') return fallback
    const trimmed = filePath.trim()
    if (!trimmed) return fallback
    const normalized = trimmed.replace(/\\/g, '/')
    const parts = normalized.split('/')
    const last = parts.pop() || ''
    return last || fallback
  }
}
