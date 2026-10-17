import * as path from 'path'

/**
 * Validates that a file or directory path is safe:
 * - Must be a non-empty string.
 * - Must not contain null bytes.
 * - Must not be a URI scheme (like javascript:, data:, file://).
 * - Must be resolvable by path.resolve.
 */
export function isSafePath(filePath: unknown): boolean {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    return false
  }

  // Prevent null-byte injection
  if (filePath.includes('\0')) {
    return false
  }

  // Reject URI protocols (e.g. javascript:, data:, file://), but allow Windows drive letters (C:\)
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(filePath) && !/^[a-zA-Z]:[\\/]/.test(filePath)) {
    return false
  }

  try {
    const resolved = path.resolve(filePath)
    return Boolean(resolved && resolved.length > 0)
  } catch {
    return false
  }
}

/**
 * Validates that an external URL is safe:
 * - Must start with https: or http: (preferring https:).
 * - Disallows dangerous protocols such as javascript:, file:, data:.
 */
export function isSafeUrl(url: unknown): boolean {
  if (typeof url !== 'string' || url.trim() === '') {
    return false
  }

  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}
