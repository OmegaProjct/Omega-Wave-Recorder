# Omega Wave Recorder

<p align="center">
  <img src="assets/logo.png" alt="Omega Wave Recorder Logo" width="128" height="128" />
</p>

<p align="center">
  <strong>Schlanker, moderner Multi-Track Audio Recorder für Windows (Omega Media Core).</strong>
</p>

---

## Features
- **Bis zu 4 Spuren Mehrspuraufnahme:** Parallelaufnahme oder Einzelaufnahme (Punch-in / Overdub).
- **OBS-Studio-Methode für Programm-Audio:** Isoliertes Abgreifen einzelner Windows-Prozesse (`Spotify.exe`, `Discord.exe` etc.) via WASAPI Process Loopback ohne Einstreuung von Systemsounds.
- **Hardware- & Line-In Eingänge:** Kristallklare 32-Bit Float PCM Rohsignal-Aufzeichnung ohne Filter.
- **Dynamisches Audioausgangs-Routing:** Schnelle Umschaltung des Abhörgeräts (Systemstandard, Kopfhörer, GoXLR, Boxen) via Web Audio API.
- **Time Ruler & Smart-Cutting:** Ripple Cut mit 3ms Micro-Fade, Davor löschen, Danach löschen.
- **Hybrid-Ansicht:** Kompakte 4-Spur-Stapelung oder vergrößerte Retro-Einzelspuransicht im klassischen Windows-WAV-Recorder-Stil.
- **Vollwertiger ID3v2-Tag-Editor:** Metadaten & Cover-Art direkt beim Export (WAV, MP3, OGG) einbetten.
- **100 % OWEP-Kompatibilität:** `.owrp`-Projekte lassen sich direkt im Omega Wave Editor öffnen und weiterbearbeiten.
- **Integriertes Hilfemenü & Updater:** Benutzerhandbuch, Changelog, Update-Downloader, Logs, Feedback, Nachrichtencenter, PayPal-Support.

---

## Entwicklung

```bash
# Abhängigkeiten installieren
npm install

# Entwicklungsmodus starten
npm run dev

# Typen überprüfen
npm run typecheck

# Produktions-Bundle kompilieren
npm run build
```

---

## Lizenz
© 2026 Omega Projects. Alle Rechte vorbehalten.
