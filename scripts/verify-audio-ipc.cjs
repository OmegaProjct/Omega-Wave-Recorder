const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owr-audio-ipc-'))
const handlers = new Map()
const load = Module._load
const extension = require.extensions['.ts']
const logger = { info() {}, warn() {}, error() {}, debug() {} }
Module._load = function (name, parent, isMain) {
  if (name === 'electron') return { app: { isPackaged: false, getAppPath: () => root, getPath: () => dir }, ipcMain: { handle: (name, handler) => handlers.set(name, handler) } }
  if (name.endsWith('/logger')) return { logger }
  if (name.endsWith('/settingsIpc')) return { getDocumentsDir: () => dir }
  return load.call(this, name, parent, isMain)
}
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
}).outputText, filename)
const { registerAudioIpc, exportProjectAudio } = require(path.join(root, 'src/main/ipc/audioIpc.ts'))
registerAudioIpc()
const invoke = (name, ...args) => handlers.get(name)({}, ...args)

async function run() {
  const file = path.join(dir, 'take.wav')
  assert.equal((await invoke('init-recording-wav', 'one', file, 44100, 2)).success, true)
  const container = Buffer.alloc(532, 0x5a)
  const pcm = container.subarray(10, 522)
  assert.equal((await invoke('append-recording-chunk', 'one', file, pcm)).success, true)
  const readFile = fs.promises.readFile
  fs.promises.readFile = async () => { throw new Error('Finalization must not read the entire take') }
  try {
    assert.equal((await invoke('finalize-recording-wav', 'one', file, 128, 44100, 2)).success, true)
  } finally { fs.promises.readFile = readFile }
  const wav = fs.readFileSync(file)
  assert.equal(wav.length, 556)
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
  assert.equal(wav.readUInt32LE(24), 44100)
  assert.equal(wav.readUInt32LE(40), 512)
  assert.deepEqual(wav.subarray(44), pcm, 'In-place finalization must preserve every PCM byte')
  assert.equal((await invoke('finalize-recording-wav', 'one', path.join(dir, 'missing.wav'), 0, 44100, 2)).success, false)
  console.log('PASS: real audio IPC initializes, appends exact views, finalizes in constant memory, and reports missing files.')

  const input = path.join(dir, 'input.wav')
  const mutedInput = path.join(dir, 'muted.wav')
  await invoke('init-recording-wav', 'fixture', input, 48000, 2)
  const samples = Buffer.alloc(48000 * 4)
  for (let i = 0; i < 48000; i++) {
    samples.writeInt16LE(i < 12000 ? 8192 : 16384, i * 4)
    samples.writeInt16LE(i < 12000 ? 8192 : 16384, i * 4 + 2)
  }
  await invoke('append-recording-chunk', 'fixture', input, samples)
  await invoke('finalize-recording-wav', 'fixture', input, 48000, 48000, 2)
  fs.copyFileSync(input, mutedInput)
  const sourceBytes = fs.readFileSync(input)
  const track = { id: 'one', name: 'Same name', volume: 0.5, regions: [{ id: 'region', file: { path: input }, startPos: 1 / 48000, sourceOffset: 0.25, duration: 0.02, gain: 0.5 }] }
  const mutedTrack = { ...track, id: 'two', muted: true, regions: [{ ...track.regions[0], file: { path: mutedInput } }] }
  await assert.rejects(exportProjectAudio([track, mutedTrack], { path: mutedInput, format: 'wav' }), /Destruktiver Export/)
  assert.deepEqual(fs.readFileSync(mutedInput), sourceBytes, 'Muted source recordings must also be protected from overwrite')
  const alias = path.join(dir, 'alias.wav')
  fs.linkSync(input, alias)
  await assert.rejects(exportProjectAudio([track], { path: alias, format: 'wav' }), /Destruktiver Export/)
  assert.deepEqual(fs.readFileSync(input), sourceBytes, 'Hard-link aliases must not bypass source protection')

  const output = path.join(dir, 'gain.wav')
  await exportProjectAudio([track], { path: output, format: 'wav', sampleRate: 48000, channels: 'Mono' })
  const ffmpeg = require('ffmpeg-static')
  const { execFileSync } = require('node:child_process')
  const decoded = execFileSync(ffmpeg, ['-v', 'error', '-i', output, '-f', 'f32le', '-ac', '1', '-ar', '48000', 'pipe:1'])
  assert.equal(decoded.readFloatLE(0), 0, 'Timeline position must preserve a one-sample delay')
  assert.ok(Math.abs(decoded.readFloatLE(40) - 0.125) < 0.0001, 'Export must apply source offset, track volume and region gain')

  const stems = await exportProjectAudio([track, { ...track, id: 'two' }], { path: path.join(dir, 'stems.wav'), format: 'wav', mode: 'stems' })
  assert.equal(new Set(stems.stems).size, 2, 'Equal track names must not overwrite another stem')
  assert.deepEqual(fs.readFileSync(input), sourceBytes)
  await assert.rejects(exportProjectAudio([track], { path: path.join(dir, 'invalid.wav'), sampleRate: Infinity }))
  assert.equal(fs.existsSync(path.join(dir, 'invalid.wav')), false, 'Invalid settings must fail before writing an output file')
  console.log('PASS: real FFmpeg protects all sources and exports exact timing, gain and distinct stems.')

  const cover = path.join(dir, 'cover.png')
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=16x16', '-frames:v', '1', cover])
  const ffprobe = require('ffprobe-static').path
  for (const format of ['wav', 'mp3', 'ogg']) {
    const covered = path.join(dir, `covered.${format}`)
    await exportProjectAudio([track], {
      path: covered, format, sampleRate: 48000, channels: 'Stereo', bitrate: '192',
      id3Tags: { title: 'Cover integration test', artist: 'Fixture', coverPath: cover }
    })
    const info = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', covered], { encoding: 'utf8' }))
    // Bundled ffprobe 4 predates WAV cover support; FFmpeg 6 can extract the image.
    if (format === 'wav') {
      const image = execFileSync(ffmpeg, ['-v', 'error', '-i', covered, '-map', '0:v:0', '-c:v', 'copy', '-f', 'image2pipe', 'pipe:1'])
      assert.deepEqual(image, fs.readFileSync(cover))
    } else {
      assert.ok(info.streams.some(stream => stream.codec_type === 'video' && stream.disposition?.attached_pic === 1), `${format} must embed its cover image`)
    }
    const tags = [info.format.tags, ...info.streams.map(stream => stream.tags)]
    assert.ok(tags.some(tags => (tags?.title || tags?.TITLE) === 'Cover integration test'), `${format} must preserve title metadata`)
  }
  console.log('PASS: FFmpeg/ffprobe confirm embedded cover images and titles in WAV, MP3 and OGG.')
}
run().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => {
  Module._load = load
  if (extension) require.extensions['.ts'] = extension
  else delete require.extensions['.ts']
  if (path.dirname(dir) === path.resolve(os.tmpdir()) && path.basename(dir).startsWith('owr-audio-ipc-')) fs.rmSync(dir, { recursive: true, force: true })
})
