import React, { useState, useEffect, useRef } from 'react'
import {
  FileText,
  FolderOpen,
  Save,
  Download,
  Settings,
  Power,
  Undo2,
  Redo2,
  Scissors,
  ArrowLeftToLine,
  ArrowRightToLine,
  Trash2,
  BookOpen,
  FileCode2,
  RefreshCw,
  ScrollText,
  MessageSquare,
  LifeBuoy,
  Info,
  Heart
} from 'lucide-react'

interface MenuBarProps {
  onNewProject: () => void
  onOpenProject: () => void
  onSaveProject: () => void
  onSaveProjectAs: () => void
  onExportAudio: () => void
  onOpenSettings: () => void
  onQuit: () => void
  onUndo: () => void
  onRedo: () => void
  onCutRange: () => void
  onDeleteBefore: () => void
  onDeleteAfter: () => void
  onDeleteSelection: () => void
  onOpenManual: () => void
  onOpenChangelog: () => void
  onCheckUpdates: () => void
  onShowLogs: () => void
  onSendFeedback: () => void
  onOpenMessageCenter: () => void
  onOpenAbout: () => void
  canUndo?: boolean
  canRedo?: boolean
  hasSelection?: boolean
}

type MenuKey = 'file' | 'edit' | 'help' | null

export const MenuBar: React.FC<MenuBarProps> = ({
  onNewProject,
  onOpenProject,
  onSaveProject,
  onSaveProjectAs,
  onExportAudio,
  onOpenSettings,
  onQuit,
  onUndo,
  onRedo,
  onCutRange,
  onDeleteBefore,
  onDeleteAfter,
  onDeleteSelection,
  onOpenManual,
  onOpenChangelog,
  onCheckUpdates,
  onShowLogs,
  onSendFeedback,
  onOpenMessageCenter,
  onOpenAbout,
  canUndo = true,
  canRedo = true,
  hasSelection = false
}) => {
  const [activeMenu, setActiveMenu] = useState<MenuKey>(null)
  const menuBarRef = useRef<HTMLDivElement>(null)

  // Close menu on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuBarRef.current && !menuBarRef.current.contains(e.target as Node)) {
        setActiveMenu(null)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveMenu(null)
    }

    window.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  const handleMenuClick = (menu: MenuKey) => {
    setActiveMenu((current) => (current === menu ? null : menu))
  }

  const handleMenuHover = (menu: MenuKey) => {
    if (activeMenu !== null) {
      setActiveMenu(menu)
    }
  }

  const executeAction = (action: () => void) => {
    setActiveMenu(null)
    action()
  }

  const handleSupportPaypal = () => {
    setActiveMenu(null)
    if (window.api?.openExternal) {
      window.api.openExternal('https://www.paypal.com/paypalme/OmegaProjects')
    } else {
      window.open('https://www.paypal.com/paypalme/OmegaProjects', '_blank')
    }
  }

  return (
    <div
      ref={menuBarRef}
      className="h-7 bg-[#1e2126] border-b border-[#2d3036] flex items-center px-2 select-none text-xs text-gray-300 z-40 shrink-0"
    >
      {/* File Menu */}
      <div className="relative">
        <button
          onClick={() => handleMenuClick('file')}
          onMouseEnter={() => handleMenuHover('file')}
          className={`px-2.5 py-1 rounded text-xs transition-colors duration-100 ${
            activeMenu === 'file'
              ? 'bg-omega-accent text-white'
              : 'hover:bg-[#2c3036] text-gray-300 hover:text-white'
          }`}
        >
          Datei
        </button>

        {activeMenu === 'file' && (
          <div className="absolute top-full left-0 mt-0.5 w-60 bg-[#24272d] border border-gray-700/80 rounded-lg shadow-2xl py-1 text-xs text-gray-200 z-50 animate-in fade-in duration-100 backdrop-blur-md">
            <button
              onClick={() => executeAction(onNewProject)}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-omega-accent hover:text-white transition-colors text-left"
            >
              <span className="flex items-center gap-2">
                <FileText size={14} className="text-gray-400" />
                Neues Projekt
              </span>
              <kbd className="text-[10px] text-gray-400 font-mono">Strg+N</kbd>
            </button>
            <button
              onClick={() => executeAction(onOpenProject)}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-omega-accent hover:text-white transition-colors text-left"
            >
              <span className="flex items-center gap-2">
                <FolderOpen size={14} className="text-gray-400" />
                Projekt öffnen...
              </span>
              <kbd className="text-[10px] text-gray-400 font-mono">Strg+O</kbd>
            </button>
            <button
              onClick={() => executeAction(onSaveProject)}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-omega-accent hover:text-white transition-colors text-left"
            >
              <span className="flex items-center gap-2">
                <Save size={14} className="text-gray-400" />
                Projekt speichern
              </span>
              <kbd className="text-[10px] text-gray-400 font-mono">Strg+S</kbd>
            </button>
            <button
              onClick={() => executeAction(onSaveProjectAs)}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-omega-accent hover:text-white transition-colors text-left"
            >
              <span className="flex items-center gap-2 pl-5">Speichern unter...</span>
              <kbd className="text-[10px] text-gray-400 font-mono">Strg+Shift+S</kbd>
            </button>

            <div className="h-px bg-gray-700/60 my-1" />

            <button
              onClick={() => executeAction(onExportAudio)}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-omega-accent hover:text-white transition-colors text-left"
            >
              <span className="flex items-center gap-2">
                <Download size={14} className="text-omega-accent" />
                Audio exportieren...
              </span>
              <kbd className="text-[10px] text-gray-400 font-mono">Strg+E</kbd>
            </button>

            <div className="h-px bg-gray-700/60 my-1" />

            <button
              onClick={() => executeAction(onOpenSettings)}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-omega-accent hover:text-white transition-colors text-left"
            >
              <span className="flex items-center gap-2">
                <Settings size={14} className="text-gray-400" />
                Einstellungen
              </span>
              <kbd className="text-[10px] text-gray-400 font-mono">Strg+,</kbd>
            </button>

            <div className="h-px bg-gray-700/60 my-1" />

            <button
              onClick={() => executeAction(onQuit)}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-[#c42b1c] hover:text-white transition-colors text-left"
            >
              <span className="flex items-center gap-2">
                <Power size={14} className="text-red-400" />
                Beenden
              </span>
              <kbd className="text-[10px] text-gray-400 font-mono">Alt+F4</kbd>
            </button>
          </div>
        )}
      </div>

      {/* Edit Menu */}
      <div className="relative">
        <button
          onClick={() => handleMenuClick('edit')}
          onMouseEnter={() => handleMenuHover('edit')}
          className={`px-2.5 py-1 rounded text-xs transition-colors duration-100 ${
            activeMenu === 'edit'
              ? 'bg-omega-accent text-white'
              : 'hover:bg-[#2c3036] text-gray-300 hover:text-white'
          }`}
        >
          Bearbeiten
        </button>

        {activeMenu === 'edit' && (
          <div className="absolute top-full left-0 mt-0.5 w-64 bg-[#24272d] border border-gray-700/80 rounded-lg shadow-2xl py-1 text-xs text-gray-200 z-50 animate-in fade-in duration-100 backdrop-blur-md">
            <button
              onClick={() => executeAction(onUndo)}
              disabled={!canUndo}
              className={`w-full px-3 py-1.5 flex items-center justify-between text-left transition-colors ${
                canUndo
                  ? 'hover:bg-omega-accent hover:text-white'
                  : 'opacity-40 cursor-not-allowed'
              }`}
            >
              <span className="flex items-center gap-2">
                <Undo2 size={14} className="text-gray-400" />
                Rückgängig
              </span>
              <kbd className="text-[10px] text-gray-400 font-mono">Strg+Z</kbd>
            </button>
            <button
              onClick={() => executeAction(onRedo)}
              disabled={!canRedo}
              className={`w-full px-3 py-1.5 flex items-center justify-between text-left transition-colors ${
                canRedo
                  ? 'hover:bg-omega-accent hover:text-white'
                  : 'opacity-40 cursor-not-allowed'
              }`}
            >
              <span className="flex items-center gap-2">
                <Redo2 size={14} className="text-gray-400" />
                Wiederherstellen
              </span>
              <kbd className="text-[10px] text-gray-400 font-mono">Strg+Y</kbd>
            </button>

            <div className="h-px bg-gray-700/60 my-1" />

            <button
              onClick={() => executeAction(onCutRange)}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-omega-accent hover:text-white transition-colors text-left"
            >
              <span className="flex items-center gap-2">
                <Scissors size={14} className="text-omega-accent" />
                Bereich schneiden
              </span>
              <kbd className="text-[10px] text-gray-400 font-mono">Strg+X</kbd>
            </button>
            <button
              onClick={() => executeAction(onDeleteBefore)}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-omega-accent hover:text-white transition-colors text-left"
            >
              <span className="flex items-center gap-2">
                <ArrowLeftToLine size={14} className="text-gray-400" />
                Vor Abspielposition löschen
              </span>
            </button>
            <button
              onClick={() => executeAction(onDeleteAfter)}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-omega-accent hover:text-white transition-colors text-left"
            >
              <span className="flex items-center gap-2">
                <ArrowRightToLine size={14} className="text-gray-400" />
                Nach Abspielposition löschen
              </span>
            </button>
            <button
              onClick={() => executeAction(onDeleteSelection)}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-omega-accent hover:text-white transition-colors text-left"
            >
              <span className="flex items-center gap-2">
                <Trash2 size={14} className="text-red-400" />
                Löschen
              </span>
              <kbd className="text-[10px] text-gray-400 font-mono">Entf</kbd>
            </button>
          </div>
        )}
      </div>

      {/* Help Menu */}
      <div className="relative">
        <button
          onClick={() => handleMenuClick('help')}
          onMouseEnter={() => handleMenuHover('help')}
          className={`px-2.5 py-1 rounded text-xs transition-colors duration-100 ${
            activeMenu === 'help'
              ? 'bg-omega-accent text-white'
              : 'hover:bg-[#2c3036] text-gray-300 hover:text-white'
          }`}
        >
          Hilfe
        </button>

        {activeMenu === 'help' && (
          <div className="absolute top-full left-0 mt-0.5 w-64 bg-[#24272d] border border-gray-700/80 rounded-lg shadow-2xl py-1 text-xs text-gray-200 z-50 animate-in fade-in duration-100 backdrop-blur-md">
            <button
              onClick={() => executeAction(onOpenManual)}
              className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-omega-accent hover:text-white transition-colors text-left"
            >
              <BookOpen size={14} className="text-blue-400" />
              Benutzerhandbuch
            </button>
            <button
              onClick={() => executeAction(onOpenChangelog)}
              className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-omega-accent hover:text-white transition-colors text-left"
            >
              <FileCode2 size={14} className="text-emerald-400" />
              Changelog
            </button>
            <button
              onClick={() => executeAction(onCheckUpdates)}
              className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-omega-accent hover:text-white transition-colors text-left"
            >
              <RefreshCw size={14} className="text-sky-400" />
              Auf Updates prüfen
            </button>
            <button
              onClick={() => executeAction(onShowLogs)}
              className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-omega-accent hover:text-white transition-colors text-left"
            >
              <ScrollText size={14} className="text-amber-400" />
              Logs anzeigen
            </button>
            <button
              onClick={() => executeAction(onSendFeedback)}
              className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-omega-accent hover:text-white transition-colors text-left"
            >
              <MessageSquare size={14} className="text-indigo-400" />
              Feedback senden
            </button>
            <button
              onClick={() => executeAction(onOpenMessageCenter)}
              className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-omega-accent hover:text-white transition-colors text-left"
            >
              <LifeBuoy size={14} className="text-cyan-400" />
              Nachrichtencenter
            </button>

            <div className="h-px bg-gray-700/60 my-1" />

            <button
              onClick={() => executeAction(onOpenAbout)}
              className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-omega-accent hover:text-white transition-colors text-left"
            >
              <Info size={14} className="text-omega-accent" />
              Über Omega Wave Recorder
            </button>

            <button
              onClick={handleSupportPaypal}
              className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-[#1d273a] text-blue-300 hover:text-blue-100 transition-colors text-left font-medium"
            >
              <Heart size={14} className="text-pink-400 fill-pink-500/20" />
              Projekt unterstützen (PayPal)
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default MenuBar
