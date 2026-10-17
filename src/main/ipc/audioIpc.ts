import { ipcMain, app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import { logger } from '../logger'
import { isSafePath } from '../utils/pathUtils'
import { getDocumentsDir } from '../settingsIpc'

export function resolveAudioPath(filePath: string): string {
  if (!filePath || typeof filePath !== 'string') return ''
  if (path.isAbsolute(filePath)) {
    return filePath
  }
  const documentsDir = getDocumentsDir()
  const audioTempDir = path.join(documentsDir, 'AudioTemp')
  return path.join(audioTempDir, filePath)
}

// Configure static ffmpeg/ffprobe binary paths with asar.unpacked support
let ffmpegPath: string | null = (ffmpegStatic as unknown as string) || null
let ffprobePath: string = (ffprobeStatic && (ffprobeStatic as any).path) ? (ffprobeStatic as any).path : ''

if (app && app.isPackaged) {
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

/**
 * Creates standard 44-byte WAV header buffer
 */
export function createWavHeader(dataSize: number, sampleRate: number = 48000, channels: number = 2): Buffer {
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

  return header
}

export function registerAudioIpc(): void {
  // Save recording buffer safely to disk
  ipcMain.handle('save-recording', async (_, outputPath: string, arrayBuffer: ArrayBuffer | Buffer) => {
    const resolvedPath = resolveAudioPath(outputPath)
    logger.info('Audio', 'Speichere Audioaufnahme', { outputPath, resolvedPath })
    if (!isSafePath(resolvedPath)) {
      logger.warn('Audio', 'Ungültiger Pfad beim Speichern der Audioaufnahme', { outputPath, resolvedPath })
      return { success: false, error: 'Ungültiger oder unsicherer Pfad' }
    }
    try {
      const dir = path.dirname(resolvedPath)
      await fs.promises.mkdir(dir, { recursive: true })
      const buffer = Buffer.isBuffer(arrayBuffer) ? arrayBuffer : Buffer.from(arrayBuffer)
      await fs.promises.writeFile(resolvedPath, buffer)
      logger.info('Audio', 'Audioaufnahme erfolgreich gespeichert', { resolvedPath, size: buffer.length })
      return { path: resolvedPath, success: true }
    } catch (err: any) {
      logger.error('Audio', 'Fehler beim Speichern der Audioaufnahme', { resolvedPath, error: err.message })
      return { success: false, error: err.message }
    }
  })

  // Initialize recording file by reserving standard 44-byte WAV header on disk
  ipcMain.handle('init-recording-wav', async (_, trackId: string, filePath: string, sampleRate: number = 48000, channels: number = 2) => {
    const resolvedPath = resolveAudioPath(filePath)
    if (!isSafePath(resolvedPath)) {
      return { success: false, error: 'Ungültiger Pfad' }
    }
    try {
      const dir = path.dirname(resolvedPath)
      await fs.promises.mkdir(dir, { recursive: true })
      const actualSampleRate = typeof sampleRate === 'number' && sampleRate > 0 ? sampleRate : 48000
      const actualChannels = typeof channels === 'number' && channels > 0 ? channels : 2
      const header = createWavHeader(0, actualSampleRate, actualChannels)
      await fs.promises.writeFile(resolvedPath, header)
      logger.info('Audio', 'WAV-Datei initialisiert mit 44-Byte Header', { trackId, resolvedPath, actualSampleRate, actualChannels })
      return { success: true, filePath: resolvedPath }
    } catch (err: any) {
      logger.error('Audio', 'Fehler beim Initialisieren der WAV-Datei', { trackId, filePath, resolvedPath, error: err.message })
      return { success: false, error: err.message }
    }
  })

  // Append raw PCM chunk to ongoing recording file on disk
  ipcMain.handle('append-recording-chunk', async (_, trackId: string, filePath: string, buffer: ArrayBuffer) => {
    const resolvedPath = resolveAudioPath(filePath)
    if (!isSafePath(resolvedPath)) {
      return { success: false, error: 'Ungültiger Pfad' }
    }
    try {
      const dir = path.dirname(resolvedPath)
      await fs.promises.mkdir(dir, { recursive: true })
      if (!fs.existsSync(resolvedPath)) {
        // Reserve 44-byte WAV header on creation if not already initialized
        const header = createWavHeader(0, 48000, 2)
        await fs.promises.writeFile(resolvedPath, header)
      }
      const chunkBuf = Buffer.isBuffer(buffer)
        ? buffer
        : ArrayBuffer.isView(buffer)
          ? Buffer.from((buffer as any).buffer, (buffer as any).byteOffset, (buffer as any).byteLength)
          : Buffer.from(buffer)
      await fs.promises.appendFile(resolvedPath, chunkBuf)
      return { success: true }
    } catch (err: any) {
      logger.error('Audio', 'Fehler beim Anhängen des Audio-Chunks', { trackId, filePath, resolvedPath, error: err.message })
      return { success: false, error: err.message }
    }
  })

  // Finalize recorded PCM file by writing standard 44-byte WAV header in O(1) constant memory
  ipcMain.handle('finalize-recording-wav', async (_, trackId: string, filePath: string, totalSamples: number, sampleRate: number = 48000, channels: number = 2) => {
    const resolvedPath = resolveAudioPath(filePath)
    if (!isSafePath(resolvedPath)) {
      return { success: false, error: 'Ungültiger Pfad' }
    }
    try {
      if (!fs.existsSync(resolvedPath)) {
        return { success: false, error: 'Aufnahmedatei existiert nicht' }
      }

      const stat = await fs.promises.stat(resolvedPath)
      const actualSampleRate = typeof sampleRate === 'number' && sampleRate > 0 ? sampleRate : 48000
      const actualChannels = typeof channels === 'number' && channels > 0 ? channels : 2

      let hasRiffHeader = false
      if (stat.size >= 4) {
        const fd = await fs.promises.open(resolvedPath, 'r')
        try {
          const magic = Buffer.alloc(4)
          await fd.read(magic, 0, 4, 0)
          hasRiffHeader = magic.toString('ascii') === 'RIFF'
        } finally {
          await fd.close()
        }
      }

      if (hasRiffHeader) {
        // 44-byte WAV header was reserved at offset 0: patch in-place with O(1) constant memory
        const dataSize = Math.max(0, stat.size - 44)
        const header = createWavHeader(dataSize, actualSampleRate, actualChannels)
        const fd = await fs.promises.open(resolvedPath, 'r+')
        try {
          await fd.write(header, 0, 44, 0)
        } finally {
          await fd.close()
        }
        logger.info('Audio', 'WAV-Datei erfolgreich in-place finalisiert (O(1) Speicher)', {
          trackId,
          resolvedPath,
          dataSize,
          actualSampleRate,
          actualChannels,
          totalSamples
        })
        return { success: true, filePath: resolvedPath }
      } else {
        // File contains raw PCM without reserved header: stream into temp file with header prepended in O(1) bounded memory
        const dataSize = stat.size
        const header = createWavHeader(dataSize, actualSampleRate, actualChannels)
        const tempFinalPath = `${resolvedPath}.finalizing.tmp`

        await new Promise<void>((resolve, reject) => {
          const readStream = fs.createReadStream(resolvedPath)
          const writeStream = fs.createWriteStream(tempFinalPath)
          writeStream.write(header, (err) => {
            if (err) {
              readStream.destroy(err)
              return reject(err)
            }
            readStream.pipe(writeStream)
          })
          writeStream.on('finish', () => resolve())
          writeStream.on('error', (err) => reject(err))
          readStream.on('error', (err) => reject(err))
        })

        await fs.promises.unlink(resolvedPath).catch(() => {})
        await fs.promises.rename(tempFinalPath, resolvedPath)
        logger.info('Audio', 'WAV-Datei erfolgreich per Streaming finalisiert (O(1) Speicher)', {
          trackId,
          resolvedPath,
          dataSize,
          actualSampleRate,
          actualChannels,
          totalSamples
        })
        return { success: true, filePath: resolvedPath }
      }
    } catch (err: any) {
      logger.error('Audio', 'Fehler beim Finalisieren der WAV-Datei', { trackId, filePath, resolvedPath, error: err.message })
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
    let target = resolveAudioPath(filePath)
    if (!fs.existsSync(target)) {
      const documentsDir = getDocumentsDir()
      const base = path.basename(filePath)
      const candidates = [
        path.join(documentsDir, 'AudioTemp', base),
        path.join(documentsDir, 'Recordings', base),
        path.join(process.cwd(), base),
        path.join(app.getPath('userData'), base),
        path.join(path.dirname(app.getPath('exe')), base)
      ]
      for (const cand of candidates) {
        if (fs.existsSync(cand)) {
          target = cand
          break
        }
      }
    }
    if (!isSafePath(target)) {
      logger.warn('Audio', 'Ungültiger Pfad für read-file-buffer', { target, original: filePath })
      throw new Error('Ungültiger Pfad')
    }
    if (!fs.existsSync(target)) {
      logger.error('Audio', 'Datei nicht gefunden für read-file-buffer', { target, original: filePath })
      throw new Error(`Datei nicht gefunden: ${target}`)
    }
    return await fs.promises.readFile(target)
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
