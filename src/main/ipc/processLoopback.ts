import { app, type WebContents } from 'electron'
import { spawn, execFile, type ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { logger } from '../logger'

export interface LoopbackChunkEvent {
  trackId: string
  pid: number
  left: Float32Array
  right: Float32Array
  sampleRate: number
}

export interface LoopbackErrorEvent {
  trackId: string
  pid: number
  error: string
}

export interface LoopbackStartResult {
  success: true
  sampleRate: number
  channels: number
}

export interface LoopbackStopResult {
  success: true
}

interface LoopbackSession {
  key: string
  rendererId: number
  trackId: string
  pid: number
  child: ChildProcess
  sender: WebContents
  stopping: boolean
  exited: boolean
  exitCode: number | null
  exitError: string | null
  cleanupRendererListener?: () => void
  resolveExit?: () => void
  exitPromise?: Promise<void>
}

const activeSessions = new Map<string, LoopbackSession>()

let beforeQuitRegistered = false
function ensureBeforeQuitHook() {
  if (beforeQuitRegistered) return
  if (typeof app !== 'undefined' && typeof app.on === 'function') {
    beforeQuitRegistered = true
    app.on('before-quit', () => {
      for (const session of Array.from(activeSessions.values())) {
        try {
          if (session.cleanupRendererListener) {
            session.cleanupRendererListener()
          }
          if (session.child.stdin && !session.child.stdin.destroyed) {
            session.child.stdin.end()
          }
          session.child.kill()
        } catch {}
      }
      activeSessions.clear()
    })
  }
}

/**
 * Locates the compiled process-loopback.exe helper binary.
 * Resolves correctly in both packaged (resources/native) and unpackaged (out/native) environments.
 */
export function getHelperPath(): string {
  if (process.platform !== 'win32') {
    throw new Error('WASAPI process loopback helper is only supported on Windows')
  }

  const isPackaged = typeof app !== 'undefined' && app && app.isPackaged
  const appRoot = (typeof app !== 'undefined' && app && typeof app.getAppPath === 'function')
    ? (isPackaged ? process.resourcesPath : app.getAppPath())
    : path.resolve(__dirname, '../../..')

  const helperPath = isPackaged
    ? path.join(process.resourcesPath, 'native', 'process-loopback.exe')
    : path.join(appRoot, 'out', 'native', 'process-loopback.exe')

  if (!fs.existsSync(helperPath)) {
    throw new Error(`Process loopback helper binary not found at "${helperPath}"`)
  }

  return helperPath
}

/**
 * Resolves the owning Process ID (PID) for a given Windows Window Handle (HWND).
 * Executes native helper: process-loopback.exe --resolve-window <HWND>
 */
export async function resolveWindowProcessId(hwnd: string): Promise<number> {
  if (typeof hwnd !== 'string') {
    throw new Error('Invalid HWND: must be a string')
  }
  const trimmed = hwnd.trim()
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`Invalid HWND "${hwnd}": must be a positive decimal integer string`)
  }
  if (BigInt(trimmed) === 0n) {
    throw new Error('Invalid HWND: HWND must be non-zero')
  }

  const helperPath = getHelperPath()

  return new Promise<number>((resolve, reject) => {
    execFile(
      helperPath,
      ['--resolve-window', trimmed],
      {
        windowsHide: true,
        timeout: 5000,
        maxBuffer: 64 * 1024,
        shell: false
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = (stderr && stderr.trim()) || error.message
          return reject(new Error(`Failed to resolve window process ID: ${detail}`))
        }
        const out = stdout.trim()
        const pid = parseInt(out, 10)
        if (!Number.isInteger(pid) || pid <= 0) {
          const detail = (stderr && stderr.trim()) || `unexpected output "${out}"`
          return reject(new Error(`Failed to resolve window process ID: ${detail}`))
        }
        resolve(pid)
      }
    )
  })
}

/**
 * Starts WASAPI process loopback audio capture for a given target process ID and track.
 */
export async function startProcessLoopback(
  pid: number,
  trackId: string,
  sender: WebContents
): Promise<LoopbackStartResult> {
  // Validate PID
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0 || pid > 0xFFFFFFFF) {
    throw new Error(`Invalid PID: "${pid}". Must be a positive 32-bit unsigned integer.`)
  }

  // Validate trackId
  if (typeof trackId !== 'string' || trackId.trim() === '') {
    throw new Error('Invalid trackId: must be a non-empty string.')
  }

  // Validate sender
  if (!sender || typeof sender.send !== 'function' || (typeof sender.isDestroyed === 'function' && sender.isDestroyed())) {
    throw new Error('Invalid sender: WebContents is invalid or destroyed.')
  }

  const rendererId = typeof sender.id === 'number' ? sender.id : 0
  const sessionKey = `${rendererId}:${trackId}`

  if (activeSessions.has(sessionKey)) {
    throw new Error(`Process loopback capture already active for track "${trackId}" on renderer ${rendererId}.`)
  }

  const helperPath = getHelperPath()
  ensureBeforeQuitHook()

  const child = spawn(helperPath, ['--pid', pid.toString()], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false
  })

  if (!child.stdout || !child.stderr || !child.stdin) {
    try { child.kill() } catch {}
    throw new Error('Failed to spawn process loopback helper with stdio pipes.')
  }

  // Bounded stderr buffer for startup and runtime diagnostics
  let stderrBuffer = ''
  const stderrHistory: string[] = []
  const MAX_STDERR_HISTORY = 50

  function recordStderr(chunk: Buffer | string): string[] {
    stderrBuffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    const lines = stderrBuffer.split(/\r?\n/)
    stderrBuffer = lines.pop() ?? ''
    if (stderrBuffer.length > 4096) {
      stderrBuffer = stderrBuffer.slice(-4096)
    }
    const completedLines: string[] = []
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed) {
        completedLines.push(trimmed)
        stderrHistory.push(trimmed)
        if (stderrHistory.length > MAX_STDERR_HISTORY) {
          stderrHistory.shift()
        }
      }
    }
    return completedLines
  }

  function getStderrDiagnostic(): string {
    const all = [...stderrHistory]
    if (stderrBuffer.trim()) {
      all.push(stderrBuffer.trim())
    }
    const errorLine = all.slice().reverse().find((l) => l.startsWith('Error:') || l.includes('Error'))
    if (errorLine) return errorLine
    return all.slice(-3).join('; ')
  }

  const session: LoopbackSession = {
    key: sessionKey,
    rendererId,
    trackId,
    pid,
    child,
    sender,
    stopping: false,
    exited: false,
    exitCode: null,
    exitError: null
  }

  activeSessions.set(sessionKey, session)

  return new Promise<LoopbackStartResult>((resolve, reject) => {
    let startupTimer: NodeJS.Timeout | null = null

    const cleanupStartup = () => {
      if (startupTimer) {
        clearTimeout(startupTimer)
        startupTimer = null
      }
      child.stderr?.removeListener('data', onStartupStderr)
      child.removeListener('error', onStartupError)
      child.removeListener('exit', onStartupExit)
      try {
        sender.removeListener('destroyed', onStartupSenderDestroyed)
      } catch {}
    }

    const onStartupStderr = (chunk: Buffer) => {
      const lines = recordStderr(chunk)
      for (const line of lines) {
        if (line === 'READY 48000 2') {
          cleanupStartup()
          setupRunningCapture(session, recordStderr, getStderrDiagnostic)
          resolve({ success: true, sampleRate: 48000, channels: 2 })
          return
        }
      }
    }

    const onStartupError = (err: Error) => {
      cleanupStartup()
      activeSessions.delete(sessionKey)
      try { child.kill() } catch {}
      reject(new Error(`Failed to start process loopback helper: ${err.message}`))
    }

    const onStartupExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanupStartup()
      activeSessions.delete(sessionKey)
      const diag = getStderrDiagnostic() || `Helper process exited prematurely (code: ${code}, signal: ${signal})`
      reject(new Error(`Failed to start process loopback: ${diag}`))
    }

    const onStartupSenderDestroyed = () => {
      cleanupStartup()
      activeSessions.delete(sessionKey)
      try { child.kill() } catch {}
      reject(new Error('Sender WebContents was destroyed during process loopback startup'))
    }

    child.stderr.on('data', onStartupStderr)
    child.once('error', onStartupError)
    child.once('exit', onStartupExit)
    if (typeof sender.once === 'function') {
      sender.once('destroyed', onStartupSenderDestroyed)
    }

    startupTimer = setTimeout(() => {
      cleanupStartup()
      activeSessions.delete(sessionKey)
      try { child.kill() } catch {}
      const diag = getStderrDiagnostic() || 'Timeout waiting for READY handshake'
      reject(new Error(`Timeout starting process loopback: ${diag}`))
    }, 5000)
  })
}

function setupRunningCapture(
  session: LoopbackSession,
  recordStderr: (chunk: Buffer | string) => string[],
  getStderrDiagnostic: () => string
): void {
  const { child, sender, trackId, pid } = session

  let pcmBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  const MAX_BUFFERED_BYTES = 2 * 1024 * 1024 // 2MB safety bound

  let runtimeErrorEmitted = false
  function handleRuntimeError(err: Error) {
    if (session.stopping || runtimeErrorEmitted) return
    runtimeErrorEmitted = true

    logger?.error('ProcessLoopback', `Runtime error in capture for PID ${pid} track ${trackId}: ${err.message}`)

    if (!sender.isDestroyed()) {
      try {
        sender.send('loopback-error', {
          trackId,
          pid,
          error: err.message
        })
      } catch {}
    }

    stopSession(session, true).catch(() => {})
  }

  // Handle stdout streaming audio data
  child.stdout?.on('data', (chunk: Buffer) => {
    if (session.stopping || session.exited) return

    pcmBuffer = pcmBuffer.length === 0 ? chunk : Buffer.concat([pcmBuffer, chunk])

    if (pcmBuffer.length > MAX_BUFFERED_BYTES) {
      handleRuntimeError(new Error('Process loopback stream buffer overflow (exceeded 2MB)'))
      return
    }

    while (pcmBuffer.length >= 4) {
      const frameCount = pcmBuffer.readUInt32LE(0)

      if (frameCount === 0 || frameCount > 48000) {
        handleRuntimeError(new Error(`Invalid packet frameCount: ${frameCount} (must be between 1 and 48000)`))
        return
      }

      const payloadBytes = frameCount * 2 * 4 // 2 channels stereo, 4 bytes per float32
      const totalPacketBytes = 4 + payloadBytes

      if (pcmBuffer.length < totalPacketBytes) {
        // Incomplete packet in buffer; wait for more data
        break
      }

      // Deinterleave stereo Float32 LE samples
      const left = new Float32Array(frameCount)
      const right = new Float32Array(frameCount)

      let readOffset = 4
      for (let i = 0; i < frameCount; i++) {
        left[i] = pcmBuffer.readFloatLE(readOffset)
        right[i] = pcmBuffer.readFloatLE(readOffset + 4)
        readOffset += 8
      }

      // Advance buffer
      if (pcmBuffer.length === totalPacketBytes) {
        pcmBuffer = Buffer.alloc(0)
      } else {
        const remaining = pcmBuffer.length - totalPacketBytes
        const nextBuffer = Buffer.allocUnsafe(remaining)
        pcmBuffer.copy(nextBuffer, 0, totalPacketBytes)
        pcmBuffer = nextBuffer
      }

      // Dispatch to renderer if not destroyed
      if (!sender.isDestroyed()) {
        try {
          sender.send('loopback-chunk', {
            trackId,
            pid,
            left,
            right,
            sampleRate: 48000
          })
        } catch (err: any) {
          logger?.warn('ProcessLoopback', `Failed to send loopback-chunk to renderer: ${err.message}`)
        }
      }
    }
  })

  // Continue recording stderr during runtime
  child.stderr?.on('data', (chunk: Buffer) => {
    recordStderr(chunk)
  })

  child.once('error', (err: Error) => {
    if (session.stopping || session.exited) return
    handleRuntimeError(new Error(`Helper process error: ${err.message}`))
  })

  child.once('exit', (code: number | null, signal: NodeJS.Signals | null) => {
    session.exited = true
    session.exitCode = code
    if (code !== 0 && code !== null) {
      session.exitError = getStderrDiagnostic() || `Helper process exited with code ${code}`
    }
    if (session.resolveExit) {
      session.resolveExit()
    }
    if (!session.stopping) {
      // Unexpected runtime termination
      const diag = session.exitError || getStderrDiagnostic() || `Helper process terminated unexpectedly (code: ${code}, signal: ${signal})`
      handleRuntimeError(new Error(diag))
    }
  })

  const onRendererDestroyed = () => {
    logger?.info('ProcessLoopback', `Renderer destroyed for track ${trackId}, stopping session`)
    stopSession(session, true).catch(() => {})
  }

  session.cleanupRendererListener = () => {
    try {
      sender.removeListener('destroyed', onRendererDestroyed)
    } catch {}
  }

  if (typeof sender.once === 'function') {
    sender.once('destroyed', onRendererDestroyed)
  }
}

async function stopSession(session: LoopbackSession, forceKill: boolean = false): Promise<void> {
  if (session.stopping) {
    if (session.exitPromise) {
      await session.exitPromise
    }
    return
  }

  session.stopping = true

  if (session.cleanupRendererListener) {
    session.cleanupRendererListener()
    session.cleanupRendererListener = undefined
  }

  if (session.exited) {
    activeSessions.delete(session.key)
    return
  }

  session.exitPromise = (async () => {
    try {
      if (!forceKill) {
        // Graceful stop: send 'stop\n' and end stdin
        try {
          if (session.child.stdin && !session.child.stdin.destroyed) {
            session.child.stdin.write('stop\n')
            session.child.stdin.end()
          }
        } catch {}

        // Await graceful exit with 1500ms timeout
        const exited = await Promise.race([
          new Promise<boolean>((resolve) => {
            if (session.exited) return resolve(true)
            session.resolveExit = () => resolve(true)
          }),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1500))
        ])

        if (!exited && !session.exited) {
          logger?.warn('ProcessLoopback', `Graceful stop timed out for track ${session.trackId}, killing process`)
          try {
            session.child.kill('SIGTERM')
          } catch {}

          const exitedAfterKill = await Promise.race([
            new Promise<boolean>((resolve) => {
              if (session.exited) return resolve(true)
              session.resolveExit = () => resolve(true)
            }),
            new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 500))
          ])

          if (!exitedAfterKill && !session.exited) {
            try {
              session.child.kill('SIGKILL')
            } catch {}
          }
        }
      } else {
        try {
          session.child.kill('SIGKILL')
        } catch {
          try { session.child.kill() } catch {}
        }
      }
    } finally {
      activeSessions.delete(session.key)
    }
  })()

  await session.exitPromise
}

/**
 * Stops active WASAPI process loopback capture session(s).
 * If trackId is omitted, stops all sessions associated with the given PID.
 */
export async function stopProcessLoopback(
  pid: number,
  trackId?: string
): Promise<LoopbackStopResult> {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0 || pid > 0xFFFFFFFF) {
    throw new Error(`Invalid PID: "${pid}". Must be a positive 32-bit integer.`)
  }

  if (trackId !== undefined && (typeof trackId !== 'string' || trackId.trim() === '')) {
    throw new Error('Invalid trackId: must be a non-empty string when provided.')
  }

  const matchingSessions: LoopbackSession[] = []
  for (const session of activeSessions.values()) {
    if (session.pid === pid) {
      if (trackId === undefined || session.trackId === trackId) {
        matchingSessions.push(session)
      }
    }
  }

  if (matchingSessions.length === 0) {
    // Idempotent stop
    return { success: true }
  }

  let helperError: Error | null = null

  for (const session of matchingSessions) {
    await stopSession(session, false)
    if (session.exitCode !== null && session.exitCode !== 0 && !session.child.killed) {
      helperError = new Error(session.exitError || `Process loopback helper failed with exit code ${session.exitCode}`)
    }
  }

  if (helperError) {
    throw helperError
  }

  return { success: true }
}

export function _getActiveSessionCount(): number {
  return activeSessions.size
}

export function _resetProcessLoopbackForTests(): void {
  for (const session of Array.from(activeSessions.values())) {
    try {
      if (session.cleanupRendererListener) session.cleanupRendererListener()
      session.child.kill()
    } catch {}
  }
  activeSessions.clear()
}
