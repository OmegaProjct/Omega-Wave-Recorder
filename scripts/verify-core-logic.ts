/**
 * verify-core-logic.ts
 * Rigorous self-testing verification script for Omega Wave Recorder core logic.
 */

import assert from 'node:assert'
import { ProjectManager, MICRO_FADE_SECONDS } from '../src/renderer/src/lib/ProjectManager'
import { HistoryStack, MAX_HISTORY_STEPS } from '../src/renderer/src/lib/useHistory'
import { AudioRecordingEngine } from '../src/renderer/src/lib/AudioRecordingEngine'
import { WaveformDrawer } from '../src/renderer/src/lib/WaveformDrawer'
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

console.log('\n=============================================')
console.log('ALL TESTS PASSED WITH 100% SUCCESS!')
console.log('=============================================\n')
