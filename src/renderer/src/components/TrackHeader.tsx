import React, { useState, useEffect } from 'react'
import {
  Mic,
  Monitor,
  RefreshCw,
  Pencil,
  Volume2
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Track, InputSource, LivePeak, AudioProcessInfo } from '../../../common/types'

interface TrackHeaderProps {
  track: Track
  isArmed: boolean
  isRecording: boolean
  livePeak?: LivePeak
  audioDevices: { deviceId: string; label: string }[]
  outputDevices?: { deviceId: string; label: string }[]
  runningProcesses: AudioProcessInfo[]
  onToggleArm: () => void
  onToggleMute: () => void
  onToggleSolo: () => void
  onVolumeChange: (volume: number) => void
  onInputChange: (input: InputSource) => void
  onRenameTrack: (newName: string) => void
  onRefreshProcesses?: () => void
}

export const TrackHeader: React.FC<TrackHeaderProps> = ({
  track,
  isArmed,
  isRecording,
  livePeak = { peakL: 0, peakR: 0, peakLdBFS: -60, peakRdBFS: -60 },
  audioDevices,
  outputDevices = [],
  runningProcesses,
  onToggleArm,
  onToggleMute,
  onToggleSolo,
  onVolumeChange,
  onInputChange,
  onRenameTrack,
  onRefreshProcesses
}) => {
  const { t } = useTranslation()
  const [isEditingName, setIsEditingName] = useState(false)
  const [nameInput, setNameInput] = useState(track.name)

  useEffect(() => {
    setNameInput(track.name)
  }, [track.name])

  const handleNameSubmit = () => {
    setIsEditingName(false)
    if (nameInput.trim()) {
      onRenameTrack(nameInput.trim())
    } else {
      setNameInput(track.name)
    }
  }

  // Convert dBFS (-60 to 0) to percentage (0% to 100%)
  const dbToPercent = (db: number) => {
    if (db <= -60) return 0
    if (db >= 0) return 100
    return Math.min(100, Math.max(0, ((db + 60) / 60) * 100))
  }

  const leftPercent = dbToPercent(livePeak.peakLdBFS)
  const rightPercent = dbToPercent(livePeak.peakRdBFS)

  const currentInputValue = track.inputSource
    ? `${track.inputSource.type}:${track.inputSource.id || track.inputSource.processName || track.inputSource.deviceId}`
    : 'device:default'

  const handleInputSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value
    if (val.startsWith('device:')) {
      const devId = val.replace('device:', '')
      const dev = audioDevices.find((d) => d.deviceId === devId)
      onInputChange({
        type: 'device',
        id: devId,
        deviceId: devId,
        name: dev?.label || t('transport.system_default', 'Systemstandard'),
        label: dev?.label || t('transport.system_default', 'Systemstandard')
      })
    } else if (val.startsWith('loopback:')) {
      const loopId = val.replace('loopback:', '')
      const dev = outputDevices.find((d) => d.deviceId === loopId)
      onInputChange({
        type: 'loopback',
        id: loopId,
        deviceId: loopId,
        name: dev?.label || 'Audio-Kanal',
        label: dev?.label || 'Audio-Kanal'
      })
    } else if (val.startsWith('process:')) {
      const procKey = val.replace('process:', '')
      const proc = runningProcesses.find(
        (p) => `${p.pid}` === procKey || p.processName === procKey
      )
      onInputChange({
        type: 'process',
        id: procKey,
        processName: proc?.processName || procKey,
        pid: proc?.pid,
        name: proc?.title || proc?.processName || 'App',
        label: `${proc?.processName} (${proc?.title || 'Audio'})`,
        iconUrl: proc?.iconUrl
      })
    }
  }

  return (
    <div className="w-64 h-full bg-[#1e2126] border-r border-[#2d3036] flex flex-col justify-between p-2 select-none shrink-0 text-xs text-gray-300">
      {/* Top: Track Index Badge, Editable Name & Input Icon */}
      <div>
        <div className="flex items-center justify-between gap-1.5 mb-1.5">
          <div className="flex items-center gap-1.5 overflow-hidden flex-1 group">
            <span className="w-5 h-5 rounded bg-[#141619] border border-gray-700/60 text-omega-accent font-bold text-[10px] flex items-center justify-center shrink-0">
              {track.index + 1}
            </span>

            {isEditingName ? (
              <input
                type="text"
                autoFocus
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onBlur={handleNameSubmit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleNameSubmit()
                  if (e.key === 'Escape') setIsEditingName(false)
                }}
                className="bg-[#121417] text-white px-1.5 py-0.5 rounded border border-omega-accent text-xs w-full focus:outline-none"
              />
            ) : (
              <div className="flex items-center gap-1 overflow-hidden">
                <span
                  onDoubleClick={() => setIsEditingName(true)}
                  title={t('track.rename_tooltip', 'Doppelklick zum Umbenennen')}
                  className="font-medium text-gray-200 truncate cursor-text hover:text-white"
                >
                  {track.name}
                </span>
                <button
                  type="button"
                  onClick={() => setIsEditingName(true)}
                  title={t('track.rename', 'Spur umbenennen')}
                  className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-400 hover:text-white transition-opacity"
                >
                  <Pencil size={11} />
                </button>
              </div>
            )}
          </div>

          {/* Input Type Icon */}
          {track.inputSource?.type === 'process' ? (
            <span title={t('track.running_programs', 'Windows App-Audio Loopback')}>
              <Monitor size={13} className="text-emerald-400 shrink-0" />
            </span>
          ) : track.inputSource?.type === 'loopback' ? (
            <span title={t('track.windows_playback_loopback', 'Windows Audio-Kanal (Loopback)')}>
              <Volume2 size={13} className="text-cyan-400 shrink-0" />
            </span>
          ) : (
            <span title={t('track.hardware_devices', 'Hardware Audio-Input')}>
              <Mic size={13} className="text-omega-accent shrink-0" />
            </span>
          )}
        </div>

        {/* Input Source Dropdown */}
        <div className="flex items-center gap-1 mb-1.5">
          <select
            value={currentInputValue}
            onChange={handleInputSelect}
            className="w-full bg-[#141619] text-gray-300 text-[11px] py-1 px-1.5 rounded border border-gray-700/70 focus:border-omega-accent outline-none cursor-pointer truncate"
            title={t('track.select_input', 'Eingangsquelle wählen')}
          >
            <optgroup label={`── ${t('track.hardware_devices', 'Hardware- & Audiogeräte')} ──`}>
              <option value="device:default">{t('transport.system_default', 'Systemstandard')}</option>
              {audioDevices.map((d) => (
                <option key={d.deviceId} value={`device:${d.deviceId}`}>
                  {d.label}
                </option>
              ))}
            </optgroup>

            {outputDevices.length > 0 && (
              <optgroup label={`── ${t('track.windows_playback_loopback', 'Windows Audio-Kanäle (Loopback)')} ──`}>
                {outputDevices.map((d) => (
                  <option key={d.deviceId} value={`loopback:${d.deviceId}`}>
                    {d.label}
                  </option>
                ))}
              </optgroup>
            )}

            <optgroup label={`── ${t('track.running_programs', 'Laufende Programme')} ──`}>
              {runningProcesses.length === 0 ? (
                <option value="none" disabled>
                  {t('track.no_apps', 'Keine Audio-Apps erkannt')}
                </option>
              ) : (
                runningProcesses.map((p) => (
                  <option key={`${p.pid}-${p.processName}`} value={`process:${p.pid || p.processName}`}>
                    {p.processName} {p.title ? `(${p.title})` : ''}
                  </option>
                ))
              )}
            </optgroup>
          </select>

          {onRefreshProcesses && (
            <button
              onClick={onRefreshProcesses}
              title={t('track.refresh_apps', 'Programme neu scannen')}
              className="p-1 rounded bg-[#141619] hover:bg-[#282c32] border border-gray-700/60 text-gray-400 hover:text-white transition-colors shrink-0"
            >
              <RefreshCw size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Middle & Bottom: Buttons (Arm, Mute, Solo) + Fader + VU Meter */}
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-1">
          {/* Record Arm Button */}
          <button
            onClick={onToggleArm}
            title={isArmed ? t('track.armed', 'Spur scharfgeschaltet (R)') : t('track.arm', 'Scharfschalten (R)')}
            className={`flex-1 py-0.5 px-1.5 rounded text-[10px] font-bold border transition-all duration-150 active:scale-[0.97] flex items-center justify-center gap-1 ${
              isArmed
                ? isRecording
                  ? 'bg-red-600 border-red-500 text-white shadow-[0_0_10px_rgba(239,68,68,0.7)] animate-pulse'
                  : 'bg-red-600/30 border-red-500 text-red-400 shadow-[0_0_6px_rgba(239,68,68,0.3)]'
                : 'bg-[#141619] hover:bg-[#26292f] border-gray-700/60 text-gray-400 hover:text-gray-200'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block"></span>
            <span>R</span>
          </button>

          {/* Mute Button */}
          <button
            onClick={onToggleMute}
            title={track.muted ? t('track.unmute', 'Stummschaltung aufheben (M)') : t('track.mute', 'Stumm (M)')}
            className={`w-7 py-0.5 rounded text-[10px] font-bold border transition-all duration-150 active:scale-[0.97] ${
              track.muted
                ? 'bg-amber-600/30 border-amber-500 text-amber-300 shadow-[0_0_6px_rgba(245,158,11,0.3)]'
                : 'bg-[#141619] hover:bg-[#26292f] border-gray-700/60 text-gray-400 hover:text-gray-200'
            }`}
          >
            M
          </button>

          {/* Solo Button */}
          <button
            onClick={onToggleSolo}
            title={track.solo ? t('track.unsolo', 'Solo aufheben (S)') : t('track.solo', 'Solo (S)')}
            className={`w-7 py-0.5 rounded text-[10px] font-bold border transition-all duration-150 active:scale-[0.97] ${
              track.solo
                ? 'bg-omega-accent/30 border-omega-accent text-blue-300 shadow-[0_0_6px_rgba(0,120,215,0.3)]'
                : 'bg-[#141619] hover:bg-[#26292f] border-gray-700/60 text-gray-400 hover:text-gray-200'
            }`}
          >
            S
          </button>
        </div>

        {/* Volume Fader & Peak Meter Row */}
        <div className="flex items-center gap-1.5 pt-0.5">
          {/* Fader */}
          <div className="flex-1 flex items-center gap-1">
            <input
              type="range"
              min="0"
              max="1.5"
              step="0.01"
              value={track.volume}
              onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
              className="w-full h-1 bg-[#141619] rounded-lg appearance-none cursor-pointer accent-omega-accent border border-gray-800"
              title={`${t('track.gain', 'Lautstärke')}: ${Math.round(track.volume * 100)}%`}
            />
            <span className="text-[9px] font-mono text-gray-400 w-6 text-right">
              {Math.round(track.volume * 100)}%
            </span>
          </div>

          {/* Stereo VU Meter (-60 dBFS bis 0 dBFS) */}
          <div
            className="w-10 h-3.5 bg-[#141619] p-0.5 rounded border border-gray-800 flex flex-col justify-between"
            title={`L: ${livePeak.peakLdBFS.toFixed(1)} dBFS | R: ${livePeak.peakRdBFS.toFixed(1)} dBFS`}
          >
            {/* L Channel */}
            <div className="w-full h-1 bg-[#1a1d21] rounded-sm overflow-hidden flex">
              <div
                className={`h-full transition-all duration-75 ${
                  livePeak.peakLdBFS >= -0.5
                    ? 'bg-red-500'
                    : livePeak.peakLdBFS >= -6
                    ? 'bg-amber-400'
                    : 'bg-emerald-400'
                }`}
                style={{ width: `${leftPercent}%` }}
              />
            </div>
            {/* R Channel */}
            <div className="w-full h-1 bg-[#1a1d21] rounded-sm overflow-hidden flex">
              <div
                className={`h-full transition-all duration-75 ${
                  livePeak.peakRdBFS >= -0.5
                    ? 'bg-red-500'
                    : livePeak.peakRdBFS >= -6
                    ? 'bg-amber-400'
                    : 'bg-emerald-400'
                }`}
                style={{ width: `${rightPercent}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default TrackHeader
