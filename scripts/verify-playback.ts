import assert from 'node:assert/strict'
import { AudioPlaybackEngine } from '../src/renderer/src/lib/AudioPlaybackEngine'
import type { Track } from '../src/common/types'

const previous = { window: (globalThis as any).window, raf: globalThis.requestAnimationFrame, cancel: globalThis.cancelAnimationFrame }
let reads = 0
let starts = 0
const param = { value: 1, setTargetAtTime() {}, setValueAtTime() {}, exponentialRampToValueAtTime() {} }
class Context {
  state = 'running'
  sampleRate = 44100
  currentTime = 0
  destination = {}
  createGain = () => ({ gain: { ...param }, connect() {}, disconnect() {} })
  createBufferSource = () => ({ buffer: null, connect() {}, disconnect() {}, start() { starts++ }, stop() {} })
  decodeAudioData = async (buffer: ArrayBuffer) => {
    assert.ok(buffer instanceof ArrayBuffer)
    assert.equal(buffer.byteLength, 44, 'Decode must use the view length, excluding surrounding IPC buffer bytes')
    assert.equal(new Uint8Array(buffer)[0], 123)
    return { duration: 1, sampleRate: 44100, length: 44100, numberOfChannels: 2 }
  }
}
const data = new Uint8Array(100).subarray(17, 61)
data[0] = 123
const api = { readFileBuffer: async (_path: string) => { reads++; return data } }
;(globalThis as any).window = { AudioContext: Context, api }
globalThis.requestAnimationFrame = () => 1
globalThis.cancelAnimationFrame = () => {}
const tracks = (file: string) => [{ id: 'one', volume: 1, regions: [{ id: 'region', file: { path: file }, startPos: 0, duration: 1 }] }] as unknown as Track[]

async function run() {
  const engine = new AudioPlaybackEngine()
  await engine.play(tracks('new.wav'), 0)
  assert.equal(reads, 1, 'Play must preload an uncached project')
  assert.equal(starts, 1)
  assert.equal(engine.getState(), 'playing')
  engine.stop()

  api.readFileBuffer = async () => { throw new Error('MISSING_FILE') }
  await assert.rejects(engine.play(tracks('missing.wav'), 0), /MISSING_FILE/)
  assert.equal(engine.getState(), 'stopped')

  let finish!: (data: Uint8Array) => void
  api.readFileBuffer = () => new Promise(resolve => { finish = resolve })
  const pending = engine.play(tracks('pending.wav'), 0)
  await new Promise(resolve => setImmediate(resolve))
  engine.stop()
  engine.clearCache()
  finish(data)
  await pending
  assert.equal(starts, 1, 'A stopped or replaced project must not start after a delayed read')
  assert.equal(engine.getState(), 'stopped')
  assert.equal((engine as any).bufferCache.has('pending.wav'), false, 'Old loads must not repopulate a cleared cache')

  ;(api as any).readFileBuffer = () => { throw new Error('SYNC_READ_FAILURE') }
  await assert.rejects(engine.loadAudioBuffer('retry.wav'), /SYNC_READ_FAILURE/)
  api.readFileBuffer = async () => data
  await engine.loadAudioBuffer('retry.wav')
  console.log('PASS: actual playback preloads IPC views, reports read failures, and cancels stale loads.')
}
run().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => {
  ;(globalThis as any).window = previous.window
  globalThis.requestAnimationFrame = previous.raf
  globalThis.cancelAnimationFrame = previous.cancel
})
