import React from 'react'
import { BookOpen, X, Mic, Monitor, Scissors, Layers, Download, Keyboard } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface ManualModalProps {
  onClose: () => void
}

export const ManualModal: React.FC<ManualModalProps> = ({ onClose }) => {
  const { t } = useTranslation()

  // Close on Escape
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[5000] p-6 select-none animate-in fade-in duration-150">
      <div className="bg-[#24272c] border border-gray-700/80 w-full max-w-4xl h-[700px] max-h-[92vh] rounded-xl shadow-2xl flex flex-col overflow-hidden text-xs text-gray-300">
        {/* Header */}
        <div className="bg-[#1a1d21] px-6 py-4 border-b border-gray-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <BookOpen size={18} className="text-omega-accent" />
            <h2 className="text-sm font-bold text-white tracking-wide">
              {t('manual.title', 'Omega Wave Recorder – Benutzerhandbuch')}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-8 space-y-8 bg-[#1e2124]/40 custom-scrollbar leading-relaxed">
          {/* 1. Einführung */}
          <section className="space-y-2">
            <h3 className="text-base font-bold text-white border-b border-gray-800 pb-2 flex items-center gap-2">
              <span className="w-2 h-2 rounded bg-omega-accent" />
              1. Einführung & Systemarchitektur
            </h3>
            <p className="text-gray-300">
              Der <strong>Omega Wave Recorder</strong> ist der schlanke, latenzarme Mehrspur-Audiorecorder der Omega Media Core Suite. Er kombiniert Studio-Mikrofonaufnahmen mit direkter Windows-Prozess-Isolierung (WASAPI Process Loopback) in 32-Bit Float PCM.
            </p>
            <p className="text-gray-400 text-[11px]">
              Aufnahmen werden kontinuierlich auf die Festplatte gestreamt (Direct Disk Streaming), sodass Ihre Daten selbst bei einem plötzlichen Stromausfall oder Schließen des Fensters vollständig geschützt bleiben.
            </p>
          </section>

          {/* 2. Die 4 Spuren & Eingangsquellen */}
          <section className="space-y-3">
            <h3 className="text-base font-bold text-white border-b border-gray-800 pb-2 flex items-center gap-2">
              <span className="w-2 h-2 rounded bg-omega-accent" />
              2. Mehrspuraufnahmen & Signalkonfiguration
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-[#1a1d21] p-4 rounded-xl border border-gray-800 space-y-1.5">
                <div className="flex items-center gap-2 font-bold text-white">
                  <Mic size={15} className="text-omega-accent" />
                  <span>Hardware & Audiogeräte</span>
                </div>
                <p className="text-gray-400 text-[11px]">
                  Mikrofone, Line-In, GoXLR, Elgato Wave Link und Voicemeeter werden mit 32-Bit Float AudioWorklets latenzfrei und ohne Windows-Resampling abgegriffen.
                </p>
              </div>

              <div className="bg-[#1a1d21] p-4 rounded-xl border border-gray-800 space-y-1.5">
                <div className="flex items-center gap-2 font-bold text-white">
                  <Monitor size={15} className="text-emerald-400" />
                  <span>WASAPI Process Loopback</span>
                </div>
                <p className="text-gray-400 text-[11px]">
                  Greift das Audio gezielter Programme (z. B. Spotify, Discord, Spiele) isoliert nach PID ab – völlig ohne Einstreuung von Windows-Systemtönen oder anderen Apps.
                </p>
              </div>
            </div>

            <div className="bg-[#16181b] p-3 rounded-lg border border-gray-800/80 text-[11px] text-gray-400">
              <strong>Aufnahmemodi:</strong> Über den Button <code>[● R]</code> wird eine Spur scharfgeschaltet. Ein Klick auf <code>[● REC]</code> startet die synchrone Aufnahme aller scharfen Spuren. Ist nur eine Spur aktiv, können Sie gezielt Punch-in-Aufnahmen über bestehende Spuren legen.
            </div>
          </section>

          {/* 3. Time Ruler & Smart Cutting */}
          <section className="space-y-2">
            <h3 className="text-base font-bold text-white border-b border-gray-800 pb-2 flex items-center gap-2">
              <span className="w-2 h-2 rounded bg-omega-accent" />
              3. Time Ruler & Smart-Cutting-System
            </h3>
            <p className="text-gray-300">
              Der Time Ruler erlaubt das präzise Setzen des Abspielkopfes (Playhead) und das Aufspannen eines In/Out-Bereichs per Ziehen mit der Maus:
            </p>
            <ul className="space-y-2 pl-4 list-disc text-gray-300">
              <li>
                <strong>Bereich schneiden (Strg+X):</strong> Entfernt den markierten Bereich nahtlos mit einem automatischen <strong>3ms Micro-Crossfade</strong>, um Knack- und Klickgeräusche an den Schnittkanten vollständig zu eliminieren.
              </li>
              <li>
                <strong>Vor Abspielposition löschen:</strong> Entfernt den gesamten Anfang bis zum aktuellen Playhead (ideal zum schnellen Trimmen von Vorlauf).
              </li>
              <li>
                <strong>Nach Abspielposition löschen:</strong> Entfernt alle Audiodaten ab dem aktuellen Playhead bis zum Ende.
              </li>
              <li>
                <strong>Undo / Redo (Strg+Z / Strg+Y):</strong> Bis zu 50 Schritte können jederzeit rückgängig gemacht werden.
              </li>
            </ul>
          </section>

          {/* 4. Hybrid-Ansicht */}
          <section className="space-y-2">
            <h3 className="text-base font-bold text-white border-b border-gray-800 pb-2 flex items-center gap-2">
              <span className="w-2 h-2 rounded bg-omega-accent" />
              4. Hybrid-Ansicht (Multi-Track vs. Retro-Fokus)
            </h3>
            <p className="text-gray-300">
              Über den Button oben rechts in der Titelleiste können Sie jederzeit zwischen zwei optimierten Ansichten umschalten:
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-[#1a1d21] p-3.5 rounded-lg border border-gray-800">
                <h4 className="font-bold text-white text-xs mb-1">Multi-Track Layout (Standard)</h4>
                <p className="text-gray-400 text-[11px]">
                  Alle 4 Spuren kompakt untereinander mit eigenem Canvas-Wellenverlauf, Lautstärkefadern und Stereo-VU-Metern.
                </p>
              </div>
              <div className="bg-[#1a1d21] p-3.5 rounded-lg border border-gray-800">
                <h4 className="font-bold text-emerald-400 text-xs mb-1">Retro Fokusansicht</h4>
                <p className="text-gray-400 text-[11px]">
                  Klassische Windows WAV-Recorder-Optik: Eine vergrößerte Oszilloskop-Röhre mit dicker Signallinie und Leuchtphosphor-Gitter. Wechsel per Zifferntasten 1, 2, 3, 4.
                </p>
              </div>
            </div>
          </section>

          {/* 5. Tastatur-Shortcuts */}
          <section className="space-y-2">
            <h3 className="text-base font-bold text-white border-b border-gray-800 pb-2 flex items-center gap-2">
              <Keyboard size={16} className="text-omega-accent" />
              5. Tastatur-Shortcuts Referenz
            </h3>
            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
              <div className="bg-[#16181b] p-2 rounded border border-gray-800 flex justify-between">
                <span className="text-gray-400 font-sans">Wiedergabe / Pause</span>
                <kbd className="text-white font-bold">Leertaste</kbd>
              </div>
              <div className="bg-[#16181b] p-2 rounded border border-gray-800 flex justify-between">
                <span className="text-gray-400 font-sans">Aufnahme starten / stoppen</span>
                <kbd className="text-red-400 font-bold">R</kbd>
              </div>
              <div className="bg-[#16181b] p-2 rounded border border-gray-800 flex justify-between">
                <span className="text-gray-400 font-sans">Bereich schneiden</span>
                <kbd className="text-omega-accent font-bold">Strg + X</kbd>
              </div>
              <div className="bg-[#16181b] p-2 rounded border border-gray-800 flex justify-between">
                <span className="text-gray-400 font-sans">Projekt speichern</span>
                <kbd className="text-white font-bold">Strg + S</kbd>
              </div>
              <div className="bg-[#16181b] p-2 rounded border border-gray-800 flex justify-between">
                <span className="text-gray-400 font-sans">Rückgängig / Wiederholen</span>
                <kbd className="text-white font-bold">Strg + Z / Strg + Y</kbd>
              </div>
              <div className="bg-[#16181b] p-2 rounded border border-gray-800 flex justify-between">
                <span className="text-gray-400 font-sans">Audio exportieren</span>
                <kbd className="text-white font-bold">Strg + E</kbd>
              </div>
              <div className="bg-[#16181b] p-2 rounded border border-gray-800 flex justify-between">
                <span className="text-gray-400 font-sans">Spuren 1-4 anwählen (Fokus)</span>
                <kbd className="text-white font-bold">1, 2, 3, 4</kbd>
              </div>
              <div className="bg-[#16181b] p-2 rounded border border-gray-800 flex justify-between">
                <span className="text-gray-400 font-sans">Zum Anfang / Ende</span>
                <kbd className="text-white font-bold">Pos1 / Ende</kbd>
              </div>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="bg-[#1a1d21] px-6 py-3 border-t border-gray-800 flex items-center justify-between text-[11px] text-gray-500">
          <span>Omega Wave Recorder · Stand: Version 0.1.0</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-[#202328] hover:bg-[#2b2f36] border border-gray-700 text-gray-300 hover:text-white transition-colors"
          >
            Schließen
          </button>
        </div>
      </div>
    </div>
  )
}

export default ManualModal
