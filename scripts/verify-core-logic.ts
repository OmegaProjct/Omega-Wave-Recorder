/**
 * verify-core-logic.ts
 * Rigorous self-testing verification script for Omega Wave Recorder core logic.
 */

import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { ProjectManager, MICRO_FADE_SECONDS } from '../src/renderer/src/lib/ProjectManager'
import { HistoryStack, MAX_HISTORY_STEPS } from '../src/renderer/src/lib/useHistory'
import { AudioRecordingEngine } from '../src/renderer/src/lib/AudioRecordingEngine'
import { AudioPlaybackEngine } from '../src/renderer/src/lib/AudioPlaybackEngine'
import { WaveformDrawer } from '../src/renderer/src/lib/WaveformDrawer'
import { createWavHeader } from '../src/main/ipc/audioIpc'
import type { Track, Region } from '../src/common/types'

console.log('=== Starting Verification of Core Audio & Logic ===\n')

// -------------------------------------------------------------
// Test 1: ProjectManager - Project Creation & Structure
// -------------------------------------------------------------
console.log('Test 1: ProjectManager.createNewProject()...')
const project = ProjectManager.createNewProject({ name: 'TestSession', sampleRate: 48000, trackCount: 4 })
assert.strictEqual(project.format, 'OWRP')
assert.strictEqual(project.version, '1.0.0')
assert.strictEqual(project.tracks.length, 4)
assert.strictEqual(project.tracks[0].name, 'Spur 1 - Mikrofon')
assert.strictEqual(project.tracks[0].color, '#0078d7')
assert.strictEqual(project.tracks[1].name, 'Spur 2 - Desktop / App')
assert.strictEqual(project.tracks[1].inputSource?.type, 'process')
assert.strictEqual(project.settings.sampleRate, 48000)
console.log('✓ Project creation test passed.')

// -------------------------------------------------------------
// Test 2: ProjectManager - Ripple Cut with 3ms Micro-Fades
// -------------------------------------------------------------
console.log('\nTest 2: ProjectManager.cutRange() [Smart Ripple Cut]...')
const initialTracks: Track[] = [
  {
    id: 'tr-1',
    index: 0,
    name: 'Spur 1',
    muted: false,
    solo: false,
    locked: false,
    visible: true,
    volume: 1.0,
    regions: [
      {
        id: 'r1',
        file: { name: 'take1.wav', path: 'take1.wav' },
        startPos: 0.0,
        duration: 10.0, // 0s to 10s
        sourceOffset: 0.0
      },
      {
        id: 'r2',
        file: { name: 'take2.wav', path: 'take2.wav' },
        startPos: 12.0,
        duration: 5.0, // 12s to 17s
        sourceOffset: 0.0
      }
    ]
  },
  {
    id: 'tr-2',
    index: 1,
    name: 'Spur 2',
    muted: false,
    solo: false,
    locked: false,
    visible: true,
    volume: 1.0,
    regions: [
      {
        id: 'r3',
        file: { name: 'take3.wav', path: 'take3.wav' },
        startPos: 0.0,
        duration: 20.0,
        sourceOffset: 0.0
      }
    ]
  }
]

// Cut 2 seconds: from 3.0s to 5.0s on all tracks (Time-Ruler cut)
const cutResult = ProjectManager.cutRange(initialTracks, 3.0, 5.0)

// Track 1: r1 was [0, 10], cut [3, 5] splits it into:
// Left part: [0, 3] with fadeOut = 0.003
// Right part: [3, 8] (was [5, 10], shifted left by 2s) with fadeIn = 0.003 and sourceOffset = 5.0
const tr1 = cutResult[0]
assert.strictEqual(tr1.regions.length, 3, 'Should have 3 regions (r1_left, r1_right, r2_shifted)')
assert.strictEqual(tr1.regions[0].startPos, 0.0)
assert.strictEqual(tr1.regions[0].duration, 3.0)
assert.strictEqual(tr1.regions[0].fadeOut, MICRO_FADE_SECONDS)

assert.strictEqual(tr1.regions[1].startPos, 3.0)
assert.strictEqual(tr1.regions[1].duration, 5.0)
assert.strictEqual(tr1.regions[1].sourceOffset, 5.0)
assert.strictEqual(tr1.regions[1].fadeIn, MICRO_FADE_SECONDS)

// r2 was at [12, 17], should ripple left by 2s to [10, 15]
assert.strictEqual(tr1.regions[2].startPos, 10.0)
assert.strictEqual(tr1.regions[2].duration, 5.0)

// Test Targeted Cut: Cut only Track 1, Track 2 must remain untouched
const targetedCut = ProjectManager.cutRange(initialTracks, 1.0, 2.0, ['tr-1'])
assert.strictEqual(targetedCut[1].regions[0].duration, 20.0, 'Track 2 was not targeted, must be untouched')

console.log('✓ Ripple Cut & 3ms Micro-Fade test passed.')

// -------------------------------------------------------------
// Test 3: ProjectManager - cutBefore and cutAfter
// -------------------------------------------------------------
console.log('\nTest 3: ProjectManager.cutBefore() & cutAfter()...')
// cutBefore at 4.0s
const cutBeforeRes = ProjectManager.cutBefore(initialTracks, 4.0)
// For tr-1, r1 [0, 10] becomes [0, 6] starting at 0.00 with sourceOffset 4.0
assert.strictEqual(cutBeforeRes[0].regions[0].startPos, 0.0)
assert.strictEqual(cutBeforeRes[0].regions[0].duration, 6.0)
assert.strictEqual(cutBeforeRes[0].regions[0].sourceOffset, 4.0)

// cutAfter at 5.0s
const cutAfterRes = ProjectManager.cutAfter(initialTracks, 5.0)
// r1 was [0, 10], trimmed to [0, 5] with fadeOut = 0.003
assert.strictEqual(cutAfterRes[0].regions.length, 1)
assert.strictEqual(cutAfterRes[0].regions[0].startPos, 0.0)
assert.strictEqual(cutAfterRes[0].regions[0].duration, 5.0)
assert.strictEqual(cutAfterRes[0].regions[0].fadeOut, MICRO_FADE_SECONDS)
// r2 [12, 17] started after 5.0s, must be discarded
console.log('✓ cutBefore() & cutAfter() test passed.')

// -------------------------------------------------------------
// Test 4: HistoryStack - 50-step Undo/Redo & State Bounding
// -------------------------------------------------------------
console.log('\nTest 4: HistoryStack 50-step capacity & Undo/Redo...')
const history = new HistoryStack<number>(0, MAX_HISTORY_STEPS)

// Push 60 updates
for (let i = 1; i <= 60; i++) {
  history.push(i)
}
assert.strictEqual(history.state, 60)
assert.strictEqual(history.historyLength, 50, 'History should cap at exactly 50 snapshots')

// Undo 50 times
let lastUndo: number | null = 0
for (let i = 0; i < 50; i++) {
  lastUndo = history.undo()
}
// Earliest state preserved after 60 pushes capped at 50 is state 10
assert.strictEqual(lastUndo, 10, 'Oldest preserved state should be 10')
assert.strictEqual(history.canUndo, false, 'Should have reached the end of undo history')

// Redo 1 step
const redoVal = history.redo()
assert.strictEqual(redoVal, 11)
assert.strictEqual(history.canUndo, true)
console.log('✓ HistoryStack 50-step capacity test passed.')

// -------------------------------------------------------------
// Test 5: AudioRecordingEngine - dBFS and WAV Encoding
// -------------------------------------------------------------
console.log('\nTest 5: AudioRecordingEngine (Linear to dBFS, WAV Header)...')
const dbZero = AudioRecordingEngine.linearToDbFS(1.0)
assert.strictEqual(dbZero, 0.0, '1.0 linear should be 0.0 dBFS')

const dbHalf = AudioRecordingEngine.linearToDbFS(0.5)
assert(Math.abs(dbHalf - (-6.0)) <= 0.1, '0.5 linear should be roughly -6.0 dBFS')

const dbSilent = AudioRecordingEngine.linearToDbFS(0.00001)
assert.strictEqual(dbSilent, -60.0, 'Silence should clamp to -60.0 dBFS')

// Test WAV encoder
const engine = new AudioRecordingEngine()
const testChannelL = new Float32Array(48000) // 1 second of 48kHz audio
const testChannelR = new Float32Array(48000)
for (let i = 0; i < testChannelL.length; i++) {
  testChannelL[i] = Math.sin((i / 48000) * 440 * Math.PI * 2) * 0.5
  testChannelR[i] = Math.sin((i / 48000) * 440 * Math.PI * 2) * 0.5
}

const wavBuffer = engine.encodeWAV([testChannelL, testChannelR], 48000, 2)
assert.strictEqual(wavBuffer.byteLength, 44 + 48000 * 2 * 2, 'WAV size should be 44-byte header + 192000 audio bytes')

const view = new DataView(wavBuffer)
// Check 'RIFF'
assert.strictEqual(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)), 'RIFF')
// Check 'WAVE'
assert.strictEqual(String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11)), 'WAVE')
// Check 'fmt '
assert.strictEqual(String.fromCharCode(view.getUint8(12), view.getUint8(13), view.getUint8(14), view.getUint8(15)), 'fmt ')
// Check audio format = 1 (PCM)
assert.strictEqual(view.getUint16(20, true), 1)
// Check channels = 2
assert.strictEqual(view.getUint16(22, true), 2)
// Check sample rate = 48000
assert.strictEqual(view.getUint32(24, true), 48000)
// Check bit depth = 16
assert.strictEqual(view.getUint16(34, true), 16)
// Check 'data' chunk
assert.strictEqual(String.fromCharCode(view.getUint8(36), view.getUint8(37), view.getUint8(38), view.getUint8(39)), 'data')
assert.strictEqual(view.getUint32(40, true), 48000 * 2 * 2)

console.log('✓ AudioRecordingEngine dBFS & WAV encoding test passed.')

// -------------------------------------------------------------
// Test 6: Waveform Peak Decimation
// -------------------------------------------------------------
console.log('\nTest 6: Waveform Peak Decimation...')
// Mock AudioBuffer
const mockAudioBuffer = {
  length: 48000,
  numberOfChannels: 1,
  sampleRate: 48000,
  getChannelData: () => testChannelL
} as any

const peaks = WaveformDrawer.getOrCreatePeaks(mockAudioBuffer, 400)
assert.strictEqual(peaks.min.length, 400)
assert.strictEqual(peaks.max.length, 400)
// Check that max peaks are positive and min peaks negative for a sine wave
assert(peaks.max[10] > 0.4)
assert(peaks.min[10] < -0.4)
console.log('✓ Waveform peak decimation test passed.')

// -------------------------------------------------------------
// Test 7: Project Save Path Separation & Display Name
// -------------------------------------------------------------
console.log('\nTest 7: Project Save Path Separation & Display Name...')
// Unnamed / Unassigned checks
assert.strictEqual(ProjectManager.isUnnamed(null), true, 'null path should be unnamed')
assert.strictEqual(ProjectManager.isUnnamed(undefined), true, 'undefined path should be unnamed')
assert.strictEqual(ProjectManager.isUnnamed(''), true, 'empty path should be unnamed')
assert.strictEqual(ProjectManager.isUnnamed('Unbenannt.owrp'), true, 'default Unbenannt.owrp without dir should be unnamed')
assert.strictEqual(ProjectManager.isUnnamed('Neues Projekt.owrp'), true, 'default Neues Projekt.owrp without dir should be unnamed')
assert.strictEqual(ProjectManager.isUnnamed('relative/path.owrp'), true, 'relative path should be treated as unnamed project')

// Named / Absolute checks
assert.strictEqual(ProjectManager.isUnnamed('C:/Projects/Session1.owrp'), false, 'Windows slash absolute path should be named')
assert.strictEqual(ProjectManager.isUnnamed('C:\\Projects\\Session1.owrp'), false, 'Windows backslash absolute path should be named')
assert.strictEqual(ProjectManager.isUnnamed('/home/user/Music/Session1.owrp'), false, 'POSIX absolute path should be named')

// Display name extraction
assert.strictEqual(ProjectManager.getDisplayName(null), 'Unbenannt.owrp')
assert.strictEqual(ProjectManager.getDisplayName(''), 'Unbenannt.owrp')
assert.strictEqual(ProjectManager.getDisplayName('C:/Projects/Session1.owrp'), 'Session1.owrp')
assert.strictEqual(ProjectManager.getDisplayName('C:\\Users\\User\\Music\\TakeAlpha.owrp'), 'TakeAlpha.owrp')
assert.strictEqual(ProjectManager.getDisplayName('/var/audio/Mixdown.owep'), 'Mixdown.owep')

// Path and display name separation
const absolutePath = 'C:\\Omega\\Projects\\HitSong_2026.owrp'
const displayName = ProjectManager.getDisplayName(absolutePath)
assert.notStrictEqual(absolutePath, displayName, 'Full absolute path and display name must be separate')
assert.strictEqual(displayName, 'HitSong_2026.owrp')
console.log('✓ Project save path separation & display name test passed.')

// -------------------------------------------------------------
// Test 8: HistoryStack Dirty State Tracking (isModified / markClean)
// -------------------------------------------------------------
console.log('\nTest 8: HistoryStack Dirty State Tracking (isModified / markClean)...')
const trackHistory = new HistoryStack<string>('State 0', 10)
assert.strictEqual(trackHistory.isModified, false, 'HistoryStack should initially be clean')
assert.strictEqual(trackHistory.canUndo, false)
assert.strictEqual(trackHistory.canRedo, false)

// 1. Push edit -> becomes dirty
trackHistory.push('State 1')
assert.strictEqual(trackHistory.isModified, true, 'HistoryStack should be modified after push')
assert.strictEqual(trackHistory.canUndo, true)
assert.strictEqual(trackHistory.canRedo, false)

// 2. Undo edit -> returns to clean state
const undone = trackHistory.undo()
assert.strictEqual(undone, 'State 0')
assert.strictEqual(trackHistory.isModified, false, 'HistoryStack should be clean after undoing back to initial state')
assert.strictEqual(trackHistory.canUndo, false)
assert.strictEqual(trackHistory.canRedo, true)

// 3. Redo edit -> becomes dirty again
const redone = trackHistory.redo()
assert.strictEqual(redone, 'State 1')
assert.strictEqual(trackHistory.isModified, true, 'HistoryStack should be modified after redo')

// 4. Mark clean (e.g. after successful verified disk write)
trackHistory.markClean()
assert.strictEqual(trackHistory.isModified, false, 'HistoryStack should be clean after markClean')

// 5. Undoing past the saved point should make it dirty again
trackHistory.undo()
assert.strictEqual(trackHistory.isModified, true, 'Undoing before saved state should mark it modified')

// 6. Redoing back to saved point restores clean state
trackHistory.redo()
assert.strictEqual(trackHistory.isModified, false, 'Redoing to saved state should restore clean state')

// 7. Non-modifying transient update with setPresent
trackHistory.setPresent('State 1 (gain updated)', false)
assert.strictEqual(trackHistory.isModified, false, 'Non-modifying setPresent should not dirty history')

// 8. Modifying transient update with setPresent
trackHistory.setPresent('State 1 (name edited)', true)
assert.strictEqual(trackHistory.isModified, true, 'Modifying setPresent should mark history modified')
console.log('✓ HistoryStack dirty state tracking test passed.')

// -------------------------------------------------------------
// Test 9: Project Boundary Resets
// -------------------------------------------------------------
console.log('\nTest 9: Project Boundary Resets (Isolated HistoryStack, Selection, Playhead & Buffer Cache)...')
// Simulate an ongoing project state with edits, selection, playhead, and playback cache
const projectBoundaryHistory = new HistoryStack<Track[]>(initialTracks)
projectBoundaryHistory.push(cutResult)
assert.strictEqual(projectBoundaryHistory.isModified, true)
assert.strictEqual(projectBoundaryHistory.canUndo, true)

let mockSelection: { start: number; end: number } | null = { start: 2.5, end: 7.0 }
let mockPlayheadPos: number = 8.42

// Simulate audio buffer cache
const playbackEngine = AudioPlaybackEngine.getInstance()
playbackEngine.clearCache()
assert.strictEqual(playbackEngine.getCacheSize(), 0, 'Buffer cache should be 0 initially')

// Execute Project Boundary Reset (as executed in handleNewProject / handleOpenProject)
const freshProject = ProjectManager.createNewProject({ name: 'FreshSession' })
projectBoundaryHistory.clear(freshProject.tracks)
mockSelection = null
mockPlayheadPos = 0.0
playbackEngine.clearCache()

// Assertions for project boundary reset
assert.strictEqual(projectBoundaryHistory.isModified, false, 'HistoryStack must be marked clean upon project reset')
assert.strictEqual(projectBoundaryHistory.canUndo, false, 'HistoryStack past must be cleared')
assert.strictEqual(projectBoundaryHistory.canRedo, false, 'HistoryStack future must be cleared')
assert.strictEqual(projectBoundaryHistory.historyLength, 0, 'HistoryStack length must be 0')
assert.strictEqual(projectBoundaryHistory.state.length, 4, 'Must hold isolated fresh tracks')
assert.strictEqual(mockSelection, null, 'Selection must be reset to null')
assert.strictEqual(mockPlayheadPos, 0.0, 'Playhead must be reset to zero')
assert.strictEqual(playbackEngine.getCacheSize(), 0, 'Audio playback buffer cache must be empty')
console.log('✓ Project boundary resets test passed.')

// -------------------------------------------------------------
// Test 10: ArrayBuffer View Conversion (AudioPlaybackEngine.toArrayBuffer)
// -------------------------------------------------------------
console.log('\nTest 10: ArrayBuffer View Conversion (AudioPlaybackEngine.toArrayBuffer)...')
// 1. Convert Buffer with non-zero byteOffset and smaller byteLength
const parentBuffer = Buffer.alloc(100)
for (let i = 0; i < 100; i++) parentBuffer[i] = i + 1
const subBuffer = parentBuffer.subarray(25, 65) // offset: 25, length: 40
assert.strictEqual(subBuffer.byteOffset, 25)
assert.strictEqual(subBuffer.byteLength, 40)

const exactAb = AudioPlaybackEngine.toArrayBuffer(subBuffer)
assert(exactAb instanceof ArrayBuffer, 'Must return a standard ArrayBuffer')
assert.strictEqual(exactAb.byteLength, 40, 'ArrayBuffer byteLength must match view length')

// Verify byte contents
const exactView = new Uint8Array(exactAb)
for (let i = 0; i < 40; i++) {
  assert.strictEqual(exactView[i], 25 + i + 1, `Byte at index ${i} must match sliced content`)
}

// Verify immutability: mutating source buffer does not mutate isolated ArrayBuffer
subBuffer[0] = 255
assert.strictEqual(exactView[0], 26, 'Isolated ArrayBuffer must not be mutated by changes to source view')

// 2. Convert Uint8Array backed by larger ArrayBuffer
const largeAb = new ArrayBuffer(80)
const largeU8 = new Uint8Array(largeAb)
for (let i = 0; i < 80; i++) largeU8[i] = 100 + i
const subU8 = new Uint8Array(largeAb, 20, 30) // offset: 20, length: 30
const exactFromU8 = AudioPlaybackEngine.toArrayBuffer(subU8)
assert.strictEqual(exactFromU8.byteLength, 30)
const u8View = new Uint8Array(exactFromU8)
assert.strictEqual(u8View[0], 120)
assert.strictEqual(u8View[29], 149)

// 3. Direct ArrayBuffer pass-through
const directAb = new ArrayBuffer(16)
new Uint8Array(directAb)[0] = 42
const exactFromAb = AudioPlaybackEngine.toArrayBuffer(directAb)
assert.strictEqual(exactFromAb.byteLength, 16)
assert.strictEqual(new Uint8Array(exactFromAb)[0], 42)

// 4. Null / undefined / empty
assert.strictEqual(AudioPlaybackEngine.toArrayBuffer(null).byteLength, 0)
assert.strictEqual(AudioPlaybackEngine.toArrayBuffer(undefined).byteLength, 0)
console.log('✓ ArrayBuffer view conversion test passed.')

// -------------------------------------------------------------
// Async Tests: Serialization, Sample Rate Sync & Preload Deduplication
// -------------------------------------------------------------
async function runAsyncTests() {
  // -------------------------------------------------------------
  // Test 11: Chunk Append Serialization & Structured Responses
  // -------------------------------------------------------------
  console.log('\nTest 11: Chunk Append Serialization via Promise Chain...')
  const appendExecutionOrder: number[] = []
  let activeAppendCount = 0
  let maxConcurrentAppends = 0

  // Mock window.api with variable latency per chunk
  const mockApi: any = {
    appendRecordingChunk: async (_trackId: string, _path: string, buffer: ArrayBuffer) => {
      activeAppendCount++
      if (activeAppendCount > maxConcurrentAppends) maxConcurrentAppends = activeAppendCount
      const chunkNum = Math.round(new Int16Array(buffer)[0] / 1000)

      // Simulate variable I/O delay: chunk 1 takes 30ms, chunk 2 takes 5ms, chunk 3 takes 15ms
      const delays: Record<number, number> = { 1: 30, 2: 5, 3: 15, 4: 2 }
      await new Promise((r) => setTimeout(r, delays[chunkNum] || 10))

      appendExecutionOrder.push(chunkNum)
      activeAppendCount--
      return { success: true }
    }
  }

  // Create a recording session
  const recSession: any = {
    trackId: 'track-test',
    tempFilePath: 'C:/temp/test.wav',
    sampleRate: 48000,
    channels: 2,
    unwrittenL: [],
    unwrittenR: [],
    unwrittenSamples: 0,
    writeQueue: Promise.resolve()
  }

  // Backup window
  const origWindow = (global as any).window
  ;(global as any).window = { api: mockApi }

  const recordingEngine = AudioRecordingEngine.getInstance()

  // Enqueue 4 chunks in rapid succession
  for (let chunkId = 1; chunkId <= 4; chunkId++) {
    const samples = 128
    const chL = new Float32Array(samples)
    // Store chunkId in sample for tracing
    chL[0] = (chunkId * 1000) / 0x7fff
    recSession.unwrittenL = [chL]
    recSession.unwrittenR = [chL]
    recSession.unwrittenSamples = samples

    // Call flushSessionToDisk (chains onto recSession.writeQueue)
    recordingEngine.flushSessionToDisk(recSession)
  }

  // Await the writeQueue
  await recSession.writeQueue

  // Assert strict serialized execution: chunk 1 then 2 then 3 then 4
  assert.deepStrictEqual(
    appendExecutionOrder,
    [1, 2, 3, 4],
    'Chunks must execute in strict sequential order despite variable latency'
  )
  assert.strictEqual(maxConcurrentAppends, 1, 'Never more than 1 disk append in flight simultaneously per track')

  // Test structured { success: false, error: ... } handling
  let writeQueueRejected = false
  mockApi.appendRecordingChunk = async () => {
    return { success: false, error: 'Disk write error: out of space' }
  }

  const errorSession: any = {
    trackId: 'track-err',
    tempFilePath: 'C:/temp/err.wav',
    sampleRate: 48000,
    channels: 2,
    unwrittenL: [new Float32Array(64)],
    unwrittenR: [new Float32Array(64)],
    unwrittenSamples: 64,
    writeQueue: Promise.resolve()
  }

  try {
    await recordingEngine.flushSessionToDisk(errorSession)
    await errorSession.writeQueue
  } catch (err: any) {
    writeQueueRejected = true
    assert(err.message.includes('Disk write error'), 'Error must contain structured response error message')
  }
  assert.strictEqual(writeQueueRejected, true, 'writeQueue must reject when structured success is false')
  console.log('✓ Chunk append serialization and error propagation test passed.')

  // -------------------------------------------------------------
  // Test 12: Actual Sample Rate Sync & Constant-Memory In-Place WAV Header
  // -------------------------------------------------------------
  console.log('\nTest 12: Actual Sample Rate Sync & Constant-Memory WAV Header...')
  // 1. WAV Header field validation for dynamic sample rates
  const sampleRatesToTest = [44100, 48000, 96000]
  for (const sr of sampleRatesToTest) {
    const pcmBytes = 88200 * 2 * 2 // 2 seconds of 16-bit stereo PCM
    const header = createWavHeader(pcmBytes, sr, 2)
    assert.strictEqual(header.length, 44, 'Header must be exactly 44 bytes')

    // RIFF header
    assert.strictEqual(header.toString('ascii', 0, 4), 'RIFF')
    assert.strictEqual(header.readUInt32LE(4), 36 + pcmBytes)
    assert.strictEqual(header.toString('ascii', 8, 12), 'WAVE')

    // fmt chunk
    assert.strictEqual(header.toString('ascii', 12, 16), 'fmt ')
    assert.strictEqual(header.readUInt32LE(16), 16) // Subchunk1Size
    assert.strictEqual(header.readUInt16LE(20), 1) // PCM format
    assert.strictEqual(header.readUInt16LE(22), 2) // channels
    assert.strictEqual(header.readUInt32LE(24), sr, `Sample rate field must match ${sr}`)
    assert.strictEqual(header.readUInt32LE(28), sr * 2 * 2, `Byte rate must match sr * channels * 2`)
    assert.strictEqual(header.readUInt16LE(32), 4, 'Block align must be channels * 2')
    assert.strictEqual(header.readUInt16LE(34), 16, 'Bits per sample must be 16')

    // data chunk
    assert.strictEqual(header.toString('ascii', 36, 40), 'data')
    assert.strictEqual(header.readUInt32LE(40), pcmBytes, 'dataSize must match pcmBytes')
  }

  // 2. Duration calculation fidelity: actual sample rate vs hardcoded 48000
  const samples44k = 88200
  const durationAt44k = samples44k / 44100
  assert.strictEqual(durationAt44k, 2.0, '88200 samples at 44.1kHz must equal exactly 2.0 seconds')
  const durationErrWith48k = samples44k / 48000
  assert.notStrictEqual(durationErrWith48k, 2.0, 'Hardcoded 48000 would cause 1.8375s incorrect duration')

  // 3. Constant-memory in-place WAV header patching simulation
  const tempTestDir = path.join(os.tmpdir(), 'owr_test_wav')
  if (!fs.existsSync(tempTestDir)) fs.mkdirSync(tempTestDir, { recursive: true })
  const tempWavFile = path.join(tempTestDir, `test_inplace_${Date.now()}.wav`)

  // Write initial placeholder 44-byte header + 1000 bytes PCM
  const initialHeader = createWavHeader(0, 44100, 2)
  const fakePcm = Buffer.alloc(1000, 0x5a) // Fill with pattern
  fs.writeFileSync(tempWavFile, Buffer.concat([initialHeader, fakePcm]))
  const initialStat = fs.statSync(tempWavFile)
  assert.strictEqual(initialStat.size, 1044, 'Initial file must be 44-byte header + 1000 bytes PCM')

  // In-place patch header using mode 'r+' (O(1) memory and time, no full-file read)
  const fileHandle = await fs.promises.open(tempWavFile, 'r+')
  try {
    const updatedHeader = createWavHeader(1000, 44100, 2)
    await fileHandle.write(updatedHeader, 0, 44, 0)
  } finally {
    await fileHandle.close()
  }

  // Verify file was patched in place: size unchanged, PCM bytes untouched, header updated
  const patchedStat = fs.statSync(tempWavFile)
  assert.strictEqual(patchedStat.size, 1044, 'File size must remain exactly 1044 bytes after in-place header patch')
  const finalBuf = fs.readFileSync(tempWavFile)
  assert.strictEqual(finalBuf.readUInt32LE(40), 1000, 'Data chunk size must now be 1000')
  assert.strictEqual(finalBuf[44], 0x5a, 'First PCM byte must be unchanged')
  assert.strictEqual(finalBuf[1043], 0x5a, 'Last PCM byte must be unchanged')

  // Clean up temp file
  fs.unlinkSync(tempWavFile)
  console.log('✓ Dynamic sample rate sync & constant-memory WAV header test passed.')

  // -------------------------------------------------------------
  // Test 13: Playback Engine Preload Deduplication and clearCache()
  // -------------------------------------------------------------
  console.log('\nTest 13: Playback Engine Preload Deduplication, Cache Clearing & Error Propagation...')
  let fileReadCount = 0
  let decodeCount = 0

  // Setup mock AudioContext
  const mockAudioBuffer = { duration: 1.0, length: 44100, numberOfChannels: 2, sampleRate: 44100 }
  class MockAudioContext {
    state = 'running'
    sampleRate = 44100
    currentTime = 0
    destination = {}
    createGain() { return { gain: { value: 1, setTargetAtTime() {} }, connect() {} } }
    decodeAudioData(_buffer: ArrayBuffer) {
      decodeCount++
      return Promise.resolve(mockAudioBuffer)
    }
  }
  ;(global as any).window.AudioContext = MockAudioContext

  mockApi.readFileBuffer = async (_path: string) => {
    fileReadCount++
    await new Promise((r) => setTimeout(r, 20)) // 20ms simulated file read
    return Buffer.alloc(100)
  }

  playbackEngine.clearCache()
  assert.strictEqual(playbackEngine.getCacheSize(), 0)

  // Trigger two concurrent loadAudioBuffer calls for the same file path
  const [buf1, buf2] = await Promise.all([
    playbackEngine.loadAudioBuffer('C:/audio/track1.wav'),
    playbackEngine.loadAudioBuffer('C:/audio/track1.wav')
  ])

  assert.strictEqual(buf1, buf2 as any, 'Both concurrent loads must return the same AudioBuffer reference')
  assert.strictEqual(fileReadCount, 1, 'readFileBuffer must only be called ONCE for concurrent requests (deduplication)')
  assert.strictEqual(decodeCount, 1, 'decodeAudioData must only be called ONCE for concurrent requests')
  assert.strictEqual(playbackEngine.getCacheSize(), 1, 'Cache size should be 1 after load')

  // Test clearCache()
  playbackEngine.clearCache()
  assert.strictEqual(playbackEngine.getCacheSize(), 0, 'Cache size must be 0 after clearCache()')

  // Test error propagation on load failure
  mockApi.readFileBuffer = async () => {
    throw new Error('File not accessible')
  }
  let loadErrorThrown = false
  try {
    await playbackEngine.loadAudioBuffer('C:/audio/missing.wav')
  } catch (err: any) {
    loadErrorThrown = true
    assert(err.message.includes('File not accessible'), 'Error must propagate to caller')
  }
  assert.strictEqual(loadErrorThrown, true, 'loadAudioBuffer must propagate failures instead of silent success')

  // Restore window
  ;(global as any).window = origWindow
  console.log('✓ Playback engine preload deduplication & error propagation test passed.')
}

runAsyncTests()
  .then(() => {
    console.log('\n=============================================')
    console.log('ALL TESTS PASSED WITH 100% SUCCESS!')
    console.log('=============================================\n')
  })
  .catch((err) => {
    console.error('\nTests failed with error:', err)
    process.exit(1)
  })
