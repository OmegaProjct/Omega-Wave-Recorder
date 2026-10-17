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
  Info,
  Heart
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

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
  const { t } = useTranslation()
  const [activeMenu, setActiveMenu] = useState<MenuKey>(null)
  const menuBarRef = useRef<HTMLDivElement>(null)

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
      className="h-7 bg-[#1e2126] border-b border-[#2d3036] flex items-center px-2 select-none relative z-40 text-xs text-gray-300 gap-1 shrink-0"
    >
      {/* File Menu */}
      <div className="relative">
        <button
          onClick={() => handleMenuClick('file')}
          onMouseEnter={() => handleMenuHover('file')}
          className={`px-2.5 py-0.5 rounded text-xs transition-colors duration-100 ${
            activeMenu === 'file'
              ? 'bg-omega-accent text-white'
              : 'hover:bg-[#2c3036] text-gray-300 hover:text-white'
          }`}
        >
          {t('menu.file', 'Datei')}
        </button>

        {activeMenu === 'file' && (
          <div className="absolute top-full left-0 mt-0.5 w-60 bg-[#24272d] border border-gray-700/80 rounded-lg shadow-2xl py-1 text-xs text-gray-200 z-50 animate-in fade-in duration-100 backdrop-blur-md">
            <button
              onClick={() => executeAction(onNewProject)}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-omega-accent hover:text-white transition-colors text-left"
            >
              <span className="flex items-center gap-2">
                <FileText size={14} className="text-gray-400" />
                {t('menu.new_project', 'Neues Projekt')}
              </span>
              <kbd className="text-[10px] text-gray-400 font-mono">Strg+N</kbd>
            </button>
            <button
              onClick={() => executeAction(onOpenProject)}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-omega-accent hover:text-white transition-colors text-left"
            >
              <span className="flex items-center gap-2">
                <FolderOpen size={14} className="text-gray-400" />
                {t('menu.open_project', 'Projekt öffnen...')}
              </span>
              <kbd className="text-[10px] text-gray-400 font-mono">Strg+O</kbd>
            </button>
            <button
              onClick={() => executeAction(onSaveProject)}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-omega-accent hover:text-white transition-colors text-left"
            >
              <span className="flex items-center gap-2">
                <Save size={14} className="text-gray-400" />
                {t('menu.save_project', 'Projekt speichern')}
              </span>
              <kbd className="text-[10px] text-gray-400 font-mono">Strg+S</kbd>
            </button>
            <button
              onClick={() => executeAction(onSaveProjectAs)}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-omega-accent hover:text-white transition-colors text-left"
            >
              <span className="flex items-center gap-2 pl-5">
                {t('menu.save_project_as', 'Speichern unter...')}
              </span>
              <kbd className="text-[10px] text-gray-400 font-mono">Strg+Shift+S</kbd>
            </button>

            <div className="h-px bg-gray-700/60 my-1" />

            <button
              onClick={() => executeAction(onExportAudio)}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-omega-accent hover:text-white transition-colors text-left"
            >
              <span className="flex items-center gap-2">
                <Download size={14} className="text-omega-accent" />
                {t('menu.export_audio', 'Audio exportieren...')}
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
                {t('menu.settings', 'Einstellungen')}
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
                {t('menu.quit', 'Beenden')}
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
          className={`px-2.5 py-0.5 rounded text-xs transition-colors duration-100 ${
            activeMenu === 'edit'
              ? 'bg-omega-accent text-white'
              : 'hover:bg-[#2c3036] text-gray-300 hover:text-white'
          }`}
        >
          {t('menu.edit', 'Bearbeiten')}
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
                {t('menu.undo', 'Rückgängig')}
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
                {t('menu.redo', 'Wiederherstellen')}
              </span>
              <kbd className="text-[10px] text-gray-400 font-mono">Strg+Y</kbd>
            </button>

            <div className="h-px bg-gray-700/60 my-1" />

            <button
              onClick={() => executeAction(onCutRange)}
              disabled={!hasSelection}
              className={`w-full px-3 py-1.5 flex items-center justify-between text-left transition-colors ${
                hasSelection
                  ? 'hover:bg-omega-accent hover:text-white'
                  : 'opacity-40 cursor-not-allowed'
              }`}
            >
              <span className="flex items-center gap-2">
                <Scissors size={14} className="text-gray-400" />
                {t('menu.cut_range', 'Bereich schneiden')}
              </span>
              <kbd className="text-[10px] text-gray-400 font-mono">Strg+X</kbd>
            </button>
            <button
              onClick={() => executeAction(onDeleteBefore)}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-omega-accent hover:text-white transition-colors text-left"
            >
              <span className="flex items-center gap-2">
                <ArrowLeftToLine size={14} className="text-gray-400" />
                {t('menu.delete_before', 'Vor Abspielposition löschen')}
              </span>
              <kbd className="text-[10px] text-gray-400 font-mono">[</kbd>
            </button>
            <button
              onClick={() => executeAction(onDeleteAfter)}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-omega-accent hover:text-white transition-colors text-left"
            >
              <span className="flex items-center gap-2">
                <ArrowRightToLine size={14} className="text-gray-400" />
                {t('menu.delete_after', 'Nach Abspielposition löschen')}
              </span>
              <kbd className="text-[10px] text-gray-400 font-mono">]</kbd>
            </button>

            <div className="h-px bg-gray-700/60 my-1" />

            <button
              onClick={() => executeAction(onDeleteSelection)}
              disabled={!hasSelection}
              className={`w-full px-3 py-1.5 flex items-center justify-between text-left transition-colors ${
                hasSelection
                  ? 'hover:bg-red-600 hover:text-white'
                  : 'opacity-40 cursor-not-allowed'
              }`}
            >
              <span className="flex items-center gap-2">
                <Trash2 size={14} className="text-red-400" />
                {t('menu.delete_selection', 'Löschen')}
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
          className={`px-2.5 py-0.5 rounded text-xs transition-colors duration-100 ${
            activeMenu === 'help'
              ? 'bg-omega-accent text-white'
              : 'hover:bg-[#2c3036] text-gray-300 hover:text-white'
          }`}
        >
          {t('menu.help', 'Hilfe')}
        </button>

        {activeMenu === 'help' && (
          <div className="absolute top-full left-0 mt-0.5 w-64 bg-[#24272d] border border-gray-700/80 rounded-lg shadow-2xl py-1 text-xs text-gray-200 z-50 animate-in fade-in duration-100 backdrop-blur-md">
            <button
              onClick={() => executeAction(onOpenManual)}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-omega-accent hover:text-white transition-colors text-left"
            >
              <span className="flex items-center gap-2">
                <BookOpen size={14} className="text-gray-400" />
                {t('menu.manual', 'Benutzerhandbuch')}
              </span>
              <kbd className="text-[10px] text-gray-400 font-mono">F1</kbd>
            </button>
            <button
              onClick={() => executeAction(onOpenChangelog)}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-omega-accent hover:text-white transition-colors text-left"
            >
              <span className="flex items-center gap-2">
                <FileCode2 size={14} className="text-gray-400" />
                {t('menu.changelog', 'Changelog')}
              </span>
            </button>
            <button
              onClick={() => executeAction(onCheckUpdates)}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-omega-accent hover:text-white transition-colors text-left"
            >
              <span className="flex items-center gap-2">
                <RefreshCw size={14} className="text-omega-accent" />
                {t('menu.check_updates', 'Auf Updates prüfen...')}
              </span>
            </button>

            <div className="h-px bg-gray-700/60 my-1" />

            <button
              onClick={() => executeAction(onShowLogs)}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-omega-accent hover:text-white transition-colors text-left"
            >
              <span className="flex items-center gap-2">
                <ScrollText size={14} className="text-gray-400" />
                {t('menu.show_logs', 'Logs anzeigen')}
              </span>
              <kbd className="text-[10px] text-gray-400 font-mono">F12</kbd>
            </button>
            <button
              onClick={() => executeAction(onSendFeedback)}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-omega-accent hover:text-white transition-colors text-left"
            >
              <span className="flex items-center gap-2">
                <MessageSquare size={14} className="text-gray-400" />
                {t('menu.send_feedback', 'Feedback senden')}
              </span>
            </button>
            <button
              onClick={() => executeAction(onOpenMessageCenter)}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-omega-accent hover:text-white transition-colors text-left"
            >
              <span className="flex items-center gap-2">
                <MessageSquare size={14} className="text-gray-400" />
                {t('menu.message_center', 'Nachrichtencenter')}
              </span>
            </button>

            <div className="h-px bg-gray-700/60 my-1" />

            <button
              onClick={() => executeAction(onOpenAbout)}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-omega-accent hover:text-white transition-colors text-left"
            >
              <span className="flex items-center gap-2">
                <Info size={14} className="text-gray-400" />
                {t('menu.about', 'Über Omega Wave Recorder')}
              </span>
            </button>
            <button
              onClick={handleSupportPaypal}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-[#ffc439] hover:text-black transition-colors text-left text-amber-400"
            >
              <span className="flex items-center gap-2">
                <Heart size={14} />
                {t('menu.support_paypal', 'Projekt unterstützen (PayPal)')}
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default MenuBar
