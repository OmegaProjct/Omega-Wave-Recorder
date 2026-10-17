# Technischer Masterplan: Omega Wave Recorder
**System:** Windows (Electron 30+ / Vite 5 / React 18 / TypeScript / Tailwind CSS)  
**Suite:** Omega Media Core  
**Version:** 2.0.0 (Exhaustiver Detailplan)

---

## 1. Systemarchitektur & Pfadstruktur

### 1.1 Verzeichnis-Konventionen (Omega Media Core Standard)
Die Pfade folgen exakt den Standards der anderen Omega-Tools (z. B. Omega Wave Editor):

* **AppData (Konfiguration & Laufzeitdaten):**  
  `%APPDATA%\OmegaProjects\Omega Media Core\Omega Wave Recorder\`
  * `settings.json`: Persistierte Programmeinstellungen, Ausgabegeräte, stummgeschaltete Warnungen.
  * `logs\session_YYYY-MM-DD_HH-mm-ss.log`: Sitzungsbasierte Diagnose-Logs (automatische Rotation: max. 30 Sitzungen).
  * `cache\`: Temporäre Peak-Daten und Waveform-Caches.

* **Dokumente (Nutzerprojekte & Aufnahmen):**  
  `%USERPROFILE%\Documents\OmegaProjects\Omega Media Core\Omega Wave Recorder\`
  * `Projects\`: Standardpfad für Projektdateien (`*.owrp`).
  * `Recordings\`: Dauerhafte Aufnahmen und Audio-Takes.
  * `Exports\`: Standardpfad für fertige Mixdowns und Stems (WAV, MP3, OGG).
  * `AudioTemp\`: Temporäres Festplatten-Streaming während aktiver Multi-Track-Aufnahmen.

---

## 2. Audio-I/O & Routing-Architektur

```
                                  ┌───────────────────────────────────────────────┐
                                  │            Omega Wave Recorder UI             │
                                  └──────┬─────────────────┬────────────────┬─────┘
                                         │                 │                │
            ┌────────────────────────────┘                 │                └──────────────────────────┐
            ▼                                              ▼                                           ▼
┌───────────────────────┐                      ┌───────────────────────┐                   ┌───────────────────────┐
│ Spur 1: Hardware-Mic  │                      │ Spur 2: Spotify (App) │                   │ Master Output Routing │
└───────────┬───────────┘                      └───────────┬───────────┘                   └───────────┬───────────┘
            │ getUserMedia                                 │ WASAPI Process Loopback                   │ AudioContext.setSinkId
            ▼                                              ▼                                           ▼
┌───────────────────────┐                      ┌───────────────────────┐                   ┌───────────────────────┐
│ Web Audio Worklet     │                      │ Node N-API / Native   │                   │ Gewähltes Audio-      │
│ (32-Bit Float PCM)    │                      │ Loopback Capture      │                   │ Endgerät (Headphones) │
└───────────┬───────────┘                      └───────────┬───────────┘                   └───────────────────────┘
            │                                              │
            └──────────────────────┬───────────────────────┘
                                   │ Direct Disk Streaming
                                   ▼
                      ┌─────────────────────────┐
                      │  AudioTemp/take_*.wav   │
                      └─────────────────────────┘
```

### 2.1 Kategorie 1: Physische & Virtuelle Audio-Eingänge (Hardware / Treiber)
* **Technologie:** `navigator.mediaDevices.getUserMedia()` mit Studio-Constraints:
  ```ts
  const constraints: MediaStreamConstraints = {
    audio: {
      deviceId: { exact: selectedDeviceId },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      sampleRate: 48000,
      channelCount: 2
    }
  }
  ```
* **Signalverarbeitung:** `AudioWorkletNode` (`RecordingProcessor`) puffert Float32-Sample-Blöcke (128 Samples pro Frame), berechnet L/R-Spitzenpegel (0.0 bis 1.0 linear, umgerechnet in dBFS) und streamt Chunks.

### 2.2 Kategorie 2: Anwendungs-Audio (WASAPI Process Loopback)
* **Technologie:** Windows 10 (Build 20348+) / Windows 11 Core Audio API `AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS`:
  * Native Erfassung des Audio-Render-Streams über die Ziel-Prozess-ID (PID) von Programmen wie `Spotify.exe`, `Discord.exe` oder Games.
  * **Echte Prozess-Isolation:** Keine Einstreuung anderer Windows-Sounds, Systemsounds oder Browser-Tabs.
* **Prozess-Enumeration (`loopbackIpc.ts`):**
  * Scannt laufende Fenster und Prozesse mit aktivem Audiorouting.
  * Liefert an den Renderer: `{ pid: number, processName: string, title: string, iconUrl?: string }`.
* **Verhalten bei Verbindungsabbruch:**
  * Wird die Ziel-App geschlossen, generiert der Stream Stille (Zero-Padding) und hält die Zeitachse mit den anderen Spuren synchron.
  * Erscheint ein Verbindungsabbruch, wird ein nicht-blockierender Toast-Hinweis eingeblendet:
    `"Spotify.exe wurde geschlossen. Spur 2 nimmt Stille auf und wartet auf Reconnect."`
  * Checkbox: *"Diesen Hinweis nicht mehr anzeigen"*.
  * Reconnect: Startet die App wieder, klinkt sich der WASAPI-Client nahtlos wieder ein.

### 2.3 Kategorie 3: Wählbarer Audioausgang (Monitoring & Playback)
* **Technologie:** Chromium Web Audio `AudioContext.prototype.setSinkId(deviceId)`.
* **Dropdown im Master-Bereich & in den Einstellungen:**
  * `Systemstandard (Default)` (Geräte-ID `default`).
  * Alle erkannten Audio-Ausgänge (Kopfhörer, Lautsprecher, Audio-Interfaces, HDMI/Monitor).
* **Persistierung:** Ausgewählte `sinkId` wird in `settings.json` gespeichert und beim App-Start automatisch restauriert.

---

## 3. Multi-Track Engine (Bis zu 4 Spuren)

### 3.1 Spuraufbau (`TrackLane.tsx` & `TrackHeader.tsx`)
Jede der 4 Spuren besitzt:
* **Spurname:** Frei editierbar per Doppelklick (z. B. `Spur 1 - Mikrofon`, `Spur 2 - Spotify`).
* **Input-Dropdown:**
  * Gruppe 1: *Audiogeräte* (Mikrofone, Line-In, Stereo Mix, externe Audio-Interfaces, Voicemeeter).
  * Gruppe 2: *Laufende Programme* (Spotify, Discord, Games, Browser etc.).
* **Record-Arm Button (`[● R]`):** Schaltet die Spur für die Aufnahme scharf.
* **Mute (`[M]`):** Stummschalten der Spur bei Wiedergabe und Mixdown.
* **Solo (`[S]`):** Isoliertes Abhören der Spur.
* **Lautstärke-Fader:** Gain 0 % bis 150 % (0.0 bis 1.5).
* **Stereo-VU-Meter:** Vertikaler oder horizontaler dB-Balken (-60 dB bis 0 dBFS mit Farbverlauf Grün -> Gelb -> Rot bei Clipping über -0.5 dBFS).
* **Wellenform-Display:** HTML5 Canvas Wellenform mit Abspielkopf, Auswahlmarkierung und Schnittmarkern.

### 3.2 Aufnahmemodi & Disk-Streaming
* **Parallelaufnahme:** Klick auf Master-Aufnahme (`[● REC]`) startet die synchrone Aufzeichnung aller Spuren, deren `[● R]`-Button aktiv ist.
* **Einzelaufnahme (Punch-in / Overdub):** Klick auf Aufnahme bei nur einer scharfen Spur zeichnet gezielt nur auf dieser Spur auf, während die anderen Spuren synchron abgespielt werden können.
* **Append-Modus:**
  * Modus A (Standard): Neue Aufnahmen werden nahtlos an das bisherige Audioende angefügt (`[...Takes, ...neuerTake]`).
  * Modus B (Cursor-Insert): Aufnahmen starten ab der aktuellen Cursor-Position.
* **Direct Disk Streaming:**
  * Audiodaten werden nicht ausschließlich im RAM gestapelt, sondern parallel als 16-Bit PCM WAV Chunks in `%USERPROFILE%\Documents\...\AudioTemp\` geschrieben.
  * Bei plötzlichem Stromausfall oder App-Schließen gehen Aufnahmen nicht verloren.

---

## 4. Time Ruler & Smart-Cutting-System (Mini-Editing)

### 4.1 Time Ruler (`TimeRuler.tsx`)
* **Skala:** Dynamische Zeitleiste mit Sekunden-, Millisekunden- oder Frame-Ticks, übernommen aus dem Design des Omega Wave Editors.
* **Interaktion:**
  * Klick in den Time Ruler: Verschiebt den globalen Abspielkopf (Playhead).
  * Ziehen im Time Ruler: Spannt einen **globalen In/Out-Auswahlbereich** über alle Spuren auf.
  * Klick/Ziehen innerhalb einer Spur: Spannt einen **lokalen Auswahlbereich** nur auf dieser Spur auf (Shift-Klick erlaubt 2 von 4 Spuren).

### 4.2 Die 3 Schnitt-Modi (Ripple Cut)
1. **Bereich schneiden (In/Out Cut - `Strg+X`):**
   * Entfernt das markierte Intervall `[In .. Out]`.
   * Das nachfolgende Audio rückt nahtlos nach links auf (Ripple Cut).
   * **3ms Micro-Crossfade:** An der Schnittkante wird automatisch eine 3 Millisekunden kurze Überblendung berechnet, um Klick- und Knackgeräusche vollständig zu unterdrücken.
   * *Gültigkeit:* Liegt die Auswahl im Time Ruler -> alle Spuren schneiden. Liegt die Auswahl auf Spur 1 -> nur Spur 1 schneiden.
2. **Vor Abspielposition löschen:**
   * Entfernt alles von `00:00.00` bis zum aktuellen Playhead.
   * Das verbleibende Audio rückt an den Startpunkt `00:00.00`.
3. **Nach Abspielposition löschen:**
   * Entfernt alles vom aktuellen Playhead bis zum Audio-Ende.
4. **Löschen (`Entf`):**
   * Löscht den markierten Bereich.
5. **Undo / Redo (`Strg+Z` / `Strg+Y`):**
   * Vollständiger Snapshot-History-Stack (bis zu 50 Schritte) für alle Schnitte und Aufnahmeschritte.

---

## 5. UI/UX, Design & Hybrid-Ansicht

### 5.1 Farbpalette (1:1 kompatibel zu Omega Wave Editor)
```css
--omega-dark: #1a1d21;       /* App-Hintergrund */
--omega-panel: #282b30;      /* Container & Spurbereiche */
--omega-border: #3b3e45;     /* Rahmen & Divider */
--omega-accent: #0078d7;     /* Buttons, Aktiv-Zustände, Playhead */
--omega-text: #d1d5db;       /* Standardtext */
--omega-text-hover: #ffffff; /* Fokustext */

/* Oszilloskop- & Wellenfarben */
--scope-bg: #0e1114;         /* CRT Display-Hintergrund */
--scope-grid: #1c2420;       /* Oszilloskop-Gitter */
--scope-live: #00ff66;       /* Neon-Grün während Live-Aufnahme */
--scope-wave: #0078d7;       /* Omega-Blau für ruhende/abspielende Wellenform */
--scope-selection: rgba(0, 120, 215, 0.35); /* Schnittmarkierung */
```

### 5.2 Fensterlayout & Hybrid-Ansicht
* **Fenstermaße:** Standard `620 × 340 px`, Mindestmaße `480 × 280 px`, vollständig frei skalierbar.
* **Titelzeile (`TitleBar.tsx`):**
  * Links: Transparentes Neon-Mikrofon-Logo (`assets/logo.png`) + Schriftzug `Omega Wave Recorder` + Versions-Badge (`v1.0.0`).
  * Mitte: Aktueller Projektname (z. B. `Unbenannt.owrp` oder `Podcast_Take1.owrp`).
  * Rechts: Umschalter Hybrid-Ansicht + Minimize, Maximize, Close.
* **Der Hybrid-Umschalter:**
  * **Modus 1 (Multi-Track-Stapelung - Standard):** Alle 4 Spuren kompakt untereinander sichtbar, ideal für Podcasts, Discord-Gespräche oder Streaming.
  * **Modus 2 (Klassische Einzelspur-Fokusansicht):** Eine einzelne ausgewählte Spur wird riesig im Oszilloskop-Stil des alten Windows WAV-Recorders angezeigt (großes Wellenfenster, dicke Amplitudenlinie). Tabs oder Tasten `1, 2, 3, 4` schalten zwischen den Spuren um.
* **Transportleiste (`TransportBar.tsx`):**
  * Buttons: `[⏮ Anfang] [⏪ -1s] [▶ Play / ⏸ Pause] [■ Stop] [⏩ +1s] [⏭ Ende] [● REC]`.
  * Präzise Zeitanzeige: `00:04.20 / 00:18.00` (Minuten:Sekunden.Hundertstel).
  * Sampleraten- & Kanal-Indikator: `48 kHz · 24-Bit Stereo`.
  * Master-Lautstärkeregler & Master-Audioausgangs-Dropdown.

---

## 6. Menüleiste & Modals (1:1 aus Omega Wave Editor)

### 6.1 Vollständige Menüleiste (`MenuBar.tsx`)
* **[Datei]:**
  * `Neues Projekt` (`Strg+N`)
  * `Projekt öffnen...` (`Strg+O`)
  * `Projekt speichern` (`Strg+S`)
  * `Speichern unter...` (`Strg+Umschalt+S`)
  * *Trennlinie*
  * `Audio exportieren...` (`Strg+E`) -> Öffnet `ExportModal`
  * *Trennlinie*
  * `Einstellungen` (`Strg+,`) -> Öffnet `SettingsModal`
  * `Beenden` (`Alt+F4`)
* **[Bearbeiten]:**
  * `Rückgängig` (`Strg+Z`)
  * `Wiederholen` (`Strg+Y`)
  * *Trennlinie*
  * `Bereich schneiden` (`Strg+X`)
  * `Vor Abspielposition löschen`
  * `Nach Abspielposition löschen`
  * `Löschen` (`Entf`)
* **[Hilfe]:**
  * `Benutzerhandbuch` -> Öffnet `ManualModal`
  * `Changelog` -> Öffnet `ChangelogModal`
  * `Auf Updates prüfen` -> Öffnet `UpdateModal`
  * `Logs anzeigen` -> Öffnet `LogViewerModal`
  * `Feedback senden` -> Öffnet Feedback-Tab im `LogViewerModal`
  * `Nachrichtencenter` -> Öffnet `MessageCenterModal`
  * `Über Omega Wave Recorder` -> Öffnet `AboutModal`
  * `Projekt unterstützen (PayPal)` -> Öffnet PayPal-Link im Standard-Browser

### 6.2 Modals im Detail
* **`ExportModal.tsx`:**
  * Formatwahl: `WAV (Microsoft PCM)`, `MP3 (Lame Encoder)`, `OGG (Vorbis)`.
  * Samplerate (44.1 kHz, 48 kHz, 96 kHz) & Bitrate (128, 192, 320 kbps).
  * **Modus:** `Master-Mixdown (alle Spuren)` vs. `Einzelspuren (Stems exportieren)`.
  * **Vollwertiger ID3-Tag-Editor:**
    * Felder: Titel, Interpret, Album, Jahr, Genre, Kommentar, Track-Nummer.
    * Cover-Art-Auswahl (Bildpfad zu JPG/PNG, wird via FFmpeg eingebettet).
* **`SettingsModal.tsx`:**
  * *Reiter Sprache & Internationalisierung (i18n):*
    * Dropdown-Menü zur Sprachauswahl (Standard: Deutsch & English).
    * Erkennt automatisch alle weiteren `.json`-Dateien im Ordner `Locales/`.
    * Sofortige Umschaltung zur Laufzeit ohne Neustart via `i18next.changeLanguage()`.
    * Button: *„Sprachordner im Explorer öffnen“* (ermöglicht Nutzern das unkomplizierte Hinzufügen eigener Sprachen wie Französisch, Spanisch, Japanisch etc.).
    * Automatische Erstellung von `custom_example.json` als leicht verständliche Übersetzungsvorlage.
  * *Reiter Audio:* Standard-Samplerate, Standard-Audioausgang, Standard-Speicherpfade.
  * *Reiter Meldungen & Warnungen:*
    * Zeigt alle stummgeschalteten Hinweise (z. B. *"Warnung bei geschlossenem Programm"*).
    * Button *"Alle Warnungen zurücksetzen"*.
    * Einzelne Toggles pro Warnmeldung.
* **`AboutModal.tsx`:**
  * Zeigt transparentes Mikrofon-Logo (`assets/logo.png`), Versionsnummer, Beschreibung, Copyright © 2026 Omega Projects, GitHub-Button, PayPal-Spendenbutton.

---

## 7. Projektdateiformat (`.owrp`) & Kompatibilität

Projektdateien werden im JSON-Format mit der Endung `.owrp` gespeichert. Sie sind zu **100 % kompatibel zum `.owep`-Format des Omega Wave Editors**:

```json
{
  "format": "OWRP",
  "version": "1.0.0",
  "tracks": [
    {
      "id": "track-1",
      "index": 0,
      "name": "Spur 1 - Mikrofon",
      "muted": false,
      "solo": false,
      "locked": false,
      "visible": true,
      "volume": 1.0,
      "inputSource": {
        "type": "device",
        "deviceId": "default",
        "label": "Mikrofon (HyperX QuadCast)"
      },
      "regions": [
        {
          "id": "reg-1",
          "file": {
            "path": "Recordings/take_track1_2026-10-17.wav",
            "name": "take_track1.wav"
          },
          "startPos": 0.0,
          "duration": 15.42,
          "sourceOffset": 0.0,
          "gain": 1.0
        }
      ]
    },
    {
      "id": "track-2",
      "index": 1,
      "name": "Spur 2 - Spotify",
      "muted": false,
      "solo": false,
      "locked": false,
      "visible": true,
      "volume": 0.85,
      "inputSource": {
        "type": "process",
        "processName": "Spotify.exe",
        "label": "Spotify"
      },
      "regions": [
        {
          "id": "reg-2",
          "file": {
            "path": "Recordings/take_track2_2026-10-17.wav",
            "name": "take_track2.wav"
          },
          "startPos": 0.0,
          "duration": 15.42,
          "sourceOffset": 0.0,
          "gain": 1.0
        }
      ]
    }
  ],
  "settings": {
    "sampleRate": 48000,
    "zoomLevel": 1.0,
    "playheadPos": 0.0
  },
  "metadata": {
    "createdAt": 1776450000,
    "updatedAt": 1776450000,
    "author": "Omega Wave Recorder"
  }
}
```

*Pfad-Relativierung:* Beim Speichern werden alle Audio-Pfade relativ zum Speicherort der `.owrp`-Datei abgelegt. Wird der Projektordner verschoben oder im Omega Wave Editor geöffnet, bleiben alle Verknüpfungen intakt.

---

## 8. Detaillierter Umsetzungsfahrplan (Abarbeitungs-Checkliste)

### Phase 1: Projekt-Setup & Infrastruktur
- [ ] `package.json` anlegen mit Dependencies: `electron`, `electron-builder`, `electron-vite`, `vite`, `react`, `react-dom`, `tailwindcss`, `lucide-react`, `fluent-ffmpeg`, `ffmpeg-static`, `ffprobe-static`, `typescript`.
- [ ] `electron.vite.config.ts`, `tailwind.config.js` und `tsconfig.json` konfigurieren.
- [ ] Verzeichnisstruktur anlegen (`src/main`, `src/preload`, `src/renderer`, `src/common`).
- [ ] `src/main/logger.ts` einrichten (Sitzungs-Logs, automatische Bereinigung).
- [ ] `assets/logo.png` und `assets/app_icon.png` einbinden.

### Phase 2: IPC-Infrastruktur & Audio-Loopback
- [ ] `src/main/ipc/systemIpc.ts`: Fensterkontrollen (`minimize`, `maximize`, `close`), Shell-Links, Dialoge.
- [ ] `src/main/ipc/loopbackIpc.ts`: Windows WASAPI Process Loopback Engine & Enumeration laufender Fenster (`getVisibleWindows`).
- [ ] `src/main/ipc/audioIpc.ts`: FFmpeg-Transcoder (`transcode-export`), Bitraten-Handling, ID3-Metadaten-Injektion.
- [ ] `src/main/ipc/projectIpc.ts`: Speichern/Laden von `.owrp`-Dateien mit relativen Pfaden.
- [ ] `src/main/settingsIpc.ts`: Einstellungen lesen/schreiben (`settings.json`).
- [ ] `src/preload/index.ts`: Typisierte `window.api`-Methoden bereitstellen.

### Phase 3: Core Audio Engines (Renderer)
- [ ] `src/renderer/src/lib/AudioRecordingEngine.ts`:
  - Mikrofon-Capture via `AudioWorklet` (32-Bit Float Chunks).
  - Loopback-Stream-Empfänger via IPC-Events.
  - L/R Peak-Berechnung in Echtzeit für das VU-Meter.
  - Direct Disk Streaming in WAV-Dateien.
- [ ] `src/renderer/src/lib/AudioPlaybackEngine.ts`:
  - Multi-Track Playback via Web Audio API.
  - Mute/Solo/Volume-Routing.
  - `AudioContext.setSinkId()` für dynamische Audioausgabe.
- [ ] `src/renderer/src/lib/WaveformDrawer.ts`:
  - Canvas-Renderer für Live-Oszilloskop (Neon-Grün) und statische Timeline-Wellenformen.

### Phase 4: UI & Multi-Track-Timeline
- [ ] `TitleBar.tsx`: Drag-Bereich, Logo, Titel, Versionsanzeige, Fensterbuttons.
- [ ] `MenuBar.tsx`: Menüleiste mit Tastatur-Shortcuts (`Strg+N`, `Strg+O`, `Strg+S`, `Strg+E`, `Strg+Z` etc.).
- [ ] `TransportBar.tsx`: Play/Pause/Stop/Record, Zeitzähler, Master-Ausgangs-Dropdown, Append-Toggle.
- [ ] `TimeRuler.tsx`: Zeitleiste mit Abspielkopf und globalem In/Out-Bereich.
- [ ] `TrackLane.tsx` & `TrackHeader.tsx`:
  - Bis zu 4 Spuren mit eigenem Input-Dropdown (Hardware vs. App-Prozess).
  - Record-Arm `[● R]`, Mute `[M]`, Solo `[S]`, Gain-Slider.
  - Stereobalken-VU-Meter (-60 dB bis 0 dBFS).
  - Canvas-Wellenform pro Spur.
- [ ] `SingleTrackFocusView.tsx`: Retro-Einzelspuransicht im klassischen Windows-WAV-Recorder-Look.

### Phase 5: Schnittwerkzeuge & Undo/Redo
- [ ] Schnitt-Modus 1: `Bereich schneiden` (Ripple Cut mit 3ms Micro-Fade).
- [ ] Schnitt-Modus 2: `Vor Abspielposition löschen`.
- [ ] Schnitt-Modus 3: `Nach Abspielposition löschen`.
- [ ] Time Ruler vs. Spur-Fokus: Synchroner Gesamtschnitt vs. Einzelspurschnitt.
- [ ] `useHistory.ts`: 50-stufiger Snapshot-Stack für Undo/Redo (`Strg+Z`, `Strg+Y`).

### Phase 6: Export & Modals
- [ ] `ExportModal.tsx`:
  - Summen-Mixdown vs. Einzelspuren (Stems).
  - WAV, MP3, OGG Formate.
  - Vollwertiger ID3-Tag-Editor (Titel, Artist, Album, Jahr, Genre, Cover-Art).
- [ ] `SettingsModal.tsx`:
  - Audio-Einstellungen (Samplerate, Audio-Ausgang).
  - Neuer Reiter *"Meldungen & Warnungen"* zum Wiederherstellen stummgeschalteter Hinweise.
- [ ] Hilfe-Modals: `AboutModal.tsx`, `ChangelogModal.tsx`, `LogViewerModal.tsx`, `ManualModal.tsx`, `UpdateModal.tsx`.

### Phase 7: Verifikation & Build
- [ ] TypeScript Typecheck (`npm run typecheck`).
- [ ] Testaufnahmen:
  1. Mikrofonaufnahme auf Spur 1.
  2. Spotify-Aufnahme auf Spur 2 via Process Loopback.
  3. Parallelaufnahme beider Spuren.
- [ ] Schnitt-Test: Schnitt im Time Ruler prüft synchrone Kürzung beider Spuren ohne Audio-Klicks.
- [ ] Kompatibilitätstest: `.owrp`-Datei erstellen und im Omega Wave Editor öffnen.
- [ ] Export-Test: Mixdown nach MP3 exportieren und ID3-Tags in Windows-Eigenschaften prüfen.
