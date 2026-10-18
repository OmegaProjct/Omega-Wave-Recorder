# Changelog

The format is based on Keep a Changelog. Dieses Projekt nutzt das klassische Semantic Versioning (`X.Y.Z`).

## [0.1.7] - 2026-10-18

### Deutsch

#### ✨ Neu & Verbessert
- **Erfassung von Windows-Wiedergabegeräten & Audio-Kanälen (Loopback)**: In der Eingangsquellen-Auswahl jeder Spur steht nun die neue Kategorie `── Windows Audio-Kanäle (Loopback) ──` bereit. Hierüber können virtuelle und Hardware-Wiedergabekanäle (wie `Chat`, `Game`, `Music`, `System`, `Sample`) direkt als dedizierte Aufnahmespur ausgewählt werden.
- **Parallele Multi-Track-Aufnahme von Sprache & Chat**: Eingehender Sprachchat (z. B. aus Discord) kann nun zeitgleich mit dem Mikrofon auf getrennten Spuren aufgezeichnet werden.
- **WASAPI-Endpoint-Loopback mit nativer Hardware-Taktung**: Zuverlässige Audioerfassung auch bei Sprechpausen und Stille, ohne Timing-Drift oder Aussetzer.

### English

#### ✨ Added & Improved
- **Windows Playback Endpoints & Audio Channels (Loopback)**: The track input source selector now includes a dedicated `── Windows Audio Channels (Loopback) ──` group. Virtual and hardware playback channels (such as `Chat`, `Game`, `Music`, `System`, `Sample`) can now be selected as independent recording tracks.
- **Parallel Multi-Track Recording of Voice & Chat**: Record incoming voice chat (e.g. from Discord) alongside your microphone on separate, synchronized tracks.
- **WASAPI Endpoint Loopback with Native Hardware Clocking**: Reliable loopback capture even during silent gaps without timing drift or frame loss.

## [0.1.6] - 2026-10-18

### Deutsch

#### 🐛 Behoben & Verbessert
- **Robuste Fehlerbehandlung beim Audio-Export**: `handleExportAudio` validiert nun strikt die Verfügbarkeit der Export-API und wirft eine klare Fehlermeldung, falls die Schnittstelle nicht bereitsteht.
- **Automatisierte UI-Export-Regressionstests**: Erweiterung der Testsuite um vollständige End-to-End-Prüfung des Audio-Exports über Tastenkürzel `E`, inklusive Spurenübergabe, MP3-Konfiguration und API-Absicherung.

### English

#### 🐛 Fixed & Improved
- **Robust Audio Export Error Handling**: `handleExportAudio` strictly validates export API availability and throws clear feedback if unavailable.
- **Automated UI Export Regression Tests**: Expanded test suite with end-to-end verification of keyboard-triggered audio export (`E`), track forwarding, MP3 settings, and error propagation.

## [0.1.5] - 2026-10-18

### Deutsch

#### ✨ Neu & Verbessert
- **1:1 Update-Dialog nach OWE-Standard**: Der Software-Update-Dialog wurde vollständig an das Design des Omega Wave Editors angepasst (großzügiges Studio-Layout, visuelle Versionsgegenüberstellung, zweisprachige Release Notes mit farbigen Kategorie-Badges und Hinweismeldung).
- **Vollständige Download-Telemetrie**: Während des Herunterladens werden nun exakte Werte für die übertragene und gesamte Datenmenge (MB / GB), Download-Geschwindigkeit (MB/s), verbleibende Restzeit sowie ein Abbrechen-Button angezeigt.
- **Dezente Toast-Benachrichtigung**: Bei neuen Releases erscheint beim Start nach 2,5 Sekunden automatisch ein dezenter Benachrichtigungs-Toast mit direkter Option zur Detailansicht.

### English

#### ✨ Added & Improved
- **1:1 Update Modal Matching OWE Standard**: Completely redesigned update experience matching Omega Wave Editor (generous studio layout, visual version comparison, bilingual release notes with category badges, and upgrade warning banner).
- **Full Download Telemetry**: Real-time display of transferred vs. total data (MB / GB), download speed (MB/s), estimated time remaining (ETA), and a cancel download button.
- **Subtle Startup Toast Notification**: Automatically detects new updates 2.5s after launch and presents an elegant floating toast with direct access to release details.

## [0.1.4] - 2026-10-18

### Deutsch

#### 🐛 Behoben & Verbessert
- **Öffentlicher Update-Kanal**: Das Repository ist nun öffentlich geschaltet. Der integrierte Updater kann neueste Releases und Installationspakete nun ohne Authentifizierungsschranken direkt von der GitHub API abrufen.
- **Cache-freie Update-Prüfung**: `check-for-updates` erzwingt nun `no-cache`, um veraltete 304-Zustände zu verhindern.
- **Transparente Fehlerausgabe**: Eventuelle Netzwerk- oder API-Fehler bei der Update-Suche werden nun im Dialog klar angezeigt, anstatt fälschlicherweise „Sie verwenden die neueste Version“ anzuzeigen.

### English

#### 🐛 Fixed & Improved
- **Public Update Channel**: The repository is now publicly accessible. The internal updater fetches latest releases and setup assets without authentication barriers.
- **Cache-Free Update Check**: Added `no-cache` and `no-store` headers to ensure up-to-the-minute release detection.
- **Transparent Error Handling**: Network or API errors during update checks are now clearly shown in the dialog instead of masked as up-to-date.

## [0.1.3] - 2026-10-18

### Deutsch

#### 🐛 Behoben & Verbessert
- **Vollständige Lokalisierung der Programmeinstellungen**: Sämtliche Reiter (Sprache & Lokalisierung, Audio & I/O, Meldungen & Warnungen), Samplerate-Optionen, Speicherpfade und Warnungs-Status sind nun lückenlos in Deutsch und Englisch verfügbar.
- **Audio-Wiedergabe von Aufnahmen repariert**: Aufnahmen werden nun mit absoluten Pfaden im AudioTemp-Verzeichnis gespeichert. Die Playback-Engine lädt Audio-Buffer bei Bedarf on-demand und findet Takes über sichere Fallback-Pfade zuverlässig wieder.
- **Parallele Mehrspur-Aufnahme für mehrere Geräte**: `getUserMedia`-Beschränkungen für Mikrofone wurden auf flexible Hardware-Aushandlung mit Mono/Stereo-Fallback umgestellt. Die Auswahl einer Audioquelle schaltet die Spur automatisch für die Aufnahme scharf.

### English

#### 🐛 Fixed & Improved
- **Complete Settings Modal Localization**: All tabs (Language & Localization, Audio & I/O, Notifications & Warnings), sample rate options, storage paths, and warning badges are now 100% translated into English and German.
- **Audio Recording Playback Resolved**: Recording files are now saved with absolute paths into the dedicated AudioTemp directory. The playback engine loads buffers on demand with safe path resolution fallback.
- **Parallel Multi-Track Recording on Multiple Devices**: Relaxed `getUserMedia` constraints to flexible negotiation with mono/stereo fallback. Selecting an input source now auto-arms the track for instant recording.

## [0.1.2] - 2026-10-18

### Deutsch

#### 🐛 Behoben & Verbessert
- **Interner Software-Updater**: IPC-Schnittstelle zwischen Update-Dialog und Electron-Hauptprozess repariert (`available`, `version`, `releaseNotes`, `downloadUrl`). Der Updater erkennt neue Releases nun zuverlässig, lädt das Setup mit Live-Fortschrittsbalken herunter und startet die Installation auf Knopfdruck.

### English

#### 🐛 Fixed & Improved
- **Internal Software Updater**: Fixed IPC contract between update dialog and Electron main process (`available`, `version`, `releaseNotes`, `downloadUrl`). The updater now reliably detects new GitHub releases, downloads setup with real progress, and triggers installation.

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
