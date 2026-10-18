import assert from 'node:assert/strict'
import { AudioRecordingEngine } from '../src/renderer/src/lib/AudioRecordingEngine'

const originalWindow = (globalThis as any).window
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
const originalWorklet = (globalThis as any).AudioWorkletNode
const node = () => ({ connect() {}, disconnect() {} })
const config = (id: string) => ({ trackId: id, inputSource: { type: 'device' as const, id: 'default', name: 'test' }, tempFilePath: `${id}.wav` })
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

function setup(overrides: Record<string, any> = {}) {
  let stopped = 0
  const rates: number[] = []
  const finalizations: number[] = []
  class Context {
    sampleRate = 44100
    state = 'running'
    destination = {}
    audioWorklet = { addModule: async () => {} }
    createMediaStreamSource = node
    createGain = () => ({ ...node(), gain: { value: 0 } })
  }
  const api = {
    initRecordingWav: async (_id: string, _path: string, rate: number) => { rates.push(rate); return { success: true } },
    appendRecordingChunk: async () => ({ success: true }),
    finalizeRecordingWav: async (_id: string, filePath: string, samples: number) => { finalizations.push(samples); return { success: true, filePath } },
    ...overrides
  }
  ;(globalThis as any).window = { AudioContext: Context, api }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => { stopped++ } }] }) }
  } })
  ;(globalThis as any).AudioWorkletNode = class { port = { onmessage: null }; connect() {}; disconnect() {} }
  const engine = new AudioRecordingEngine()
  const chunk = (id = 'one', length = 44100) => (engine as any).handleAudioChunk(id, new Float32Array(length), new Float32Array(length))
  return { engine, api, chunk, rates, finalizations, stopped: () => stopped }
}

async function run() {
  const gate = deferred()
  let appendCount = 0
  const first = setup({ appendRecordingChunk: async () => { appendCount++; await gate.promise; return { success: true } } })
  await first.engine.startRecording([config('one')], 48000)
  const session = (first.engine as any).sessions.get('one')
  first.chunk()
  first.chunk()
  const stopping = first.engine.stopRecording()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(appendCount, 1, 'Only one append may run per track')
  assert.equal(first.finalizations.length, 0, 'Finalization must wait for pending appends')
  assert.equal(session.chunksL, undefined, 'Complete Float32 takes must not remain in memory')
  gate.resolve()
  const result = await stopping
  assert.equal(appendCount, 2)
  assert.deepEqual(first.rates, [44100], 'The actual context rate must override the requested rate')
  assert.equal(result[0].sampleRate, 44100)
  assert.equal(result[0].duration, 2)
  assert.deepEqual(first.finalizations, [88200])
  assert.equal(first.stopped(), 1)

  const disk = setup({ appendRecordingChunk: async () => ({ success: false, error: 'SIMULATED_DISK_FULL' }) })
  const diskErrors: Error[] = []
  disk.engine.onError(error => diskErrors.push(error))
  await disk.engine.startRecording([config('one')])
  disk.chunk('one', 128)
  await assert.rejects(disk.engine.stopRecording(), /SIMULATED_DISK_FULL/)
  assert.equal(diskErrors.length, 1)
  assert.equal(disk.finalizations.length, 0, 'A failed append cannot become a successful take')
  assert.equal(disk.stopped(), 1)

  const partial = setup()
  const getMedia = navigator.mediaDevices.getUserMedia
  let opens = 0
  ;(navigator.mediaDevices as any).getUserMedia = async () => {
    if (++opens > 1) throw new Error('SECOND_DEVICE_FAILED')
    return getMedia.call(navigator.mediaDevices, {})
  }
  await assert.rejects(partial.engine.startRecording([config('one'), config('two')]), /SECOND_DEVICE_FAILED/)
  assert.equal(partial.stopped(), 1, 'A partial start must release the first device')
  assert.equal((partial.engine as any).sessions.size, 0)

  const worklet = setup()
  ;(globalThis as any).AudioWorkletNode = class { constructor() { throw new Error('WORKLET_FAILED') } }
  await assert.rejects(worklet.engine.startRecording([config('one')]), /WORKLET_FAILED/)
  assert.equal(worklet.stopped(), 1, 'Worklet construction failure must release its media stream')

  const finalize = setup({ finalizeRecordingWav: async (id: string, filePath: string) => id === 'one'
    ? { success: false, error: 'FINALIZE_FAILED' } : { success: true, filePath } })
  await finalize.engine.startRecording([config('one'), config('two')])
  finalize.chunk('one', 128)
  finalize.chunk('two', 128)
  await assert.rejects(finalize.engine.stopRecording(), (error: any) => {
    assert.match(error.message, /FINALIZE_FAILED/)
    assert.equal(error.recordings.length, 1, 'Other successfully saved tracks must remain available')
    assert.equal(error.recordings[0].trackId, 'two')
    return true
  })
  assert.equal(finalize.stopped(), 2, 'Every source must be released even if finalization fails')

  const slowGate = deferred()
  const slow = setup({ appendRecordingChunk: async () => { await slowGate.promise; return { success: true } } })
  let slowError: Error | undefined
  slow.engine.onError(error => { slowError = error })
  await slow.engine.startRecording([config('one')])
  const slowSession = (slow.engine as any).sessions.get('one')
  for (let i = 0; i < 8; i++) slow.chunk()
  assert.match(slowError?.message || '', /Festplatte ist zu langsam/)
  assert.ok(slowSession.pendingSamples <= 5 * 44100, 'Queued PCM must remain bounded')
  assert.ok(slowSession.unwrittenSamples <= 44100, 'The last Float32 buffer must remain bounded')
  assert.equal(slow.stopped(), 1)
  slowGate.resolve()
  await slow.engine.stopRecording()

  const processCapture = setup({ startLoopbackCapture: async () => ({ success: false, error: 'UNSUPPORTED_OS' }) })
  await assert.rejects(processCapture.engine.startRecording([{ ...config('one'), inputSource: { type: 'process', id: '100', pid: 100, name: 'test app' } }]), /UNSUPPORTED_OS/)
  assert.equal(processCapture.engine.isRecording(), false, 'Unsupported capture must never report recording success')
  console.log('PASS: actual recording lifecycle, write ordering/errors, 44.1kHz timing, bounded buffers, and source cleanup.')
}

run().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => {
  ;(globalThis as any).window = originalWindow
  ;(globalThis as any).AudioWorkletNode = originalWorklet
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator)
  else delete (globalThis as any).navigator
})
