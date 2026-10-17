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
require(path.join(root, 'src/main/ipc/audioIpc.ts')).registerAudioIpc()
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
}
run().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => {
  Module._load = load
  if (extension) require.extensions['.ts'] = extension
  else delete require.extensions['.ts']
  if (path.dirname(dir) === path.resolve(os.tmpdir()) && path.basename(dir).startsWith('owr-audio-ipc-')) fs.rmSync(dir, { recursive: true, force: true })
})
