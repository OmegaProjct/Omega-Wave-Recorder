import { ipcMain, app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import { logger } from '../logger'
import { isSafePath } from '../utils/pathUtils'

// Configure static ffmpeg/ffprobe binary paths with asar.unpacked support
let ffmpegPath: string | null = (ffmpegStatic as unknown as string) || null
let ffprobePath: string = (ffprobeStatic && (ffprobeStatic as any).path) ? (ffprobeStatic as any).path : ''

if (app.isPackaged) {
  if (ffmpegPath) {
    ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked')
  }
  if (ffprobePath) {
    ffprobePath = ffprobePath.replace('app.asar', 'app.asar.unpacked')
  }
}

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath)
  logger.info('Audio', `FFmpeg konfiguriert: ${ffmpegPath}`)
} else {
  logger.warn('Audio', 'FFmpeg Binary-Pfad konnte nicht ermittelt werden')
}

if (ffprobePath) {
  ffmpeg.setFfprobePath(ffprobePath)
  logger.info('Audio', `FFprobe konfiguriert: ${ffprobePath}`)
} else {
  logger.warn('Audio', 'FFprobe Binary-Pfad konnte nicht ermittelt werden')
}

export interface Id3Metadata {
  title?: string
  artist?: string
  album?: string
  year?: string
  genre?: string
  track?: string
  comment?: string
  coverPath?: string
}

export interface TranscodeOptions {
  format?: 'wav' | 'mp3' | 'ogg' | 'flac' | string
  sampleRate?: number | string
  bitrate?: number | string
  deleteSource?: boolean
}

export function registerAudioIpc(): void {
  // Save recording buffer safely to disk
  ipcMain.handle('save-recording', async (_, outputPath: string, arrayBuffer: ArrayBuffer | Buffer) => {
    logger.info('Audio', 'Speichere Audioaufnahme', { outputPath })
    if (!isSafePath(outputPath)) {
      logger.warn('Audio', 'Ungültiger Pfad beim Speichern der Audioaufnahme', { outputPath })
      return { success: false, error: 'Ungültiger oder unsicherer Pfad' }
    }
    try {
      const dir = path.dirname(outputPath)
      await fs.promises.mkdir(dir, { recursive: true })
      const buffer = Buffer.isBuffer(arrayBuffer) ? arrayBuffer : Buffer.from(arrayBuffer)
      await fs.promises.writeFile(outputPath, buffer)
      logger.info('Audio', 'Audioaufnahme erfolgreich gespeichert', { outputPath, size: buffer.length })
      return { path: outputPath, success: true }
    } catch (err: any) {
      logger.error('Audio', 'Fehler beim Speichern der Audioaufnahme', { outputPath, error: err.message })
      return { success: false, error: err.message }
    }
  })

  // Append raw PCM chunk to ongoing recording file on disk
  ipcMain.handle('append-recording-chunk', async (_, trackId: string, filePath: string, buffer: ArrayBuffer) => {
    if (!isSafePath(filePath)) {
      return { success: false, error: 'Ungültiger Pfad' }
    }
    try {
      const dir = path.dirname(filePath)
      await fs.promises.mkdir(dir, { recursive: true })
      await fs.promises.appendFile(filePath, Buffer.from(buffer))
      return { success: true }
    } catch (err: any) {
      logger.error('Audio', 'Fehler beim Anhängen des Audio-Chunks', { trackId, filePath, error: err.message })
      return { success: false, error: err.message }
    }
  })

  // Finalize recorded PCM file by writing standard 44-byte WAV header
  ipcMain.handle('finalize-recording-wav', async (_, trackId: string, filePath: string, totalSamples: number, sampleRate: number = 48000, channels: number = 2) => {
    if (!isSafePath(filePath)) {
      return { success: false, error: 'Ungültiger Pfad' }
    }
    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, error: 'Aufnahmedatei existiert nicht' }
      }

      const pcmData = await fs.promises.readFile(filePath)
      const dataSize = pcmData.length
      const header = Buffer.alloc(44)
      const byteRate = sampleRate * channels * 2
      const blockAlign = channels * 2

      header.write('RIFF', 0)
      header.writeUInt32LE(36 + dataSize, 4)
      header.write('WAVE', 8)
      header.write('fmt ', 12)
      header.writeUInt32LE(16, 16)
      header.writeUInt16LE(1, 20)
      header.writeUInt16LE(channels, 22)
      header.writeUInt32LE(sampleRate, 24)
      header.writeUInt32LE(byteRate, 28)
      header.writeUInt16LE(blockAlign, 32)
      header.writeUInt16LE(16, 34)
      header.write('data', 36)
      header.writeUInt32LE(dataSize, 40)

      await fs.promises.writeFile(filePath, Buffer.concat([header, pcmData]))
      logger.info('Audio', `WAV-Datei erfolgreich finalisiert`, { trackId, filePath, dataSize, totalSamples })
      return { success: true }
    } catch (err: any) {
      logger.error('Audio', 'Fehler beim Finalisieren der WAV-Datei', { trackId, filePath, error: err.message })
      return { success: false, error: err.message }
    }
  })

  // Transcode and export with metadata injection and optional cover-art
  ipcMain.handle('transcode-export', async (_, tempWavPath: string, outputPath: string, options: TranscodeOptions, id3Tags?: Id3Metadata) => {
    logger.info('Audio', 'Transcodierung für Export angefordert', { tempWavPath, outputPath, options, id3Tags })
    if (!isSafePath(tempWavPath) || !isSafePath(outputPath)) {
      logger.error('Audio', 'Transcodierung abgebrochen: Ungültige Pfade', { tempWavPath, outputPath })
      throw new Error('Ungültige Pfade für Transcodierung')
    }

    if (!fs.existsSync(tempWavPath)) {
      logger.error('Audio', 'Quelldatei für Transcodierung existiert nicht', { tempWavPath })
      throw new Error(`Quelldatei nicht gefunden: ${tempWavPath}`)
    }

    // Ensure output directory exists
    const outDir = path.dirname(outputPath)
    await fs.promises.mkdir(outDir, { recursive: true })

    return new Promise((resolve, reject) => {
      let hasCover = false
      if (id3Tags && id3Tags.coverPath && isSafePath(id3Tags.coverPath) && fs.existsSync(id3Tags.coverPath)) {
        hasCover = true
      }

      const command = ffmpeg(tempWavPath)
      if (hasCover && id3Tags?.coverPath) {
        command.input(id3Tags.coverPath)
      }

      // Sample Rate
      if (options && options.sampleRate) {
        const parsedRate = parseInt(String(options.sampleRate), 10)
        if (!isNaN(parsedRate) && parsedRate > 0) {
          command.audioFrequency(parsedRate)
        }
      }

      const format = (options && typeof options.format === 'string') ? options.format.toLowerCase() : 'wav'

      if (format === 'mp3') {
        command.audioCodec('libmp3lame')
        const bitrate = options.bitrate ? String(options.bitrate) : '320k'
        command.audioBitrate(bitrate.endsWith('k') ? bitrate : `${bitrate}k`)
      } else if (format === 'ogg') {
        command.audioCodec('libvorbis')
        const bitrate = options.bitrate ? String(options.bitrate) : '192k'
        command.audioBitrate(bitrate.endsWith('k') ? bitrate : `${bitrate}k`)
      } else if (format === 'flac') {
        command.audioCodec('flac')
      } else {
        command.audioCodec('pcm_s16le')
      }

      // Metadata Injection
      if (id3Tags) {
        const metadataOpts: string[] = ['-map_metadata', '-1']
        const isVorbis = format === 'ogg' || format === 'flac'

        if (id3Tags.title) {
          metadataOpts.push('-metadata', `title=${id3Tags.title}`)
          if (isVorbis) metadataOpts.push('-metadata', `TITLE=${id3Tags.title}`)
        }
        if (id3Tags.artist) {
          metadataOpts.push('-metadata', `artist=${id3Tags.artist}`)
          if (isVorbis) metadataOpts.push('-metadata', `ARTIST=${id3Tags.artist}`)
        }
        if (id3Tags.album) {
          metadataOpts.push('-metadata', `album=${id3Tags.album}`)
          if (isVorbis) metadataOpts.push('-metadata', `ALBUM=${id3Tags.album}`)
        }
        if (id3Tags.year) {
          metadataOpts.push('-metadata', `date=${id3Tags.year}`)
          if (isVorbis) metadataOpts.push('-metadata', `DATE=${id3Tags.year}`)
        }
        if (id3Tags.genre) {
          metadataOpts.push('-metadata', `genre=${id3Tags.genre}`)
          if (isVorbis) metadataOpts.push('-metadata', `GENRE=${id3Tags.genre}`)
        }
        if (id3Tags.comment) {
          metadataOpts.push('-metadata', `comment=${id3Tags.comment}`)
          if (isVorbis) metadataOpts.push('-metadata', `COMMENT=${id3Tags.comment}`)
        }
        if (id3Tags.track) {
          metadataOpts.push('-metadata', `track=${id3Tags.track}`)
          if (isVorbis) metadataOpts.push('-metadata', `TRACK=${id3Tags.track}`)
        }

        if (format === 'mp3') {
          metadataOpts.push('-id3v2_version', '3')
        }
        command.outputOptions(...metadataOpts)
      }

      // Cover Art Embedding
      if (hasCover) {
        command.outputOptions('-map', '0:a', '-map', '1:v', '-c:v', 'copy')
        if (format === 'mp3') {
          command.outputOptions('-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)')
        } else if (format === 'ogg' || format === 'flac') {
          command.outputOptions('-disposition:v', 'attached_pic')
        }
      }

      command
        .save(outputPath)
        .on('end', () => {
          // Cleanup temporary WAV file if requested or by default
          const shouldDelete = options.deleteSource !== false
          if (shouldDelete) {
            try {
              if (fs.existsSync(tempWavPath) && path.resolve(tempWavPath) !== path.resolve(outputPath)) {
                fs.unlinkSync(tempWavPath)
                logger.debug('Audio', 'Temporäre WAV-Datei gelöscht', { tempWavPath })
              }
            } catch (err) {
              logger.warn('Audio', 'Fehler beim Bereinigen der temporären WAV-Datei', err)
            }
          }
          logger.info('Audio', 'Transcodierung erfolgreich abgeschlossen', { outputPath })
          resolve(true)
        })
        .on('error', (err) => {
          logger.error('Audio', 'Transcodierung fehlgeschlagen (FFmpeg)', err)
          reject(err)
        })
    })
  })

  // Probe media file info
  ipcMain.handle('get-media-info', async (_, filePath: string) => {
    logger.debug('Audio', 'Lese Medien-Info angefordert', { filePath })
    if (!isSafePath(filePath)) {
      throw new Error('Ungültiger oder unsicherer Dateipfad für Medien-Info')
    }

    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err || !metadata) {
          logger.error('Audio', 'ffprobe-Fehler beim Lesen der Datei', err)
          reject(err || new Error('Keine Medieninformationen gefunden (ffprobe-Fehler)'))
          return
        }

        const format = metadata.format || {}
        const streams = metadata.streams || []
        const rawTags = format.tags || {}
        const tags: Record<string, string> = {}
        for (const key of Object.keys(rawTags)) {
          tags[key.toLowerCase()] = String(rawTags[key])
        }

        const audioStream = streams.find((s: any) => s.codec_type === 'audio')
        const channels = audioStream ? audioStream.channels : 2
        const sampleRate = audioStream && audioStream.sample_rate ? audioStream.sample_rate : 48000
        const bitDepth = audioStream ? audioStream.bits_per_sample : undefined
        const bitrate = format.bit_rate || undefined
        const codec = audioStream ? audioStream.codec_name : ''
        const formatName = format.format_long_name || format.format_name || ''
        const size = format.size || 0

        resolve({
          duration: format.duration || 0,
          channels,
          sampleRate,
          bitDepth,
          bitrate,
          codec,
          formatName,
          size,
          tags: {
            title: tags.title || tags.nam || '',
            artist: tags.artist || tags.composer || tags.performer || '',
            album: tags.album || '',
            year: tags.date || tags.year || tags.creation_time || '',
            genre: tags.genre || '',
            comment: tags.comment || tags.description || '',
            track: tags.track || tags.track_number || ''
          }
        })
      })
    })
  })

  // Read file as raw buffer
  ipcMain.handle('read-file-buffer', async (_, filePath: string) => {
    if (!isSafePath(filePath)) throw new Error('Ungültiger Pfad')
    return await fs.promises.readFile(filePath)
  })

  // Mixdown multi-track project to an output file via FFmpeg filterchain
  ipcMain.handle('export-project', async (_, tracksData: any[], outputPath: string, id3Tags?: Id3Metadata) => {
    logger.info('Audio', 'Mixdown Export-Projekt gestartet', { outputPath, id3Tags })
    if (!isSafePath(outputPath)) {
      throw new Error('Ungültiger Ausgabepfad')
    }

    return new Promise((resolve, reject) => {
      if (!Array.isArray(tracksData)) {
        return reject(new Error('Ungültige Spurdaten übergeben'))
      }

      const hasSolo = tracksData.some((t) => t.solo)
      const activeTracks = tracksData.filter((t) => {
        if (hasSolo) {
          return t.solo && !t.muted
        }
        return !t.muted
      })

      const allRegions = activeTracks.flatMap((t) => (Array.isArray(t.regions) ? t.regions : []))
      if (allRegions.length === 0) {
        return reject(new Error('Keine aktiven Spuren oder Regionen zum Exportieren vorhanden'))
      }

      const command = ffmpeg()
      const filterChain: string[] = []

      allRegions.forEach((region: any) => {
        command.input(region.file.path)
      })

      if (allRegions.length === 1) {
        const region = allRegions[0]
        const sourceOffset = region.sourceOffset || 0
        const delayMs = Math.floor((region.startPos || 0) * 1000)
        filterChain.push(`[0:a]atrim=start=${sourceOffset}:duration=${region.duration},asetpts=PTS-STARTPTS,adelay=${delayMs}|${delayMs}[out]`)
      } else {
        allRegions.forEach((region: any, i: number) => {
          const sourceOffset = region.sourceOffset || 0
          const delayMs = Math.floor((region.startPos || 0) * 1000)
          filterChain.push(`[${i}:a]atrim=start=${sourceOffset}:duration=${region.duration},asetpts=PTS-STARTPTS,adelay=${delayMs}|${delayMs}[a${i}]`)
        })
        const inputs = allRegions.map((_, i) => `[a${i}]`).join('')
        filterChain.push(`${inputs}amix=inputs=${allRegions.length}:duration=longest[out]`)
      }

      command.complexFilter(filterChain).map('[out]')

      if (id3Tags) {
        const metadataOpts: string[] = ['-map_metadata', '-1']
        if (id3Tags.title) metadataOpts.push('-metadata', `title=${id3Tags.title}`)
        if (id3Tags.artist) metadataOpts.push('-metadata', `artist=${id3Tags.artist}`)
        if (id3Tags.album) metadataOpts.push('-metadata', `album=${id3Tags.album}`)
        if (id3Tags.year) metadataOpts.push('-metadata', `date=${id3Tags.year}`)
        if (id3Tags.genre) metadataOpts.push('-metadata', `genre=${id3Tags.genre}`)
        if (id3Tags.comment) metadataOpts.push('-metadata', `comment=${id3Tags.comment}`)
        if (id3Tags.track) metadataOpts.push('-metadata', `track=${id3Tags.track}`)
        metadataOpts.push('-id3v2_version', '3')
        command.outputOptions(...metadataOpts)
      }

      command
        .save(outputPath)
        .on('end', () => {
          logger.info('Audio', 'Mixdown erfolgreich abgeschlossen', { outputPath })
          resolve(true)
        })
        .on('error', (err) => {
          logger.error('Audio', 'Mixdown fehlgeschlagen (FFmpeg)', err)
          reject(err)
        })
    })
  })
}
