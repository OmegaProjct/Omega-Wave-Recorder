# Changelog

The format is based on Keep a Changelog. Dieses Projekt nutzt das klassische Semantic Versioning (`X.Y.Z`).

## [0.1.1] - 2026-10-18

### Deutsch

#### ✨ Neu & Verbessert
- **Echte Mehrspur-Aufnahme**: Reale Hardware- und Loopback-Aufnahme über AudioWorklet und Direct Disk Streaming. Live-Wellenformen wachsen synchron zum Take mit und erzeugen bei Stopp echte Regionen auf der Zeitleiste.
- **Dynamische Sprachumschaltung**: Sofortige Übersetzung aller UI-Komponenten (Menüs, Transportbar, Spuren, Titelleiste, Fokusansicht, Modals) beim Wechsel der Spracheinstellung.
- **Frischer Projektstart & Kompaktes Studio-Layout**: Startet standardmäßig mit leeren Spuren und 00:00.00 Dauer. Kompakte Fenstergröße (800×440px) und optimierte Spurhöhe (74px) für scrollfreie 4-Spur-Bedienung.
- **Spur-Umbenennung**: Direkte Bearbeitung von Spurnamen im Spur-Header per Stift-Icon oder Doppelklick.
- **Präzises Wellenform-Rendering**: Modernes, kontrastreiches Rendering mit RMS-Kern für bestehende Takes und Neon-Phosphor-Signalverlauf während aktiver Aufnahme.

### English

#### ✨ Added & Improved
- **Real Multitrack Recording**: Replaced simulation with 100% real hardware and loopback recording via AudioWorklet and direct disk streaming. Live waveforms grow anchored from recording start and generate real timeline regions on stop.
- **Instant Language Switching**: Dynamic i18n switching immediately re-renders all UI modules (menus, transport bar, track headers/lanes, modals, focus view) without restart.
- **Clean Project Start & Compact Window**: Fresh startup with empty tracks and 00:00.00 duration. Compact 800×440px window and 74px tracks eliminate vertical scrolling.
- **Inline Track Renaming**: Rename tracks directly in the track header via pencil icon or double click.
- **Crisp Waveform Rendering**: High-contrast waveform rendering with RMS core for recorded takes and glowing live take visualization.

## [0.1.0] - 2026-10-17

### Deutsch

#### ✨ Neu
- **Multi-Track Audio Recorder**: Schlankes Aufnahmeprogramm mit bis zu 4 Spuren für parallele Mehrspuraufnahmen oder gezielte Einzelaufnahmen (Overdub / Punch-in).
- **Programm-Audio-Aufnahme**: Isoliertes Abgreifen einzelner Windows-Programme (z. B. Spotify, Discord, Spiele) ohne Einstreuung von Systemsounds über Windows Core Audio (WASAPI Process Loopback).
- **Hardware- & Line-In Eingänge**: Studio-Qualität bei der Aufnahme über Mikrofone, Line-In und Audio-Interfaces (USB-Interfaces, Voicemeeter, Stereo Mix) mit 32-Bit Float PCM.
- **Wählbarer Audioausgang**: Flexible Wahl des Abhörgeräts (Systemstandard, Kopfhörer, Lautsprecher) direkt in der Bedienleiste über die Web Audio API.
- **Time Ruler & Schnittwerkzeuge**: Präziser Schnitt über den Time Ruler für alle Spuren synchron oder isoliert pro Spur mit klickfreiem 3ms Micro-Fade (Bereich schneiden, Vorne löschen, Hinten löschen).
- **Hybrid-Ansicht**: Umschaltbar zwischen kompakter 4-Spur-Stapelung und vergrößerter Retro-Einzelspuransicht im Look des klassischen Windows WAV-Recorders.
- **ID3-Tag-Editor**: Vollwertiger Metadaten- und Cover-Art-Editor beim Export nach WAV, MP3 und OGG.
- **Projektkompatibilität**: Gespeicherte `.owrp`-Projektdateien nutzen dasselbe Datenmodell wie der Omega Wave Editor (`.owep`) und können dort nahtlos weiterbearbeitet werden.
- **Hilfesystem & Updater**: Vollständiges Hilfemenü mit Benutzerhandbuch, Changelog, Update-Downloader, Diagnose-Logs, Feedback und Nachrichtencenter.

### English

#### ✨ Added
- **Multi-Track Audio Recorder**: Lean multitrack audio recorder supporting up to 4 tracks for parallel or punch-in recording.
- **Application Audio Capture**: Isolated capture of specific Windows applications (such as Spotify, Discord, games) without system notification sounds via Windows Core Audio (WASAPI Process Loopback).
- **Hardware & Line-In Inputs**: Studio-quality raw recording for microphones, line-in, and audio interfaces using 32-bit float PCM.
- **Selectable Audio Output**: Flexible monitoring device routing (System Default, Headphones, Speakers) directly from the transport bar via Web Audio API.
- **Time Ruler & Smart Cutting**: Precise cutting via Time Ruler (synchronized across all tracks or per-track) with click-free 3ms micro-crossfades (Range Cut, Delete Before, Delete After).
- **Hybrid View**: Toggle between a compact 4-track layout and an expanded retro single-track focus view inspired by classic Windows Sound Recorder.
- **ID3 Tag Editor**: Full metadata and cover art tagging when exporting to WAV, MP3, and OGG formats.
- **Project Compatibility**: Saved `.owrp` project files are 100% compatible and directly openable in Omega Wave Editor (`.owep`).
- **Help System & Updater**: Full help menu including user manual, changelog, automatic update checker, log viewer, feedback, and message center.
