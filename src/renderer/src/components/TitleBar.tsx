import React, { useState, useEffect } from 'react'
import { Minus, Square, Copy, X, Layers, Activity } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import logoImg from '../../../../assets/logo.png'

interface TitleBarProps {
  projectName?: string
  isModified?: boolean
  viewMode: 'multitrack' | 'focus'
  onToggleViewMode: () => void
  version?: string
}

export const TitleBar: React.FC<TitleBarProps> = ({
  projectName = 'Unbenannt.owrp',
  isModified = false,
  viewMode,
  onToggleViewMode,
  version = '0.1.1'
}) => {
  const { t } = useTranslation()
  const [appVersion, setAppVersion] = useState(version)
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    const checkMaximized = async () => {
      try {
        if (window.api?.isMaximized) {
          const max = await window.api.isMaximized()
          setIsMaximized(max)
        }
        if (window.api?.getAppVersion) {
          const v = await window.api.getAppVersion()
          if (v) setAppVersion(v)
        }
      } catch {
        // Fallback
      }
    }
    checkMaximized()
  }, [])

  const handleMinimize = () => {
    window.api?.minimize?.()
  }

  const handleMaximize = async () => {
    window.api?.maximize?.()
    try {
      if (window.api?.isMaximized) {
        const max = await window.api.isMaximized()
        setIsMaximized(max)
      } else {
        setIsMaximized((prev) => !prev)
      }
    } catch {
      setIsMaximized((prev) => !prev)
    }
  }

  const handleClose = () => {
    window.api?.close?.()
  }

  return (
    <header
      className="h-8 w-full bg-[#16181b] border-b border-[#2d3036] flex items-center justify-between px-3 select-none text-xs text-gray-300 z-50 shrink-0"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Left: App Logo, Title & Version Badge */}
      <div
        className="flex items-center gap-2 min-w-[200px]"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <img
          src={logoImg}
          alt="Omega Wave Recorder Logo"
          className="w-4 h-4 object-contain filter drop-shadow-[0_0_6px_rgba(0,120,215,0.4)] pointer-events-none"
        />
        <div className="flex items-center gap-1.5 font-semibold text-white tracking-wide">
          <span className="text-omega-accent font-black tracking-normal">OMEGA</span>
          <span className="text-gray-200">Wave Recorder</span>
        </div>
        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#202328] border border-gray-700/60 text-gray-400">
          v{appVersion}
        </span>
      </div>

      {/* Middle: Project Name */}
      <div
        className="flex-1 flex items-center justify-center text-center overflow-hidden px-4"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-1.5 text-xs text-gray-400 truncate font-medium">
          <span className="text-gray-200 truncate">{projectName}</span>
          {isModified && <span className="text-omega-accent font-bold">*</span>}
        </div>
      </div>

      {/* Right: Hybrid View Switcher & Window Controls */}
      <div
        className="flex items-center gap-1.5"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* Hybrid View Mode Toggle */}
        <button
          onClick={onToggleViewMode}
          title={
            viewMode === 'multitrack'
              ? t('view.to_focus', 'Umschalten zur Retro-Einzelspur Fokusansicht')
              : t('view.to_multitrack', 'Umschalten zur Multi-Track 4-Spuren Ansicht')
          }
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded border text-[11px] font-medium transition-all duration-150 active:scale-[0.97] mr-2 ${
            viewMode === 'focus'
              ? 'bg-[#0078d7]/20 border-omega-accent text-blue-300 shadow-[0_0_10px_rgba(0,120,215,0.25)]'
              : 'bg-[#202328] hover:bg-[#282c32] border-gray-700/70 text-gray-300 hover:text-white'
          }`}
        >
          {viewMode === 'multitrack' ? (
            <>
              <Layers size={12} className="text-omega-accent" />
              <span>Multi-Track</span>
            </>
          ) : (
            <>
              <Activity size={12} className="text-[#00ff66]" />
              <span className="text-emerald-300">Retro Fokus</span>
            </>
          )}
        </button>

        {/* Window Controls */}
        <div className="flex items-center">
          <button
            onClick={handleMinimize}
            className="w-8 h-6 flex items-center justify-center hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
            title={t('window.minimize', 'Minimieren')}
          >
            <Minus size={13} />
          </button>
          <button
            onClick={handleMaximize}
            className="w-8 h-6 flex items-center justify-center hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
            title={isMaximized ? t('window.restore', 'Wiederherstellen') : t('window.maximize', 'Maximieren')}
          >
            {isMaximized ? <Copy size={11} className="rotate-90" /> : <Square size={11} />}
          </button>
          <button
            onClick={handleClose}
            className="w-8 h-6 flex items-center justify-center hover:bg-[#c42b1c] hover:text-white text-gray-400 transition-colors"
            title={t('window.close', 'Schließen')}
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </header>
  )
}

export default TitleBar
