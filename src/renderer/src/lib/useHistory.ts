/**
 * useHistory.ts
 * 50-Step Snapshot History Stack for Undo/Redo in Omega Wave Recorder.
 * 
 * Manages full snapshots of `Track[]` state, cut operations, region modifications,
 * and track properties.
 * 
 * Provides:
 * 1. `HistoryStack<T>` - Standalone, fully testable imperative history manager.
 * 2. `useHistory<T>` - React Hook with reactivity, keyboard shortcuts (Ctrl+Z / Ctrl+Y),
 *    and automatic 50-depth bounding.
 */

import { useState, useCallback, useEffect, useRef } from 'react'

export const MAX_HISTORY_STEPS = 50

/**
 * Deep clone utility to ensure snapshots are immutable and isolated.
 */
export function deepClone<T>(val: T): T {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(val)
    } catch {
      // Fallback if objects contain non-clonable elements
    }
  }
  return JSON.parse(JSON.stringify(val))
}

/**
 * Imperative HistoryStack class for non-react or headless state management.
 */
export class HistoryStack<T> {
  private past: { state: T; id: number }[] = []
  private present: T
  private presentId: number = 0
  private future: { state: T; id: number }[] = []
  private readonly maxDepth: number
  private nextId: number = 1
  private cleanId: number = 0

  constructor(initialPresent: T, maxDepth: number = MAX_HISTORY_STEPS) {
    this.present = deepClone(initialPresent)
    this.maxDepth = maxDepth
    this.presentId = 0
    this.cleanId = 0
    this.nextId = 1
  }

  public get state(): T {
    return this.present
  }

  public get canUndo(): boolean {
    return this.past.length > 0
  }

  public get canRedo(): boolean {
    return this.future.length > 0
  }

  public get historyLength(): number {
    return this.past.length
  }

  public get isModified(): boolean {
    return this.presentId !== this.cleanId
  }

  public markClean(savedState: T = this.present): void {
    if (savedState !== this.present) return
    this.cleanId = this.presentId
  }

  /**
   * Pushes a new snapshot to the history stack.
   * If history exceeds maxDepth (50 steps), oldest item is evicted.
   * Any pending redo snapshots are cleared.
   */
  public push(newState: T): void {
    // Clone present to past
    this.past.push({ state: deepClone(this.present), id: this.presentId })
    if (this.past.length > this.maxDepth) {
      this.past.shift()
    }
    this.present = deepClone(newState)
    this.presentId = this.nextId++
    this.future = []
  }

  /**
   * Updates present state without pushing to past (useful for continuous/transient edits).
   */
  public setPresent(newState: T, markAsModified: boolean = false): void {
    this.present = deepClone(newState)
    if (markAsModified) {
      this.presentId = this.nextId++
      this.future = []
    }
  }

  /**
   * Reverts to the previous snapshot.
   */
  public undo(): T | null {
    if (!this.canUndo) return null

    const previous = this.past.pop()!
    this.future.unshift({ state: deepClone(this.present), id: this.presentId })
    this.present = previous.state
    this.presentId = previous.id
    return deepClone(this.present)
  }

  /**
   * Reapplies a previously undone snapshot.
   */
  public redo(): T | null {
    if (!this.canRedo) return null

    const next = this.future.shift()!
    this.past.push({ state: deepClone(this.present), id: this.presentId })
    this.present = next.state
    this.presentId = next.id
    return deepClone(this.present)
  }

  /**
   * Clears the history and resets present to an isolated initial state.
   */
  public clear(newPresent?: T): void {
    this.past = []
    this.future = []
    if (newPresent !== undefined) {
      this.present = deepClone(newPresent)
    }
    this.presentId = 0
    this.cleanId = 0
    this.nextId = 1
  }
}

export interface UseHistoryReturn<T> {
  state: T
  set: (newState: T | ((prev: T) => T)) => void
  setPresent: (newState: T | ((prev: T) => T), markModified?: boolean) => void
  undo: () => T | null
  redo: () => T | null
  canUndo: boolean
  canRedo: boolean
  clear: (initialState?: T) => void
  markClean: (savedState?: T) => void
  isModified: boolean
  historyCount: number
}

/**
 * React Hook for 50-step undo/redo snapshot tracking.
 */
export function useHistory<T>(
  initialPresent: T,
  options?: {
    maxDepth?: number
    enableShortcuts?: boolean
  }
): UseHistoryReturn<T> {
  const maxDepth = options?.maxDepth ?? MAX_HISTORY_STEPS
  const enableShortcuts = options?.enableShortcuts ?? true

  const stackRef = useRef<HistoryStack<T>>(new HistoryStack<T>(initialPresent, maxDepth))
  const [state, setState] = useState<T>(stackRef.current.state)
  const [, setVersion] = useState<number>(0)

  const triggerUpdate = useCallback(() => {
    setState(stackRef.current.state)
    setVersion((v) => v + 1)
  }, [])

  const set = useCallback(
    (newState: T | ((prev: T) => T)) => {
      const resolved = typeof newState === 'function' ? (newState as any)(stackRef.current.state) : newState
      stackRef.current.push(resolved)
      triggerUpdate()
    },
    [triggerUpdate]
  )

  const setPresent = useCallback(
    (newState: T | ((prev: T) => T), markModified?: boolean) => {
      const resolved = typeof newState === 'function' ? (newState as any)(stackRef.current.state) : newState
      stackRef.current.setPresent(resolved, markModified)
      triggerUpdate()
    },
    [triggerUpdate]
  )

  const undo = useCallback(() => {
    if (stackRef.current.canUndo) {
      const res = stackRef.current.undo()
      triggerUpdate()
      return res
    }
    return null
  }, [triggerUpdate])

  const redo = useCallback(() => {
    if (stackRef.current.canRedo) {
      const res = stackRef.current.redo()
      triggerUpdate()
      return res
    }
    return null
  }, [triggerUpdate])

  const clear = useCallback(
    (newPresent?: T) => {
      stackRef.current.clear(newPresent)
      triggerUpdate()
    },
    [triggerUpdate]
  )

  const markClean = useCallback((savedState?: T) => {
    stackRef.current.markClean(savedState)
    triggerUpdate()
  }, [triggerUpdate])

  // Global Keyboard Shortcuts (Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z)
  useEffect(() => {
    if (!enableShortcuts) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input or textarea
      const target = e.target as HTMLElement
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) {
          // Ctrl+Shift+Z -> Redo
          e.preventDefault()
          redo()
        } else {
          // Ctrl+Z -> Undo
          e.preventDefault()
          undo()
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        // Ctrl+Y -> Redo
        e.preventDefault()
        redo()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [undo, redo, enableShortcuts])

  return {
    state,
    set,
    setPresent,
    undo,
    redo,
    canUndo: stackRef.current.canUndo,
    canRedo: stackRef.current.canRedo,
    clear,
    markClean,
    isModified: stackRef.current.isModified,
    historyCount: stackRef.current.historyLength
  }
}
