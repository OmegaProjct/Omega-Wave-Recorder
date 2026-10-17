import React, { useState, useEffect, useRef, useCallback } from 'react'
import TitleBar from './components/TitleBar'
import MenuBar from './components/MenuBar'
import TransportBar from './components/TransportBar'
import TimeRuler from './components/TimeRuler'
import TrackLane from './components/TrackLane'
import SingleTrackFocusView from './components/SingleTrackFocusView'

// Modals
import ExportModal from './components/ExportModal'
import SettingsModal from './components/SettingsModal'
import AboutModal from './components/AboutModal'
import ChangelogModal from './components/ChangelogModal'
import LogViewerModal from './components/LogViewerModal'
import ManualModal from './components/ManualModal'
import MessageCenterModal from './components/MessageCenterModal'
import UpdateModal from './components/UpdateModal'

import type {
  Track,
  Region,
  InputSource,
  LivePeak,
  AudioProcessInfo,
  Project,
  ExportSettings
} from '../../common/types'
import { AudioRecordingEngine, type RecordingTrackConfig, type RecordingResult } from './lib/AudioRecordingEngine'
import { AudioPlaybackEngine } from './lib/AudioPlaybackEngine'
import { ProjectManager } from './lib/ProjectManager'
import { useHistory } from './lib/useHistory'

const INITIAL_TRACKS: Track[] = [
  {
    id: 'track-1',
    index: 0,
    name: 'Spur 1 - Mikrofon',
    muted: false,
    solo: false,
    locked: false,
    visible: true,
    volume: 1.0,
    height: 74,
    inputSource: {
      type: 'device',
      id: 'default',
      deviceId: 'default',
      name: 'Mikrofon (Systemstandard)',
      label: 'Mikrofon (Systemstandard)'
    },
    regions: []
  },
  {
    id: 'track-2',
    index: 1,
    name: 'Spur 2',
    muted: false,
    solo: false,
    locked: false,
    visible: true,
    volume: 1.0,
    height: 74,
    inputSource: {
      type: 'device',
      id: 'default',
      deviceId: 'default',
      name: 'Line-In / Gerät',
      label: 'Line-In / Gerät'
    },
    regions: []
  },
  {
    id: 'track-3',
    index: 2,
    name: 'Spur 3',
    muted: false,
    solo: false,
    locked: false,
    visible: true,
    volume: 1.0,
    height: 74,
    inputSource: {
      type: 'device',
      id: 'default',
      deviceId: 'default',
      name: 'Line-In / Gerät',
      label: 'Line-In / Gerät'
    },
    regions: []
  },
  {
    id: 'track-4',
    index: 3,
    name: 'Spur 4',
    muted: false,
    solo: false,
    locked: false,
    visible: true,
    volume: 1.0,
    height: 74,
    inputSource: {
      type: 'device',
      id: 'default',
      deviceId: 'default',
      name: 'Line-In / Gerät',
      label: 'Line-In / Gerät'
    },
    regions: []
  }
]

export const App: React.FC = () => {
  // --- Workspace & View State ---
  const [viewMode, setViewMode] = useState<'multitrack' | 'focus'>('multitrack')
  const [activeTrackIndex, setActiveTrackIndex] = useState<number>(0)
  const [projectFilePath, setProjectFilePath] = useState<string | null>(null)
  const [projectName, setProjectName] = useState<string>('Unbenannt.owrp')
  const [saveError, setSaveError] = useState<string | null>(null)

  // --- Multi-Track State with HistoryStack ---
  const {
    state: tracks,
    set: pushTracks,
    setPresent: setTracksPresent,
    undo: historyUndo,
    redo: historyRedo,
    canUndo,
    canRedo,
    clear: clearHistory,
    markClean: historyMarkClean,
    isModified
  } = useHistory<Track[]>(INITIAL_TRACKS, { enableShortcuts: false })

  const [armedTrackIds, setArmedTrackIds] = useState<Set<string>>(new Set(['track-1']))
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null)

  // --- Playback & Recording State ---
  const [isPlaying, setIsPlaying] = useState<boolean>(false)
  const [isRecording, setIsRecording] = useState<boolean>(false)
  const [currentTime, setCurrentTime] = useState<number>(0.0)
  const [totalDuration, setTotalDuration] = useState<number>(0.0)
  const [recordStartPos, setRecordStartPos] = useState<number>(0.0)
  const [liveRecordedPeaks, setLiveRecordedPeaks] = useState<Record<string, number[]>>({})
  const [isAppendMode, setIsAppendMode] = useState<boolean>(true)
  const [masterVolume, setMasterVolume] = useState<number>(1.0)
  const [selectedOutputDevice, setSelectedOutputDevice] = useState<string>('default')

  // --- Real-time Metering & I/O ---
  const [livePeaks, setLivePeaks] = useState<Record<string, LivePeak>>({
    'track-1': { peakL: 0, peakR: 0, peakLdBFS: -60, peakRdBFS: -60 },
    'track-2': { peakL: 0, peakR: 0, peakLdBFS: -60, peakRdBFS: -60 },
    'track-3': { peakL: 0, peakR: 0, peakLdBFS: -60, peakRdBFS: -60 },
    'track-4': { peakL: 0, peakR: 0, peakLdBFS: -60, peakRdBFS: -60 }
  })
  const [audioDevices, setAudioDevices] = useState<{ deviceId: string; label: string }[]>([])
  const [runningProcesses, setRunningProcesses] = useState<AudioProcessInfo[]>([])

  // --- Modals State ---
  const [activeModal, setActiveModal] = useState<
    'export' | 'settings' | 'about' | 'changelog' | 'logs' | 'manual' | 'messages' | 'update' | null
  >(null)
  const [settingsTab, setSettingsTab] = useState<'language' | 'audio' | 'notifications'>('language')
  const [logTab, setLogTab] = useState<'logs' | 'feedback'>('logs')

  // Zoom & Scrolling
  const [pixelsPerSecond, setPixelsPerSecond] = useState<number>(50)
  const [scrollLeft, setScrollLeft] = useState<number>(0)

  // Push Snapshot to History Stack
  const pushHistory = useCallback(
    (newTracks: Track[]) => {
      pushTracks(newTracks)
    },
    [pushTracks]
  )

  // Undo Action
  const handleUndo = useCallback(() => {
    if (canUndo) {
      const restored = historyUndo()
      if (restored) {
        AudioPlaybackEngine.getInstance().updateRouting(restored)
      }
    }
  }, [canUndo, historyUndo])

  // Redo Action
  const handleRedo = useCallback(() => {
    if (canRedo) {
      const restored = historyRedo()
      if (restored) {
        AudioPlaybackEngine.getInstance().updateRouting(restored)
      }
    }
  }, [canRedo, historyRedo])

  // Enumerate input devices & running processes on mount
  useEffect(() => {
    async function loadInputs() {
      try {
        if (navigator.mediaDevices?.enumerateDevices) {
          const devs = await navigator.mediaDevices.enumerateDevices()
          const inputs = devs
            .filter((d) => d.kind === 'audioinput')
            .map((d, i) => ({
              deviceId: d.deviceId,
              label: d.label || `Mikrofon ${i + 1}`
            }))
          if (inputs.length > 0) setAudioDevices(inputs)
        }
      } catch (e) {
        console.warn('Error enumerating input devices:', e)
      }

      try {
        if (window.api?.getAudioProcesses) {
          const procs = await window.api.getAudioProcesses()
          if (procs) setRunningProcesses(procs)
        }
      } catch (e) {
        console.warn('Error fetching audio processes:', e)
      }
    }
    loadInputs()
  }, [])

  // Update totalDuration dynamically from regions
  // Calculate total duration from regions dynamically
  useEffect(() => {
    let maxLen = 0
    tracks.forEach((t) => {
      t.regions.forEach((r) => {
        const end = r.startPos + r.duration
        if (end > maxLen) maxLen = end
      })
    })
    setTotalDuration(maxLen)
  }, [tracks])

  // Subscribe to AudioPlaybackEngine events
  useEffect(() => {
    const playback = AudioPlaybackEngine.getInstance()
    const unsubTime = playback.onTimeUpdate((pos) => {
      setCurrentTime(pos)
    })
    const unsubState = playback.onStateChange((state) => {
      setIsPlaying(state === 'playing')
    })
    return () => {
      unsubTime()
      unsubState()
    }
  }, [])

  useEffect(() => AudioRecordingEngine.getInstance().onError(error => {
    setSaveError(`Aufnahme angehalten: ${error.message}. Bitte die Aufnahme stoppen.`)
  }), [])

  // Animation frame loop for active recording metrics (live time, VU meters, live waveform peaks)
  const animFrameRef = useRef<number>()
  useEffect(() => {
    if (isRecording) {
      const recEngine = AudioRecordingEngine.getInstance()

      const updateRecordLoop = () => {
        const elapsed = recEngine.getDuration()
        const newTime = recordStartPos + elapsed
        setCurrentTime(newTime)
        setTotalDuration((prev) => Math.max(prev, newTime))

        // Collect actual real-time VU meter peaks and live waveform peak arrays
        const nextPeaks: Record<string, LivePeak> = {}
        const nextRecPeaks: Record<string, number[]> = {}

        tracks.forEach((t) => {
          nextPeaks[t.id] = recEngine.getPeak(t.id)
          if (armedTrackIds.has(t.id)) {
            nextRecPeaks[t.id] = recEngine.getLivePeaks(t.id)
          }
        })

        setLivePeaks(nextPeaks)
        setLiveRecordedPeaks(nextRecPeaks)

        animFrameRef.current = requestAnimationFrame(updateRecordLoop)
      }

      animFrameRef.current = requestAnimationFrame(updateRecordLoop)
      return () => {
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
      }
    } else if (!isPlaying) {
      // Idle / stopped peaks reset to quiet floor
      setLivePeaks({
        'track-1': { peakL: 0, peakR: 0, peakLdBFS: -60, peakRdBFS: -60 },
        'track-2': { peakL: 0, peakR: 0, peakLdBFS: -60, peakRdBFS: -60 },
        'track-3': { peakL: 0, peakR: 0, peakLdBFS: -60, peakRdBFS: -60 },
        'track-4': { peakL: 0, peakR: 0, peakLdBFS: -60, peakRdBFS: -60 }
      })
    }
  }, [isRecording, isPlaying, recordStartPos, tracks, armedTrackIds])

  // Transport Control Handlers with Real Engine Execution
  const handlePlay = async () => {
    if (isRecording) {
      await handleStop()
    }
    let playFrom = currentTime
    if (totalDuration > 0 && currentTime >= totalDuration) {
      playFrom = 0
      setCurrentTime(0)
    }
    try {
      await AudioPlaybackEngine.getInstance().play(tracks, playFrom)
      setIsPlaying(AudioPlaybackEngine.getInstance().getState() === 'playing')
    } catch (err) {
      console.error('Failed to start playback:', err)
      setSaveError(err instanceof Error ? err.message : String(err))
      setIsPlaying(false)
    }
  }

  const handlePause = () => {
    AudioPlaybackEngine.getInstance().pause()
    setIsPlaying(false)
  }

  const handleStop = async () => {
    if (isRecording) {
      try {
        const results = await AudioRecordingEngine.getInstance().stopRecording()
        setIsRecording(false)

        const newTracks = tracks.map((t) => {
          const res = results.find((r) => r.trackId === t.id)
          if (res && res.duration > 0.05) {
            const newRegion: Region = {
              id: `reg-${Date.now()}-${t.id}`,
              name: `Take ${t.regions.length + 1}`,
              file: { path: res.filePath, name: res.filePath.split(/[/\\]/).pop() || res.filePath },
              startPos: recordStartPos,
              duration: res.duration,
              peaks: res.peaks && res.peaks.length > 0 ? res.peaks : undefined,
              gain: 1.0,
              fadeIn: 0.003,
              fadeOut: 0.003
            }
            return { ...t, regions: [...t.regions, newRegion] }
          }
          return t
        })

        pushHistory(newTracks)

        // Preload newly recorded audio for immediate seamless playback
        AudioPlaybackEngine.getInstance().preloadTracks(newTracks).catch(() => {})
      } catch (err) {
        console.error('Failed to stop recording cleanly:', err)
        setSaveError(err instanceof Error ? err.message : String(err))
        setIsRecording(false)
      }
    } else {
      AudioPlaybackEngine.getInstance().stop()
      setIsPlaying(false)
    }
  }

  const handleRecord = async () => {
    if (isRecording) {
      await handleStop()
    } else {
      // Determine record start anchor
      const startPos = isAppendMode ? totalDuration : currentTime
      setRecordStartPos(startPos)
      setCurrentTime(startPos)

      // Ensure at least one track is armed
      const effectiveArmed = armedTrackIds.size > 0 ? armedTrackIds : new Set([tracks[0]?.id || 'track-1'])
      if (armedTrackIds.size === 0 && tracks[0]) {
        setArmedTrackIds(new Set([tracks[0].id]))
      }

      // Get dedicated AudioTemp directory from system if available
      let tempDir = ''
      try {
        if (window.api?.getSystemPath) {
          tempDir = await window.api.getSystemPath('audioTemp')
        }
      } catch {}

      const configs: RecordingTrackConfig[] = []
      tracks.forEach((t) => {
        if (effectiveArmed.has(t.id)) {
          const input: InputSource = t.inputSource || {
            type: 'device',
            id: 'default',
            deviceId: 'default',
            name: 'Mikrofon (Systemstandard)',
            label: 'Mikrofon (Systemstandard)'
          }
          const filename = `rec_${crypto.randomUUID()}.wav`
          const filePath = tempDir ? `${tempDir.replace(/[\\/]+$/, '')}\\${filename}` : filename
          configs.push({
            trackId: t.id,
            inputSource: input,
            tempFilePath: filePath
          })
        }
      })

      try {
        AudioPlaybackEngine.getInstance().stop()
        setIsPlaying(false)
        await AudioRecordingEngine.getInstance().startRecording(configs)
        setIsRecording(true)
      } catch (err) {
        console.error('Failed to start recording session:', err)
        setSaveError(err instanceof Error ? err.message : String(err))
        setIsRecording(false)
      }
    }
  }

  const handleSeek = (time: number) => {
    const clamped = Math.max(0, Math.min(totalDuration, time))
    setCurrentTime(clamped)
    if (isPlaying) {
      AudioPlaybackEngine.getInstance().seek(clamped, tracks)
    }
  }

  const handleToggleArm = (trackId: string) => {
    setArmedTrackIds((prev) => {
      const next = new Set(prev)
      if (next.has(trackId)) next.delete(trackId)
      else next.add(trackId)
      return next
    })
  }

  const handleToggleMute = (trackId: string) => {
    const updated = tracks.map((t) => (t.id === trackId ? { ...t, muted: !t.muted } : t))
    setTracksPresent(updated, true)
    AudioPlaybackEngine.getInstance().updateRouting(updated)
  }

  const handleToggleSolo = (trackId: string) => {
    const updated = tracks.map((t) => (t.id === trackId ? { ...t, solo: !t.solo } : t))
    setTracksPresent(updated, true)
    AudioPlaybackEngine.getInstance().updateRouting(updated)
  }

  const handleVolumeChange = (trackId: string, volume: number) => {
    const updated = tracks.map((t) => (t.id === trackId ? { ...t, volume } : t))
    setTracksPresent(updated, true)
    AudioPlaybackEngine.getInstance().updateRouting(updated)
  }

  const handleInputChange = (trackId: string, input: InputSource) => {
    const updated = tracks.map((t) => (t.id === trackId ? { ...t, inputSource: input } : t))
    pushHistory(updated)
    // Auto-arm track when an input is selected so multi-track recording works out of the box
    setArmedTrackIds((prev) => {
      const next = new Set(prev)
      next.add(trackId)
      return next
    })
  }

  const handleRenameTrack = (trackId: string, newName: string) => {
    const updated = tracks.map((t) => (t.id === trackId ? { ...t, name: newName } : t))
    pushHistory(updated)
  }

  const handleOutputDeviceChange = (deviceId: string) => {
    setSelectedOutputDevice(deviceId)
    AudioPlaybackEngine.getInstance().setOutputDevice(deviceId)
  }

  const handleMasterVolumeChange = (vol: number) => {
    setMasterVolume(vol)
    AudioPlaybackEngine.getInstance().setMasterVolume(vol)
  }

  // Smart-Cutting Operations (delegating directly to ProjectManager with 3ms Micro-Fades)
  const handleCutRange = useCallback(() => {
    if (!selection) return
    const selStart = Math.min(selection.start, selection.end)
    const selEnd = Math.max(selection.start, selection.end)
    if (selEnd - selStart <= 0.0001) return

    const newTracks = ProjectManager.cutRange(tracks, selStart, selEnd)
    pushHistory(newTracks)
    setSelection(null)
    setCurrentTime(selStart)
  }, [selection, tracks, pushHistory])

  const handleDeleteBefore = useCallback(() => {
    if (currentTime <= 0.0001) return
    const newTracks = ProjectManager.cutBefore(tracks, currentTime)
    pushHistory(newTracks)
    setCurrentTime(0)
  }, [currentTime, tracks, pushHistory])

  const handleDeleteAfter = useCallback(() => {
    const newTracks = ProjectManager.cutAfter(tracks, currentTime)
    pushHistory(newTracks)
    setTotalDuration(currentTime)
  }, [currentTime, tracks, pushHistory])

  // Project I/O Actions
  const saveProjectFile = async (targetPath: string): Promise<boolean> => {
    setSaveError(null)
    try {
      const projectData: Project = {
        format: 'OWRP',
        version: '1.0.0',
        tracks,
        settings: {
          sampleRate: AudioPlaybackEngine.getInstance().getSampleRate(),
          zoomLevel: 1.0,
          playheadPos: currentTime
        },
        metadata: {
          createdAt: Date.now(),
          updatedAt: Date.now(),
          author: 'Omega Wave Recorder',
          title: ProjectManager.getDisplayName(targetPath)
        }
      }

      const res = await ProjectManager.saveProject(targetPath, projectData)
      if (!res.success) {
        const errorMsg = res.error || 'Fehler beim Speichern der Projektdatei.'
        setSaveError(errorMsg)
        return false
      }

      const finalPath = res.filePath || targetPath
      setProjectFilePath(finalPath)
      setProjectName(ProjectManager.getDisplayName(finalPath))
      historyMarkClean(tracks)
      setSaveError(null)
      return true
    } catch (err: any) {
      const errorMsg = err?.message || String(err) || 'Unerwarteter Fehler beim Speichern.'
      setSaveError(errorMsg)
      return false
    }
  }

  const handleSaveProjectAs = async (): Promise<boolean> => {
    try {
      if (!window.api?.showSaveDialog) {
        setSaveError('Speichern-Dialog ist nicht verfügbar.')
        return false
      }

      const defaultPath = projectFilePath || projectName || 'Neues Projekt.owrp'
      const res = await window.api.showSaveDialog({
        title: 'Projekt speichern unter...',
        defaultPath,
        filters: [
          { name: 'Omega Wave Recorder Projekt (*.owrp)', extensions: ['owrp'] },
          { name: 'Omega Wave Editor Projekt (*.owep)', extensions: ['owep'] },
          { name: 'Alle Dateien (*.*)', extensions: ['*'] }
        ]
      })

      if (!res.canceled && res.filePath) {
        // Direct pass of user-selected path avoids stale React state closures
        return await saveProjectFile(res.filePath)
      }
      return false
    } catch (e: any) {
      setSaveError(e?.message || 'Fehler beim Öffnen des Speichern-Dialogs.')
      return false
    }
  }

  const handleSaveProject = async (): Promise<boolean> => {
    if (!projectFilePath || ProjectManager.isUnnamed(projectFilePath)) {
      return await handleSaveProjectAs()
    }
    return await saveProjectFile(projectFilePath)
  }

  const handleNewProject = async () => {
    if (AudioRecordingEngine.getInstance().isRecording()) {
      setSaveError('Bitte die Aufnahme stoppen, bevor ein neues Projekt erstellt wird.')
      return
    }
    if (isModified) {
      const confirmMsg = 'Das aktuelle Projekt enthält ungespeicherte Änderungen. Möchten Sie wirklich ein neues Projekt erstellen?'
      const proceed = typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm(confirmMsg)
        : true
      if (!proceed) return
    }

    if (isRecording) {
      try {
        await AudioRecordingEngine.getInstance().stopRecording()
      } catch (err) {
        console.warn('Error stopping recording during New Project:', err)
      }
      setIsRecording(false)
    }
    AudioPlaybackEngine.getInstance().stop(true)
    setIsPlaying(false)

    // Clear playback buffer cache at project boundary
    AudioPlaybackEngine.getInstance().clearCache()

    clearHistory(INITIAL_TRACKS)
    setArmedTrackIds(new Set([INITIAL_TRACKS[0].id]))
    setActiveTrackIndex(0)
    setLiveRecordedPeaks({})
    setProjectFilePath(null)
    setProjectName('Unbenannt.owrp')
    setSaveError(null)

    setCurrentTime(0)
    setSelection(null)
    setTotalDuration(0)
  }

  const handleOpenProject = async () => {
    if (AudioRecordingEngine.getInstance().isRecording()) {
      setSaveError('Bitte die Aufnahme stoppen, bevor ein anderes Projekt geöffnet wird.')
      return
    }
    try {
      if (!window.api?.showOpenDialog) return

      const res = await window.api.showOpenDialog({
        title: 'Omega Wave Recorder Projekt öffnen',
        filters: [
          { name: 'Omega Wave Recorder Project (*.owrp, *.owep)', extensions: ['owrp', 'owep'] },
          { name: 'Alle Dateien', extensions: ['*'] }
        ],
        properties: ['openFile']
      })

      if (!res.canceled && res.filePaths?.[0]) {
        if (isModified) {
          const confirmMsg = 'Das aktuelle Projekt enthält ungespeicherte Änderungen. Möchten Sie wirklich ein anderes Projekt öffnen?'
          const proceed = typeof window !== 'undefined' && typeof window.confirm === 'function'
            ? window.confirm(confirmMsg)
            : true
          if (!proceed) return
        }

        const filePath = res.filePaths[0]

        if (isRecording) {
          try {
            await AudioRecordingEngine.getInstance().stopRecording()
          } catch (err) {
            console.warn('Error stopping recording during Open Project:', err)
          }
          setIsRecording(false)
        }
        AudioPlaybackEngine.getInstance().stop(true)
        setIsPlaying(false)

        // Clear playback buffer cache at project boundary
        AudioPlaybackEngine.getInstance().clearCache()

        const loaded = await ProjectManager.loadProject(filePath)
        if (!loaded.success || !loaded.project) {
          setSaveError(loaded.error || 'Fehler beim Laden des Projekts.')
          return
        }

        const project = loaded.project
        const projectTracks = Array.isArray(project.tracks) ? project.tracks : INITIAL_TRACKS

        clearHistory(projectTracks)
        setArmedTrackIds(new Set(projectTracks[0] ? [projectTracks[0].id] : []))
        setActiveTrackIndex(0)
        setLiveRecordedPeaks({})

        const finalPath = loaded.filePath || filePath
        setProjectFilePath(finalPath)
        setProjectName(ProjectManager.getDisplayName(finalPath))
        setSaveError(null)

        const initialPlayhead = project.settings?.playheadPos || 0
        setCurrentTime(initialPlayhead)
        setSelection(null)

        AudioPlaybackEngine.getInstance().updateRouting(projectTracks)
        AudioPlaybackEngine.getInstance().preloadTracks(projectTracks).catch(() => {})
      }
    } catch (e: any) {
      console.warn('Failed to open project:', e)
      setSaveError(e?.message || 'Fehler beim Öffnen des Projekts.')
    }
  }

  const handleExportAudio = async (settings: ExportSettings) => {
    if (window.api?.exportAudio) {
      await window.api.exportAudio(settings)
    }
  }

  // Keyboard Shortcuts Handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when user is typing in input or textarea
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }

      // Space: Play / Pause
      if (e.code === 'Space') {
        e.preventDefault()
        if (isPlaying) handlePause()
        else handlePlay()
        return
      }

      // Key R: Record
      if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        handleRecord()
        return
      }

      // Ctrl + S: Save
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (e.shiftKey) handleSaveProjectAs()
        else handleSaveProject()
        return
      }

      // Ctrl + N: New Project
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        handleNewProject()
        return
      }

      // Ctrl + O: Open Project
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        handleOpenProject()
        return
      }

      // Ctrl + E: Export
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        setActiveModal('export')
        return
      }

      // Ctrl + , : Settings
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault()
        setActiveModal('settings')
        return
      }

      // Ctrl + Z: Undo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) handleRedo()
        else handleUndo()
        return
      }

      // Ctrl + Y: Redo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        handleRedo()
        return
      }

      // Ctrl + X: Cut Range
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
        e.preventDefault()
        handleCutRange()
        return
      }

      // Delete: Delete Selection
      if (e.key === 'Delete' || e.key === 'Del') {
        e.preventDefault()
        handleCutRange()
        return
      }

      // Numbers 1, 2, 3, 4: Select Track Focus
      if (['1', '2', '3', '4'].includes(e.key) && !e.ctrlKey && !e.altKey) {
        const idx = parseInt(e.key) - 1
        if (tracks[idx]) {
          setActiveTrackIndex(idx)
        }
      }

      // Home / Pos1: To Start
      if (e.key === 'Home') {
        e.preventDefault()
        handleSeek(0)
      }

      // End: To End
      if (e.key === 'End') {
        e.preventDefault()
        handleSeek(totalDuration)
      }

      // ArrowLeft: -1s
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        handleSeek(Math.max(0, currentTime - 1.0))
      }

      // ArrowRight: +1s
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        handleSeek(Math.min(totalDuration, currentTime + 1.0))
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    isPlaying,
    isRecording,
    currentTime,
    totalDuration,
    selection,
    handleCutRange,
    handleUndo,
    handleRedo,
    projectFilePath,
    projectName,
    isModified,
    tracks
  ])

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-omega-dark text-omega-text select-none">
      {/* 1. Frameless TitleBar */}
      <TitleBar
        projectName={projectName}
        isModified={isModified}
        viewMode={viewMode}
        onToggleViewMode={() =>
          setViewMode((m) => (m === 'multitrack' ? 'focus' : 'multitrack'))
        }
      />

      {/* 2. MenuBar */}
      <MenuBar
        onNewProject={handleNewProject}
        onOpenProject={handleOpenProject}
        onSaveProject={handleSaveProject}
        onSaveProjectAs={handleSaveProjectAs}
        onExportAudio={() => setActiveModal('export')}
        onOpenSettings={() => {
          setSettingsTab('language')
          setActiveModal('settings')
        }}
        onQuit={() => window.api?.close?.()}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onCutRange={handleCutRange}
        onDeleteBefore={handleDeleteBefore}
        onDeleteAfter={handleDeleteAfter}
        onDeleteSelection={handleCutRange}
        onOpenManual={() => setActiveModal('manual')}
        onOpenChangelog={() => setActiveModal('changelog')}
        onCheckUpdates={() => setActiveModal('update')}
        onShowLogs={() => {
          setLogTab('logs')
          setActiveModal('logs')
        }}
        onSendFeedback={() => {
          setLogTab('feedback')
          setActiveModal('logs')
        }}
        onOpenMessageCenter={() => setActiveModal('messages')}
        onOpenAbout={() => setActiveModal('about')}
        canUndo={canUndo}
        canRedo={canRedo}
        hasSelection={selection !== null}
      />

      {/* Inline Alert for errors (e.g. Save / Load failure) */}
      {saveError && (
        <div
          role="alert"
          className="bg-red-900/90 border-b border-red-500/80 text-red-100 px-4 py-1.5 text-xs flex items-center justify-between z-50 shrink-0 shadow-md backdrop-blur-sm animate-in fade-in duration-150"
        >
          <div className="flex items-center gap-2">
            <span className="font-semibold text-red-300">Fehler:</span>
            <span>{saveError}</span>
          </div>
          <button
            onClick={() => setSaveError(null)}
            className="text-red-300 hover:text-white font-bold px-1.5 py-0.5 rounded hover:bg-red-800/60 transition-colors"
            title="Schließen"
          >
            ✕
          </button>
        </div>
      )}

      {/* 3. Main Workspace Area */}
      <div className="flex-1 flex flex-col overflow-hidden bg-[#16181b]">
        {/* TimeRuler is shown above lanes or in focus mode */}
        <div className="flex pl-64 bg-[#181a1e] border-b border-[#2d3036]">
          <TimeRuler
            totalDuration={totalDuration}
            currentTime={currentTime}
            selection={selection}
            pixelsPerSecond={pixelsPerSecond}
            scrollLeft={scrollLeft}
            onSeek={handleSeek}
            onSelectRange={setSelection}
          />
        </div>

        {/* View Mode Switching: Multi-Track vs Retro Single-Track Focus */}
        {viewMode === 'multitrack' ? (
          <div className="flex-1 flex flex-col overflow-y-auto custom-scrollbar">
            {tracks.map((track) => (
              <TrackLane
                key={track.id}
                track={track}
                isArmed={armedTrackIds.has(track.id)}
                isRecording={isRecording}
                isPlaying={isPlaying}
                currentTime={currentTime}
                totalDuration={totalDuration}
                recordStartPos={recordStartPos}
                liveRecordedPeaks={liveRecordedPeaks[track.id] || []}
                pixelsPerSecond={pixelsPerSecond}
                scrollLeft={scrollLeft}
                selection={selection}
                livePeak={livePeaks[track.id]}
                audioDevices={audioDevices}
                runningProcesses={runningProcesses}
                onToggleArm={() => handleToggleArm(track.id)}
                onToggleMute={() => handleToggleMute(track.id)}
                onToggleSolo={() => handleToggleSolo(track.id)}
                onVolumeChange={(vol) => handleVolumeChange(track.id, vol)}
                onInputChange={(inp) => handleInputChange(track.id, inp)}
                onRenameTrack={(name) => handleRenameTrack(track.id, name)}
                onSeek={handleSeek}
                onSelectRange={setSelection}
              />
            ))}
          </div>
        ) : (
          <SingleTrackFocusView
            tracks={tracks}
            activeTrackIndex={activeTrackIndex}
            armedTrackIds={armedTrackIds}
            isRecording={isRecording}
            isPlaying={isPlaying}
            currentTime={currentTime}
            totalDuration={totalDuration}
            livePeak={livePeaks[tracks[activeTrackIndex]?.id || 'track-1']}
            audioDevices={audioDevices}
            runningProcesses={runningProcesses}
            onSelectTrack={setActiveTrackIndex}
            onToggleArm={handleToggleArm}
            onToggleMute={handleToggleMute}
            onToggleSolo={handleToggleSolo}
            onVolumeChange={handleVolumeChange}
            onInputChange={handleInputChange}
            onSeek={handleSeek}
          />
        )}
      </div>

      {/* 4. TransportBar */}
      <TransportBar
        currentTime={currentTime}
        totalDuration={totalDuration}
        isPlaying={isPlaying}
        isRecording={isRecording}
        isAppendMode={isAppendMode}
        masterVolume={masterVolume}
        selectedOutputDevice={selectedOutputDevice}
        onPlay={handlePlay}
        onPause={handlePause}
        onStop={handleStop}
        onRecord={handleRecord}
        onSeek={handleSeek}
        onToggleAppendMode={() => setIsAppendMode((prev) => !prev)}
        onOutputDeviceChange={handleOutputDeviceChange}
        onMasterVolumeChange={handleMasterVolumeChange}
      />

      {/* Modals Container */}
      {activeModal === 'export' && (
        <ExportModal
          onClose={() => setActiveModal(null)}
          onExport={handleExportAudio}
        />
      )}

      {activeModal === 'settings' && (
        <SettingsModal
          initialTab={settingsTab}
          onClose={() => setActiveModal(null)}
        />
      )}

      {activeModal === 'about' && (
        <AboutModal onClose={() => setActiveModal(null)} />
      )}

      {activeModal === 'changelog' && (
        <ChangelogModal onClose={() => setActiveModal(null)} />
      )}

      {activeModal === 'logs' && (
        <LogViewerModal
          initialTab={logTab}
          onClose={() => setActiveModal(null)}
        />
      )}

      {activeModal === 'manual' && (
        <ManualModal onClose={() => setActiveModal(null)} />
      )}

      {activeModal === 'messages' && (
        <MessageCenterModal onClose={() => setActiveModal(null)} />
      )}

      {activeModal === 'update' && (
        <UpdateModal onClose={() => setActiveModal(null)} />
      )}
    </div>
  )
}

export default App
