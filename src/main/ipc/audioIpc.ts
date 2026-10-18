import { ipcMain, app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { randomUUID } from 'crypto'
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
  if (!Number.isSafeInteger(dataSize) || dataSize < 0 || dataSize > 0xffffffff - 36 ||
      !Number.isSafeInteger(sampleRate) || sampleRate < 3000 || sampleRate > 384000 ||
      ![1, 2].includes(channels) || dataSize % (channels * 2) !== 0) {
    throw new Error('Ungültige WAV-Parameter oder RIFF-Größenlimit überschritten.')
  }
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

function vorbisPicture(data: Buffer, mime: string): string {
  const mimeBytes = Buffer.from(mime)
  const picture = Buffer.alloc(32 + mimeBytes.length + data.length)
  picture.writeUInt32BE(3, 0)
  picture.writeUInt32BE(mimeBytes.length, 4)
  mimeBytes.copy(picture, 8)
  // Xiph permits all four informational image dimension fields to remain zero.
  picture.writeUInt32BE(data.length, 28 + mimeBytes.length)
  data.copy(picture, 32 + mimeBytes.length)
  return picture.toString('base64')
}

async function appendWavCover(filePath: string, data: Buffer, mime: string): Promise<void> {
  const image = Buffer.concat([Buffer.from([0]), Buffer.from(mime), Buffer.from([0, 3, 0]), data])
  const frame = Buffer.alloc(10)
  frame.write('APIC')
  frame.writeUInt32BE(image.length, 4)
  const size = frame.length + image.length
  if (size > 0x0fffffff) throw new Error('Das Cover ist für ID3 zu groß.')
  const tag = Buffer.from([73, 68, 51, 3, 0, 0, (size >>> 21) & 127, (size >>> 14) & 127, (size >>> 7) & 127, size & 127])
  const header = Buffer.alloc(8)
  header.write('ID3 ')
  header.writeUInt32LE(tag.length + size, 4)
  const chunk = Buffer.concat([header, tag, frame, image, Buffer.alloc((tag.length + size) % 2)])
  const file = await fs.promises.open(filePath, 'r+')
  try {
    const stat = await file.stat()
    if (stat.size + chunk.length - 8 > 0xffffffff) throw new Error('WAV mit Cover überschreitet das RIFF-Größenlimit.')
    await fs.promises.appendFile(filePath, chunk)
    const riffHeader = Buffer.alloc(8)
    riffHeader.write('RIFF')
    riffHeader.writeUInt32LE(stat.size + chunk.length - 8, 4)
    await file.writeFile(riffHeader)
  } finally { await file.close() }
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
      const header = createWavHeader(0, sampleRate, channels)
      await fs.promises.writeFile(resolvedPath, header, { flag: 'wx' })
      logger.info('Audio', 'WAV-Datei initialisiert mit 44-Byte Header', { trackId, resolvedPath, sampleRate, channels })
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
      const chunkBuf = Buffer.isBuffer(buffer)
        ? buffer
        : ArrayBuffer.isView(buffer)
          ? Buffer.from((buffer as any).buffer, (buffer as any).byteOffset, (buffer as any).byteLength)
          : Buffer.from(buffer)
      const file = await fs.promises.open(resolvedPath, 'r+')
      try {
        const stat = await file.stat()
        if (stat.size < 44 || stat.size + chunkBuf.length - 44 > 0xffffffff - 36) throw new Error('Ungültige Aufnahmedatei oder RIFF-Größenlimit erreicht.')
        const { bytesWritten } = await file.write(chunkBuf, 0, chunkBuf.length, stat.size)
        if (bytesWritten !== chunkBuf.length) throw new Error('Der Audioblock konnte nicht vollständig gespeichert werden.')
      } finally { await file.close() }
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

      const file = await fs.promises.open(resolvedPath, 'r+')
      try {
        const stat = await file.stat()
        const existingHeader = Buffer.alloc(44)
        const { bytesRead } = await file.read(existingHeader, 0, 44, 0)
        if (bytesRead !== 44 || existingHeader.toString('ascii', 0, 4) !== 'RIFF' || existingHeader.toString('ascii', 8, 12) !== 'WAVE' || existingHeader.toString('ascii', 36, 40) !== 'data') {
          throw new Error('Die Aufnahmedatei enthält keinen gültigen WAV-Header.')
        }
        const dataSize = stat.size - 44
        if (!Number.isSafeInteger(totalSamples) || totalSamples < 0 || dataSize !== totalSamples * channels * 2) {
          throw new Error('Die gespeicherte Audiolänge stimmt nicht mit der Aufnahme überein.')
        }
        await file.writeFile(createWavHeader(dataSize, sampleRate, channels))
      } finally { await file.close() }
      logger.info('Audio', 'WAV-Datei finalisiert', { trackId, resolvedPath, totalSamples })
      return { success: true, filePath: resolvedPath }
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

  // Export project handler (mixdown or stems)
  ipcMain.handle('export-project', async (_, tracksData: any[], settingsOrPath: any, id3Tags?: Id3Metadata) => {
    logger.info('Audio', 'Export-Projekt IPC aufgerufen', { settingsOrPath, id3Tags })
    return await exportProjectAudio(tracksData, settingsOrPath, id3Tags)
  })
}

export interface ExportSettings {
  format?: 'wav' | 'mp3' | 'flac' | 'ogg' | 'm4a' | 'opus' | string
  path: string
  sampleRate?: number
  bitDepth?: string
  bitrate?: string
  channels?: 'Stereo' | 'Mono' | number | string
  playAfterExport?: boolean
  id3Tags?: Id3Metadata
  mode?: 'mixdown' | 'stems'
  coverPath?: string
}

export interface ExportProjectResult {
  success: true
  path: string
  mode: 'mixdown' | 'stems'
  stems?: string[]
}

interface ActiveRegionItem {
  track: any
  region: any
  resolvedPath: string
}

/**
 * Executes a full-featured project audio export via FFmpeg.
 * Supports mixdown and stems modes, custom format/codecs, sample rate, bit depth,
 * bitrate, stereo/mono, volume gain, micro-fades, offsets, cuts, ID3 tags and cover art.
 * Safely validates all paths to prevent destructive overwriting of recording source files.
 */
export async function exportProjectAudio(
  tracksData: any[],
  settingsOrPath: any,
  maybeId3Tags?: Id3Metadata
): Promise<ExportProjectResult> {
  let settings: ExportSettings

  if (typeof settingsOrPath === 'string') {
    settings = {
      path: settingsOrPath,
      format: (path.extname(settingsOrPath).replace('.', '').toLowerCase() as any) || 'wav',
      sampleRate: 48000,
      channels: 'Stereo',
      playAfterExport: false,
      mode: 'mixdown',
      id3Tags: maybeId3Tags
    }
  } else if (settingsOrPath && typeof settingsOrPath === 'object') {
    settings = { ...settingsOrPath }
    if (maybeId3Tags && !settings.id3Tags) {
      settings.id3Tags = maybeId3Tags
    }
  } else {
    throw new Error('Ungültige Exporteinstellungen übergeben')
  }

  if (!isSafePath(settings.path)) {
    throw new Error('Ungültiger oder unsicherer Ausgabepfad')
  }

  if (settings.format !== undefined && typeof settings.format !== 'string') throw new Error('Ungültiges Exportformat')
  const rawFormat = (settings.format || path.extname(settings.path).replace('.', '') || 'wav').toLowerCase()
  const validFormats = ['wav', 'mp3', 'ogg', 'flac', 'm4a', 'opus']
  if (!validFormats.includes(rawFormat)) throw new Error('Nicht unterstütztes Exportformat')
  const format = rawFormat

  let outputPath = path.resolve(settings.path)
  if (!path.extname(outputPath)) {
    outputPath = `${outputPath}.${format}`
  }

  const sampleRate = settings.sampleRate ?? 48000
  if (!Number.isSafeInteger(sampleRate) || sampleRate < 3000 || sampleRate > 384000) throw new Error('Ungültige Abtastrate')
  if (settings.channels !== undefined && !['Mono', 'Stereo', 1, 2].includes(settings.channels)) throw new Error('Ungültige Kanalzahl')
  if (settings.mode !== undefined && !['mixdown', 'stems'].includes(settings.mode)) throw new Error('Ungültiger Exportmodus')
  const channels = settings.channels === 'Mono' || settings.channels === 1 ? 1 : 2
  const mode = settings.mode === 'stems' ? 'stems' : 'mixdown'
  const bitDepth = settings.bitDepth || '16 Bit'
  const bitrate = typeof settings.bitrate === 'string' && /^\d+(k)?$/i.test(settings.bitrate.trim())
    ? settings.bitrate.trim()
    : '320k'

  const id3Tags = settings.id3Tags
  let coverPath: string | undefined = undefined
  const rawCover = id3Tags?.coverPath || (settings as any).coverPath
  let coverData: Buffer | undefined
  let coverMime = ''
  if (rawCover) {
    if (!isSafePath(rawCover) || !fs.existsSync(rawCover)) throw new Error('Cover-Datei nicht gefunden oder ungültig.')
    coverPath = path.resolve(rawCover)
    coverData = await fs.promises.readFile(coverPath)
    coverMime = coverData.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
      : coverData[0] === 255 && coverData[1] === 216 && coverData[2] === 255 ? 'image/jpeg' : ''
    if (!coverMime) throw new Error('Das Cover muss ein PNG- oder JPEG-Bild sein.')
  }

  if (!Array.isArray(tracksData)) {
    throw new Error('Ungültige Spurdaten übergeben')
  }
  const sourcePaths: string[] = []
  if (coverPath) sourcePaths.push(coverPath)
  for (const track of tracksData) {
    if (!track || !Array.isArray(track.regions)) throw new Error('Ungültige Spurdaten')
    if (track.volume !== undefined && (!Number.isFinite(track.volume) || track.volume < 0)) throw new Error('Ungültige Spurlautstärke')
    for (const region of track.regions) {
      if (!region || !isSafePath(region.file?.path) || !Number.isFinite(region.duration) || region.duration <= 0) throw new Error('Ungültige Audioregion')
      for (const field of ['startPos', 'sourceOffset', 'gain', 'fadeIn', 'fadeOut']) {
        if (region[field] !== undefined && (!Number.isFinite(region[field]) || region[field] < 0)) throw new Error(`Ungültiger Regionswert: ${field}`)
      }
      if (!Number.isSafeInteger(Math.round((region.startPos || 0) * sampleRate))) throw new Error('Ungültige Regionsposition')
      sourcePaths.push(path.resolve(resolveAudioPath(region.file.path)))
    }
  }

  const hasSolo = tracksData.some((t) => t.solo)
  const activeTracks = tracksData.filter((t) => {
    if (hasSolo) {
      return t.solo && !t.muted
    }
    return !t.muted
  })

  const allActiveRegions: ActiveRegionItem[] = []
  for (const track of activeTracks) {
    if (Array.isArray(track.regions)) {
      for (const region of track.regions) {
        if (region && region.file && region.file.path) {
          const resolvedPath = path.resolve(resolveAudioPath(region.file.path))
          allActiveRegions.push({ track, region, resolvedPath })
        }
      }
    }
  }

  if (allActiveRegions.length === 0) {
    throw new Error('Keine aktiven Spuren oder Regionen zum Exportieren vorhanden')
  }

  // Prevent destructive export to an existing input region path
  const protectedFiles = sourcePaths.map(sourcePath => ({ path: sourcePath, stat: fs.statSync(sourcePath, { throwIfNoEntry: false, bigint: true }) }))
  const protectSources = (targetFile: string) => {
    const targetStat = fs.statSync(targetFile, { throwIfNoEntry: false, bigint: true })
    for (const source of protectedFiles) {
      const sameFile = targetStat && source.stat?.ino && targetStat.ino === source.stat.ino && targetStat.dev === source.stat.dev
      if (source.path.toLowerCase() === path.resolve(targetFile).toLowerCase() || sameFile) {
        throw new Error(`Destruktiver Export verhindert: Ausgabepfad "${targetFile}" überschreibt Quelldatei "${source.path}".`)
      }
    }
  }
  protectSources(outputPath)

  // Verify all input region files exist on disk
  for (const item of allActiveRegions) {
    if (!fs.existsSync(item.resolvedPath)) {
      throw new Error(`Quelldatei für Region "${item.region.id || item.region.name || 'unbekannt'}" nicht gefunden: ${item.resolvedPath}`)
    }
  }

  // Helper to execute FFmpeg export for a given subset of regions
  const renderFfmpegExport = async (regionsToExport: ActiveRegionItem[], targetFile: string): Promise<string> => {
    protectSources(targetFile)

    const outDir = path.dirname(targetFile)
    await fs.promises.mkdir(outDir, { recursive: true })

    let pictureFile: string | undefined
    if (coverData && (format === 'ogg' || format === 'opus')) {
      pictureFile = path.join(os.tmpdir(), `owr-cover-${randomUUID()}.ffmetadata`)
      await fs.promises.writeFile(pictureFile, `;FFMETADATA1\nMETADATA_BLOCK_PICTURE=${vorbisPicture(coverData, coverMime)}\n`, { flag: 'wx' })
    }

    return new Promise<string>((resolve, reject) => {
      const command = ffmpeg()

      for (const item of regionsToExport) {
        command.input(item.resolvedPath)
      }

      if (pictureFile) {
        command.input(pictureFile).inputFormat('ffmetadata')
      } else if (coverPath && format !== 'wav') {
        command.input(coverPath)
      }

      const filterChain: string[] = []

      for (let i = 0; i < regionsToExport.length; i++) {
        const { track, region } = regionsToExport[i]
        const sourceOffset = typeof region.sourceOffset === 'number' && region.sourceOffset >= 0 ? region.sourceOffset : 0
        const duration = typeof region.duration === 'number' && region.duration > 0 ? region.duration : 0.001
        const startPos = typeof region.startPos === 'number' && region.startPos >= 0 ? region.startPos : 0
        const fadeIn = typeof region.fadeIn === 'number' && region.fadeIn > 0 ? region.fadeIn : 0
        const fadeOut = typeof region.fadeOut === 'number' && region.fadeOut > 0 ? region.fadeOut : 0

        const trackVol = typeof track.volume === 'number' && track.volume >= 0 ? track.volume : 1.0
        const regionGain = typeof region.gain === 'number' && region.gain >= 0 ? region.gain : 1.0
        const effectiveGain = Math.min(1.5, trackVol) * regionGain
        if (!Number.isFinite(effectiveGain)) throw new Error('Ungültige Regionslautstärke')

        const filters: string[] = []
        filters.push(`atrim=start=${sourceOffset.toFixed(9)}:duration=${duration.toFixed(9)}`)
        filters.push('asetpts=PTS-STARTPTS')

        if (fadeIn > 0) {
          filters.push(`afade=t=in:st=0:d=${Math.min(fadeIn, duration).toFixed(9)}`)
        }
        if (fadeOut > 0) {
          const fadeOutStart = Math.max(0, duration - fadeOut)
          filters.push(`afade=t=out:st=${fadeOutStart.toFixed(9)}:d=${Math.min(fadeOut, duration).toFixed(9)}`)
        }

        if (Math.abs(effectiveGain - 1.0) > 0.0001) {
          filters.push(`volume=${effectiveGain.toFixed(4)}`)
        }

        filters.push(`aformat=channel_layouts=stereo:sample_rates=${sampleRate}`)

        const delaySamples = Math.round(startPos * sampleRate)
        if (delaySamples > 0) {
          filters.push(`adelay=${delaySamples}S:all=1`)
        }

        if (regionsToExport.length === 1) {
          filterChain.push(`[0:a]${filters.join(',')}[aout]`)
        } else {
          filterChain.push(`[${i}:a]${filters.join(',')}[a${i}]`)
        }
      }

      if (regionsToExport.length > 1) {
        const mixInputs = regionsToExport.map((_, idx) => `[a${idx}]`).join('')
        filterChain.push(`${mixInputs}amix=inputs=${regionsToExport.length}:duration=longest:dropout_transition=0:normalize=0[aout]`)
      }

      command.complexFilter(filterChain)

      if (coverPath && format !== 'wav' && !pictureFile) {
        command.outputOptions('-map', '[aout]', '-map', `${regionsToExport.length}:v`, '-c:v', 'copy')
        command.outputOptions('-disposition:v', 'attached_pic')
        if (format === 'mp3') {
          command.outputOptions('-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)')
        } else if (format === 'ogg' || format === 'flac') {
          command.outputOptions('-disposition:v', 'attached_pic')
        }
      } else {
        command.map('[aout]')
      }

      // Sample Rate & Channels
      command.audioFrequency(sampleRate)
      command.audioChannels(channels)

      // Codecs & Bitrate
      if (format === 'mp3') {
        command.audioCodec('libmp3lame')
        const br = bitrate.toLowerCase().endsWith('k') ? bitrate : `${bitrate}k`
        command.audioBitrate(br)
      } else if (format === 'ogg') {
        command.audioCodec('libvorbis')
        const br = bitrate.toLowerCase().endsWith('k') ? bitrate : `${bitrate}k`
        command.audioBitrate(br)
      } else if (format === 'flac') {
        command.audioCodec('flac')
      } else if (format === 'm4a') {
        command.audioCodec('aac')
        const br = bitrate.toLowerCase().endsWith('k') ? bitrate : `${bitrate}k`
        command.audioBitrate(br)
      } else if (format === 'opus') {
        command.audioCodec('libopus')
        const br = bitrate.toLowerCase().endsWith('k') ? bitrate : `${bitrate}k`
        command.audioBitrate(br)
      } else {
        // WAV bit depth
        if (bitDepth.includes('24')) {
          command.audioCodec('pcm_s24le')
        } else if (bitDepth.includes('32')) {
          command.audioCodec('pcm_f32le')
        } else {
          command.audioCodec('pcm_s16le')
        }
      }

      // ID3 and Vorbis Metadata
      if (id3Tags) {
        const metadataOpts: string[] = ['-map_metadata', pictureFile ? String(regionsToExport.length) : '-1']
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
      if (pictureFile && !id3Tags) command.outputOptions('-map_metadata', String(regionsToExport.length))
      command.format(format === 'm4a' ? 'ipod' : format)

      command
        .save(targetFile)
        .on('end', () => {
          logger.info('Audio', 'Export erfolgreich abgeschlossen', { targetFile })
          resolve(targetFile)
        })
        .on('error', (err) => {
          logger.error('Audio', 'Export fehlgeschlagen (FFmpeg)', err)
          reject(new Error(`FFmpeg-Export fehlgeschlagen: ${err.message}`))
        })
    }).then(async file => {
      if (coverData && format === 'wav') await appendWavCover(file, coverData, coverMime)
      return file
    }).finally(async () => {
      if (pictureFile) await fs.promises.unlink(pictureFile)
    })
  }

  if (mode === 'stems') {
    const dir = path.dirname(outputPath)
    const base = path.parse(outputPath).name
    const ext = `.${format}`
    const exportedStems: string[] = []

    for (const [index, track] of activeTracks.entries()) {
      const trackRegions = allActiveRegions.filter((item) => item.track === track)
      if (trackRegions.length === 0) continue

      const cleanName = (track.name || `Track_${track.index + 1}`).replace(/[/\\?%*:|"<>]/g, '_').trim()
      const stemFile = path.join(dir, `${base}_${index + 1}_${cleanName}${ext}`)
      await renderFfmpegExport(trackRegions, stemFile)
      exportedStems.push(stemFile)
    }

    if (exportedStems.length === 0) {
      throw new Error('Keine Spuren mit Regionen für Stems-Export vorhanden')
    }

    if (settings.playAfterExport) {
      try {
        const { shell } = require('electron')
        if (shell && typeof shell.openPath === 'function') {
          await shell.openPath(dir)
        }
      } catch {}
    }

    return {
      success: true,
      path: outputPath,
      mode: 'stems',
      stems: exportedStems
    }
  } else {
    await renderFfmpegExport(allActiveRegions, outputPath)

    if (settings.playAfterExport) {
      try {
        const { shell } = require('electron')
        if (shell && typeof shell.openPath === 'function') {
          await shell.openPath(outputPath)
        }
      } catch {}
    }

    return {
      success: true,
      path: outputPath,
      mode: 'mixdown'
    }
  }
}
