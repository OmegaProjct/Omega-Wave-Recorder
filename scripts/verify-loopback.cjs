/**
 * Comprehensive regression test suite for src/main/ipc/processLoopback.ts.
 * Tests real service exports and stream framing using mocked Electron and child_process boundaries.
 * Executes via: node scripts/verify-loopback.cjs
 */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const EventEmitter = require('node:events')
const { Readable, Writable } = require('node:stream')
const ts = require('typescript')

// Transpile the real TypeScript service module
const tsPath = path.resolve(__dirname, '../src/main/ipc/processLoopback.ts')
const tsSource = fs.readFileSync(tsPath, 'utf8')
const transpiledCode = ts.transpileModule(tsSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true
  }
}).outputText

// Mock WebContents implementation
class MockWebContents extends EventEmitter {
  constructor(id = 1) {
    super()
    this.id = id
    this._isDestroyed = false
    this.messages = [] // array of { channel, data }
  }

  isDestroyed() {
    return this._isDestroyed
  }

  send(channel, data) {
    if (this._isDestroyed) {
      throw new Error('Cannot send to destroyed WebContents')
    }
    this.messages.push({ channel, data })
    this.emit('message', channel, data)
  }

  destroy() {
    if (!this._isDestroyed) {
      this._isDestroyed = true
      this.emit('destroyed')
    }
  }
}

// Mock ChildProcess implementation
class MockChildProcess extends EventEmitter {
  constructor(file, args, options) {
    super()
    this.file = file
    this.args = args
    this.options = options
    this.killed = false
    this.exitCode = null
    this.signalCode = null

    this.stdinData = ''
    this.stdin = new Writable({
      write: (chunk, enc, cb) => {
        this.stdinData += chunk.toString('utf8')
        cb()
      }
    })

    this.stdout = new Readable({ read() {} })
    this.stderr = new Readable({ read() {} })

    this.stdin.on('finish', () => {
      this.emit('stdin-end')
    })
  }

  kill(signal = 'SIGTERM') {
    this.killed = true
    this.signalCode = signal
    this.emit('killed', signal)
    process.nextTick(() => {
      if (this.exitCode === null) {
        this.exitCode = null
        this.emit('exit', null, signal)
        this.emit('close', null, signal)
      }
    })
    return true
  }

  simulateExit(code, signal = null) {
    this.exitCode = code
    this.signalCode = signal
    process.nextTick(() => {
      this.emit('exit', code, signal)
      this.emit('close', code, signal)
    })
  }

  pushStdout(chunk) {
    this.stdout.push(chunk)
  }

  pushStderr(text) {
    this.stderr.push(Buffer.from(text, 'utf8'))
  }
}

// Module loader creating an isolated instance of the transpiled service with injected mocks
function createServiceInstance(customElectron, customChildProcess) {
  const Module = module.constructor
  const m = new Module(tsPath, module)
  m.filename = tsPath
  m.paths = Module._nodeModulePaths(path.dirname(tsPath))

  const defaultElectron = {
    app: {
      isPackaged: false,
      getAppPath: () => path.resolve(__dirname, '..'),
      on: () => {}
    }
  }

  const defaultChildProcess = {
    spawn: () => new MockChildProcess('test', [], {}),
    execFile: (file, args, opts, cb) => cb(null, '1234\n', '')
  }

  const electronMock = customElectron || defaultElectron
  const childProcessMock = customChildProcess || defaultChildProcess

  const origRequire = m.require.bind(m)
  m.require = (id) => {
    if (id === 'electron') return electronMock
    if (id === 'child_process') return childProcessMock
    if (id === '../logger') {
      return {
        logger: {
          info: () => {},
          debug: () => {},
          warn: () => {},
          error: () => {}
        }
      }
    }
    return origRequire(id)
  }

  m._compile(transpiledCode, tsPath)
  return m.exports
}

// Helper to construct binary stereo packet: LE uint32 frameCount followed by interleaved Float32 LE
function createStereoPacket(leftFloats, rightFloats) {
  assert.equal(leftFloats.length, rightFloats.length, 'Channel lengths must match')
  const frameCount = leftFloats.length
  const buffer = Buffer.alloc(4 + frameCount * 8)
  buffer.writeUInt32LE(frameCount, 0)

  let offset = 4
  for (let i = 0; i < frameCount; i++) {
    buffer.writeFloatLE(leftFloats[i], offset)
    buffer.writeFloatLE(rightFloats[i], offset + 4)
    offset += 8
  }
  return buffer
}

async function runTests() {
  console.log('--- Starting WASAPI processLoopback Service Verification Suite ---')

  // =========================================================================
  // TEST GROUP 1: Parameter Validation & getHelperPath
  // =========================================================================
  console.log('[Test 1] Parameter validation & helper binary location...')
  {
    const service = createServiceInstance()

    // 1.1 resolveWindowProcessId input validation
    await assert.rejects(
      () => service.resolveWindowProcessId(null),
      /Invalid HWND/
    )
    await assert.rejects(
      () => service.resolveWindowProcessId(''),
      /Invalid HWND/
    )
    await assert.rejects(
      () => service.resolveWindowProcessId('0'),
      /Invalid HWND: HWND must be non-zero/
    )
    await assert.rejects(
      () => service.resolveWindowProcessId('-123'),
      /Invalid HWND/
    )
    await assert.rejects(
      () => service.resolveWindowProcessId('abc'),
      /Invalid HWND/
    )
    await assert.rejects(
      () => service.resolveWindowProcessId('12.34'),
      /Invalid HWND/
    )

    // 1.2 resolveWindowProcessId success with mocked execFile
    let execFileCalledWith = null
    const mockChildProcess = {
      execFile: (file, args, opts, cb) => {
        execFileCalledWith = { file, args, opts }
        cb(null, '9876\n', '')
      }
    }
    const serviceWithMockExec = createServiceInstance(null, mockChildProcess)
    const pid = await serviceWithMockExec.resolveWindowProcessId('65536')
    assert.equal(pid, 9876)
    assert.deepEqual(execFileCalledWith.args, ['--resolve-window', '65536'])
    assert.equal(execFileCalledWith.opts.windowsHide, true)
    assert.equal(execFileCalledWith.opts.shell, false)

    // 1.3 resolveWindowProcessId error handling
    const mockChildProcessFail = {
      execFile: (file, args, opts, cb) => {
        cb(new Error('Process exited with code 1'), '', 'Error: HWND 9999 is not an existing window.\n')
      }
    }
    const serviceFail = createServiceInstance(null, mockChildProcessFail)
    await assert.rejects(
      () => serviceFail.resolveWindowProcessId('9999'),
      /Error: HWND 9999 is not an existing window/
    )

    // 1.4 getHelperPath packaged vs unpackaged
    const unpackagedService = createServiceInstance({
      app: { isPackaged: false, getAppPath: () => path.resolve(__dirname, '..'), on: () => {} }
    })
    const unpackagedPath = unpackagedService.getHelperPath()
    assert.ok(unpackagedPath.endsWith(path.join('out', 'native', 'process-loopback.exe')))

    // Packaged path lookup
    const fakeResources = path.join(path.resolve(__dirname, '..'), 'out')
    const originalResources = process.resourcesPath
    process.resourcesPath = fakeResources
    const packagedService = createServiceInstance({
      app: { isPackaged: true, getAppPath: () => 'C:\\App', on: () => {} }
    })
    const packagedPath = packagedService.getHelperPath()
    assert.ok(packagedPath.endsWith(path.join('native', 'process-loopback.exe')))
    process.resourcesPath = originalResources

    // 1.5 startProcessLoopback parameter validation
    const validSender = new MockWebContents(1)
    await assert.rejects(
      () => service.startProcessLoopback(0, 't1', validSender),
      /Invalid PID/
    )
    await assert.rejects(
      () => service.startProcessLoopback(-1, 't1', validSender),
      /Invalid PID/
    )
    await assert.rejects(
      () => service.startProcessLoopback(4294967296, 't1', validSender),
      /Invalid PID/
    )
    await assert.rejects(
      () => service.startProcessLoopback(1234, '', validSender),
      /Invalid trackId/
    )
    await assert.rejects(
      () => service.startProcessLoopback(1234, '  ', validSender),
      /Invalid trackId/
    )
    await assert.rejects(
      () => service.startProcessLoopback(1234, 't1', null),
      /Invalid sender/
    )

    const destroyedSender = new MockWebContents(2)
    destroyedSender.destroy()
    await assert.rejects(
      () => service.startProcessLoopback(1234, 't1', destroyedSender),
      /Invalid sender: WebContents is invalid or destroyed/
    )

    console.log('  -> PASS: Parameter validation & helper path resolution verified.')
  }

  // =========================================================================
  // TEST GROUP 2: Startup Handshakes & Failure Diagnostics
  // =========================================================================
  console.log('[Test 2] Startup handshakes & failure diagnostics...')
  {
    // 2.1 Successful READY 48000 2 handshake
    let spawnedProc = null
    const mockCP = {
      spawn: (file, args, opts) => {
        spawnedProc = new MockChildProcess(file, args, opts)
        process.nextTick(() => {
          spawnedProc.pushStderr('Info: Initializing WASAPI...\n')
          spawnedProc.pushStderr('READY 48000 2\n')
        })
        return spawnedProc
      }
    }
    const service = createServiceInstance(null, mockCP)
    const sender = new MockWebContents(10)
    const result = await service.startProcessLoopback(1234, 'track-main', sender)
    assert.equal(result.success, true)
    assert.equal(result.sampleRate, 48000)
    assert.equal(result.channels, 2)
    assert.equal(spawnedProc.args[0], '--pid')
    assert.equal(spawnedProc.args[1], '1234')
    await service.stopProcessLoopback(1234, 'track-main')

    // 2.2 Premature exit with OS version diagnostic (e.g. Windows build < 20348)
    const mockCPOsFail = {
      spawn: () => {
        const proc = new MockChildProcess('test', [], {})
        process.nextTick(() => {
          proc.pushStderr('Error: Windows build 20348 or higher required for WASAPI process loopback (current build is 19045).\n')
          proc.simulateExit(2)
        })
        return proc
      }
    }
    const serviceOSFail = createServiceInstance(null, mockCPOsFail)
    await assert.rejects(
      () => serviceOSFail.startProcessLoopback(5678, 'track-os', sender),
      /Error: Windows build 20348 or higher required/
    )

    // 2.3 Premature exit: Target process does not exist
    const mockCPMissingProc = {
      spawn: () => {
        const proc = new MockChildProcess('test', [], {})
        process.nextTick(() => {
          proc.pushStderr('Error: Target process PID 9999 does not exist or has terminated.\n')
          proc.simulateExit(1)
        })
        return proc
      }
    }
    const serviceMissingProc = createServiceInstance(null, mockCPMissingProc)
    await assert.rejects(
      () => serviceMissingProc.startProcessLoopback(9999, 'track-missing', sender),
      /Error: Target process PID 9999 does not exist/
    )

    // 2.4 Child spawn error event
    const mockCPSpawnErr = {
      spawn: () => {
        const proc = new MockChildProcess('test', [], {})
        process.nextTick(() => {
          proc.emit('error', new Error('spawn EACCES'))
        })
        return proc
      }
    }
    const serviceSpawnErr = createServiceInstance(null, mockCPSpawnErr)
    await assert.rejects(
      () => serviceSpawnErr.startProcessLoopback(1234, 'track-err', sender),
      /spawn EACCES/
    )

    console.log('  -> PASS: Startup handshakes and stderr diagnostics verified.')
  }

  // =========================================================================
  // TEST GROUP 3: Binary Stream Framing, Split Chunks, Coalescing & Exact Values
  // =========================================================================
  console.log('[Test 3] Stream framing: arbitrary splits, coalesced packets & exact float values...')
  {
    let child = null
    const mockCP = {
      spawn: () => {
        child = new MockChildProcess('test', [], {})
        process.nextTick(() => {
          child.pushStderr('READY 48000 2\n')
        })
        return child
      }
    }
    const service = createServiceInstance(null, mockCP)
    const sender = new MockWebContents(20)

    await service.startProcessLoopback(3000, 'track-audio', sender)

    // 3.1 Intact single packet with deterministic float values
    const left1 = [0.125, -0.5, 0.875, -1.0]
    const right1 = [0.25, -0.75, 0.5, 0.0]
    const packet1 = createStereoPacket(left1, right1) // 4 frames -> 36 bytes

    child.pushStdout(packet1)

    // Yield microtasks
    await new Promise((resolve) => setTimeout(resolve, 20))

    assert.equal(sender.messages.length, 1)
    const msg1 = sender.messages[0]
    assert.equal(msg1.channel, 'loopback-chunk')
    assert.equal(msg1.data.trackId, 'track-audio')
    assert.equal(msg1.data.pid, 3000)
    assert.equal(msg1.data.sampleRate, 48000)
    assert.equal(msg1.data.left.length, 4)
    assert.equal(msg1.data.right.length, 4)

    for (let i = 0; i < 4; i++) {
      assert.ok(Math.abs(msg1.data.left[i] - left1[i]) < 1e-6, `Left float at index ${i} matches`)
      assert.ok(Math.abs(msg1.data.right[i] - right1[i]) < 1e-6, `Right float at index ${i} matches`)
    }

    // 3.2 Arbitrary split chunks (packet fragmented into 4 pieces, including split header)
    const left2 = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6]
    const right2 = [-0.1, -0.2, -0.3, -0.4, -0.5, -0.6]
    const packet2 = createStereoPacket(left2, right2) // 6 frames -> 4 + 48 = 52 bytes

    // Fragment 1: First 2 bytes of the 4-byte header
    child.pushStdout(packet2.subarray(0, 2))
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(sender.messages.length, 1, 'Incomplete header must not trigger chunk event')

    // Fragment 2: Next 2 bytes of header + 10 bytes of payload
    child.pushStdout(packet2.subarray(2, 14))
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(sender.messages.length, 1, 'Incomplete payload must not trigger chunk event')

    // Fragment 3: 20 more bytes
    child.pushStdout(packet2.subarray(14, 34))
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(sender.messages.length, 1)

    // Fragment 4: Final 18 bytes
    child.pushStdout(packet2.subarray(34, 52))
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(sender.messages.length, 2, 'Completed packet must trigger chunk event')

    const msg2 = sender.messages[1]
    assert.equal(msg2.data.left.length, 6)
    assert.equal(msg2.data.right.length, 6)
    for (let i = 0; i < 6; i++) {
      assert.ok(Math.abs(msg2.data.left[i] - left2[i]) < 1e-6)
      assert.ok(Math.abs(msg2.data.right[i] - right2[i]) < 1e-6)
    }

    // 3.3 Coalesced packets: 2 full packets pushed in a single chunk
    const left3 = [0.99]
    const right3 = [-0.99]
    const pkt3 = createStereoPacket(left3, right3) // 1 frame

    const left4 = [0.44, 0.55]
    const right4 = [-0.44, -0.55]
    const pkt4 = createStereoPacket(left4, right4) // 2 frames

    const coalesced = Buffer.concat([pkt3, pkt4])
    child.pushStdout(coalesced)
    await new Promise((resolve) => setTimeout(resolve, 10))

    assert.equal(sender.messages.length, 4, 'Both coalesced packets must be dispatched')
    assert.equal(sender.messages[2].data.left.length, 1)
    assert.equal(sender.messages[3].data.left.length, 2)
    assert.ok(Math.abs(sender.messages[2].data.left[0] - 0.99) < 1e-6)
    assert.ok(Math.abs(sender.messages[3].data.left[0] - 0.44) < 1e-6)
    assert.ok(Math.abs(sender.messages[3].data.left[1] - 0.55) < 1e-6)

    // 3.4 Split across packet boundary: packet 5 + prefix of packet 6 in chunk 1, rest in chunk 2
    const pkt5 = createStereoPacket([1.0], [2.0])
    const pkt6 = createStereoPacket([3.0, 4.0], [5.0, 6.0])
    const combined = Buffer.concat([pkt5, pkt6])

    const splitPoint = pkt5.length + 3 // packet 5 plus 3 bytes of packet 6 header
    child.pushStdout(combined.subarray(0, splitPoint))
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(sender.messages.length, 5, 'Packet 5 dispatched, Packet 6 waiting')

    child.pushStdout(combined.subarray(splitPoint))
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(sender.messages.length, 6, 'Packet 6 dispatched after remaining bytes arrive')

    await service.stopProcessLoopback(3000, 'track-audio')
    console.log('  -> PASS: Stereo packet framing, arbitrary splits and coalescing verified.')
  }

  // =========================================================================
  // TEST GROUP 4: Stream Framing Bounds & Malformed Packet Rejection
  // =========================================================================
  console.log('[Test 4] Packet bounding & malformed framing rejection...')
  {
    // 4.1 Zero frame count packet
    let child1 = null
    const mockCP1 = {
      spawn: () => {
        child1 = new MockChildProcess('test', [], {})
        process.nextTick(() => child1.pushStderr('READY 48000 2\n'))
        return child1
      }
    }
    const service1 = createServiceInstance(null, mockCP1)
    const sender1 = new MockWebContents(31)
    await service1.startProcessLoopback(4001, 'track-zero', sender1)

    // Push 4 zero bytes (frameCount = 0)
    child1.pushStdout(Buffer.from([0, 0, 0, 0]))
    await new Promise((resolve) => setTimeout(resolve, 20))

    const errorMsg1 = sender1.messages.find((m) => m.channel === 'loopback-error')
    assert.ok(errorMsg1, 'Zero frameCount must emit loopback-error')
    assert.match(errorMsg1.data.error, /Invalid packet frameCount: 0/)

    // 4.2 Oversized packet (frameCount > 48000)
    let child2 = null
    const mockCP2 = {
      spawn: () => {
        child2 = new MockChildProcess('test', [], {})
        process.nextTick(() => child2.pushStderr('READY 48000 2\n'))
        return child2
      }
    }
    const service2 = createServiceInstance(null, mockCP2)
    const sender2 = new MockWebContents(32)
    await service2.startProcessLoopback(4002, 'track-oversized', sender2)

    // Push header with frameCount = 48001
    const oversizedHeader = Buffer.alloc(4)
    oversizedHeader.writeUInt32LE(48001, 0)
    child2.pushStdout(oversizedHeader)
    await new Promise((resolve) => setTimeout(resolve, 20))

    const errorMsg2 = sender2.messages.find((m) => m.channel === 'loopback-error')
    assert.ok(errorMsg2, 'Oversized frameCount must emit loopback-error')
    assert.match(errorMsg2.data.error, /Invalid packet frameCount: 48001/)

    console.log('  -> PASS: Malformed and bounded packet rejection verified.')
  }

  // =========================================================================
  // TEST GROUP 5: Runtime Child Exits & Error Notifications
  // =========================================================================
  console.log('[Test 5] Runtime child exit & error notification...')
  {
    let child = null
    const mockCP = {
      spawn: () => {
        child = new MockChildProcess('test', [], {})
        process.nextTick(() => child.pushStderr('READY 48000 2\n'))
        return child
      }
    }
    const service = createServiceInstance(null, mockCP)
    const sender = new MockWebContents(40)
    await service.startProcessLoopback(5000, 'track-runtime-exit', sender)

    // Simulate unexpected crash after startup
    child.pushStderr('Error: Audio device disconnected.\n')
    child.simulateExit(1)
    await new Promise((resolve) => setTimeout(resolve, 30))

    const err = sender.messages.find((m) => m.channel === 'loopback-error')
    assert.ok(err, 'Unexpected exit must notify renderer via loopback-error')
    assert.equal(err.data.trackId, 'track-runtime-exit')
    assert.equal(err.data.pid, 5000)
    assert.match(err.data.error, /Audio device disconnected/)

    // Idempotent stop after exit
    const stopResult = await service.stopProcessLoopback(5000, 'track-runtime-exit')
    assert.equal(stopResult.success, true)

    console.log('  -> PASS: Runtime exits emit loopback-error and stop idempotently.')
  }

  // =========================================================================
  // TEST GROUP 6: Graceful Stop, Timeouts & Error Propagation on Stop
  // =========================================================================
  console.log('[Test 6] Graceful stop, kill fallback on timeout & error propagation...')
  {
    // 6.1 Graceful stop sends stop\n and closes stdin
    let child1 = null
    const mockCP1 = {
      spawn: () => {
        child1 = new MockChildProcess('test', [], {})
        process.nextTick(() => child1.pushStderr('READY 48000 2\n'))
        child1.on('stdin-end', () => {
          child1.simulateExit(0)
        })
        return child1
      }
    }
    const service1 = createServiceInstance(null, mockCP1)
    const sender1 = new MockWebContents(51)
    await service1.startProcessLoopback(6001, 'track-graceful', sender1)

    const stopRes1 = await service1.stopProcessLoopback(6001, 'track-graceful')
    assert.equal(stopRes1.success, true)
    assert.ok(child1.stdinData.includes('stop\n'), 'Graceful stop sends stop\\n to stdin')
    const hasError1 = sender1.messages.some((m) => m.channel === 'loopback-error')
    assert.equal(hasError1, false, 'Intentional stop must NOT emit loopback-error')

    // 6.2 Stop timeout falls back to kill
    let child2 = null
    let killCalledWith = null
    const mockCP2 = {
      spawn: () => {
        child2 = new MockChildProcess('test', [], {})
        process.nextTick(() => child2.pushStderr('READY 48000 2\n'))
        // Do NOT exit on stdin end; simulate hang
        child2.on('killed', (sig) => {
          killCalledWith = sig
        })
        return child2
      }
    }
    const service2 = createServiceInstance(null, mockCP2)
    const sender2 = new MockWebContents(52)
    await service2.startProcessLoopback(6002, 'track-timeout', sender2)

    const stopRes2 = await service2.stopProcessLoopback(6002, 'track-timeout')
    assert.equal(stopRes2.success, true)
    assert.equal(killCalledWith, 'SIGTERM', 'Killed with SIGTERM on graceful stop timeout')

    // 6.3 Failed helper exit is surfaced on stop
    let child3 = null
    const mockCP3 = {
      spawn: () => {
        child3 = new MockChildProcess('test', [], {})
        process.nextTick(() => child3.pushStderr('READY 48000 2\n'))
        child3.on('stdin-end', () => {
          child3.pushStderr('Error: IAudioClient::Stop failed with 0x88890001\n')
          child3.simulateExit(1)
        })
        return child3
      }
    }
    const service3 = createServiceInstance(null, mockCP3)
    const sender3 = new MockWebContents(53)
    await service3.startProcessLoopback(6003, 'track-fail-stop', sender3)

    await assert.rejects(
      () => service3.stopProcessLoopback(6003, 'track-fail-stop'),
      /IAudioClient::Stop failed/
    )

    console.log('  -> PASS: Graceful shutdown, kill fallback and stop error propagation verified.')
  }

  // =========================================================================
  // TEST GROUP 7: Multiple Independent Tracks on Same PID & Duplicate Prevention
  // =========================================================================
  console.log('[Test 7] Two independent tracks on same PID & duplicate start prevention...')
  {
    const spawnedProcs = []
    const mockCP = {
      spawn: (file, args, opts) => {
        const proc = new MockChildProcess(file, args, opts)
        spawnedProcs.push(proc)
        process.nextTick(() => proc.pushStderr('READY 48000 2\n'))
        proc.on('stdin-end', () => proc.simulateExit(0))
        return proc
      }
    }
    const service = createServiceInstance(null, mockCP)
    const sender = new MockWebContents(60)

    // Start track-A on PID 7777
    const resA = await service.startProcessLoopback(7777, 'track-A', sender)
    assert.equal(resA.success, true)
    assert.equal(spawnedProcs.length, 1)

    // Start track-B on PID 7777
    const resB = await service.startProcessLoopback(7777, 'track-B', sender)
    assert.equal(resB.success, true)
    assert.equal(spawnedProcs.length, 2)

    // Duplicate start on track-A must reject
    await assert.rejects(
      () => service.startProcessLoopback(7777, 'track-A', sender),
      /capture already active for track "track-A"/
    )

    // Dispatch chunk to track-A process only
    const pktA = createStereoPacket([0.11], [0.22])
    spawnedProcs[0].pushStdout(pktA)
    await new Promise((resolve) => setTimeout(resolve, 15))

    // Dispatch chunk to track-B process only
    const pktB = createStereoPacket([0.33], [0.44])
    spawnedProcs[1].pushStdout(pktB)
    await new Promise((resolve) => setTimeout(resolve, 15))

    const chunkA = sender.messages.find((m) => m.data?.trackId === 'track-A')
    const chunkB = sender.messages.find((m) => m.data?.trackId === 'track-B')
    assert.ok(chunkA)
    assert.ok(chunkB)
    assert.ok(Math.abs(chunkA.data.left[0] - 0.11) < 1e-6)
    assert.ok(Math.abs(chunkB.data.left[0] - 0.33) < 1e-6)

    // Stop track-A only -> track-B remains active
    await service.stopProcessLoopback(7777, 'track-A')
    assert.equal(spawnedProcs[0].stdinData.includes('stop\n'), true)
    assert.equal(spawnedProcs[1].stdinData.includes('stop\n'), false)

    // Stop track-B
    await service.stopProcessLoopback(7777, 'track-B')
    assert.equal(spawnedProcs[1].stdinData.includes('stop\n'), true)

    console.log('  -> PASS: Multiple independent tracks on same PID verified.')
  }

  // =========================================================================
  // TEST GROUP 8: Sender Destroyed & App Before-Quit Cleanup
  // =========================================================================
  console.log('[Test 8] Sender destroyed and app before-quit resource cleanup...')
  {
    // 8.1 Sender destroyed during capture cleans up session and child
    let child1 = null
    const mockCP1 = {
      spawn: () => {
        child1 = new MockChildProcess('test', [], {})
        process.nextTick(() => child1.pushStderr('READY 48000 2\n'))
        return child1
      }
    }
    const service1 = createServiceInstance(null, mockCP1)
    const sender1 = new MockWebContents(71)
    await service1.startProcessLoopback(8001, 'track-dest-sender', sender1)

    // Destroy sender
    sender1.destroy()
    await new Promise((resolve) => setTimeout(resolve, 30))

    assert.equal(child1.killed, true, 'Child process must be killed when sender is destroyed')

    // 8.2 App before-quit terminates all active sessions
    let beforeQuitHandler = null
    const mockElectron = {
      app: {
        isPackaged: false,
        getAppPath: () => path.resolve(__dirname, '..'),
        on: (ev, handler) => {
          if (ev === 'before-quit') beforeQuitHandler = handler
        }
      }
    }
    let child2 = null
    const mockCP2 = {
      spawn: () => {
        child2 = new MockChildProcess('test', [], {})
        process.nextTick(() => child2.pushStderr('READY 48000 2\n'))
        return child2
      }
    }
    const service2 = createServiceInstance(mockElectron, mockCP2)
    const sender2 = new MockWebContents(72)
    await service2.startProcessLoopback(8002, 'track-app-quit', sender2)

    assert.ok(typeof beforeQuitHandler === 'function', 'before-quit hook must be registered')
    beforeQuitHandler()
    assert.equal(child2.killed, true, 'Active sessions killed on before-quit')

    console.log('  -> PASS: Sender destroyed and before-quit hooks clean resources without leaks.')
  }

  // =========================================================================
  // TEST GROUP 9: Windows Playback & Endpoint Loopback (Render Endpoints)
  // =========================================================================
  console.log('[Test 9] Windows Playback endpoints enumeration & device loopback...')
  {
    // 9.1 getRenderEndpoints mock verification
    const mockCP_Render = {
      execFile: (file, args, opts, cb) => {
        assert.ok(args.includes('--list-render-devices'))
        process.nextTick(() => {
          cb(null, JSON.stringify([
            { id: '{endpoint-chat}', name: 'Chat (Audio-Kanal)' },
            { id: '{endpoint-music}', name: 'Music (Audio-Kanal)' }
          ]), '')
        })
      }
    }
    const serviceRender = createServiceInstance(null, mockCP_Render)
    const endpoints = await serviceRender.getRenderEndpoints()
    assert.equal(endpoints.length, 2)
    assert.equal(endpoints[0].id, '{endpoint-chat}')
    assert.equal(endpoints[0].name, 'Chat (Audio-Kanal)')

    // 9.2 startDeviceLoopback & streaming chunks with deviceId
    let deviceChild = null
    const mockCP_Dev = {
      spawn: (file, args, opts) => {
        assert.equal(args[0], '--device')
        assert.equal(args[1], '{endpoint-chat}')
        deviceChild = new MockChildProcess(file, args, opts)
        process.nextTick(() => deviceChild.pushStderr('READY 48000 2\n'))
        deviceChild.on('stdin-end', () => deviceChild.simulateExit(0))
        return deviceChild
      }
    }
    const serviceDev = createServiceInstance(null, mockCP_Dev)
    const senderDev = new MockWebContents(90)
    const startRes = await serviceDev.startDeviceLoopback('{endpoint-chat}', 'track-chat', senderDev)
    assert.equal(startRes.success, true)
    assert.equal(startRes.sampleRate, 48000)

    // Push audio packet and verify deviceId attached in chunk event
    const pkt = createStereoPacket([0.5, 0.6], [0.7, 0.8])
    deviceChild.pushStdout(pkt)
    await new Promise((resolve) => setTimeout(resolve, 20))

    const chunkMsg = senderDev.messages.find((m) => m.channel === 'loopback-chunk' && m.data?.trackId === 'track-chat')
    assert.ok(chunkMsg, 'Should dispatch loopback-chunk for device loopback')
    assert.equal(chunkMsg.data.deviceId, '{endpoint-chat}')
    assert.equal(chunkMsg.data.left.length, 2)

    // Stop device loopback
    await serviceDev.stopProcessLoopback('{endpoint-chat}', 'track-chat')
    assert.equal(deviceChild.stdinData.includes('stop\n'), true)

    console.log('  -> PASS: Windows Playback endpoints enumeration and device loopback verified.')
  }

  console.log('\n>>> ALL PROCESS-LOOPBACK REGRESSION TESTS PASSED DETERMINISTICALLY! <<<')
}

runTests().catch((err) => {
  console.error('\nFAIL: Verification suite encountered error:', err)
  process.exit(1)
})
