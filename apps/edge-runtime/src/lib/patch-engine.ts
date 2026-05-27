/**
 * EdgeGDE Runtime — JSON Patch Engine (RFC 6902 subset)
 * Track 4 Phase 4: Granular path-based mutation with whitelist enforcement.
 *
 * Allowed ops: add, replace, remove
 * Path rules:
 *   ✅  /children/[index]/props/*
 *   ✅  /children/[index]/children/*
 *   ✅  /props/*
 *   ❌  / (root)
 *   ❌  /children (root array)
 *   ❌  /children/[index] (node replacement)
 *   ❌  /children/[index]/props (prop object replacement)
 *   ❌  remove on /children/[index] or /children
 */

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface PatchOperation {
  op: 'add' | 'replace' | 'remove'
  path: string
  value?: any
}

export interface PatchResult {
  success: boolean
  layout?: any
  error?: string
  path?: string
}

// ═══════════════════════════════════════════════════════════════════════════
// Path Parsing
// ═══════════════════════════════════════════════════════════════════════════

interface ParsedPath {
  /** Full segments: e.g. ['children', '0', 'props', 'title'] */
  segments: string[]
  /** True if path targets a leaf property (not an array or object) */
  isLeaf: boolean
}

function parsePath(path: string): ParsedPath | null {
  if (!path.startsWith('/')) return null
  const raw = path.slice(1)
  if (!raw) return { segments: [], isLeaf: false }
  const segments = raw.split('/').map(decodeURIComponent)
  return { segments, isLeaf: true }
}

// ═══════════════════════════════════════════════════════════════════════════
// Path Validation
// ═══════════════════════════════════════════════════════════════════════════

const GRANULAR_ALLOW_RE = [
  /^children\/\d+\/props\/.+$/,   // /children/[index]/props/[key]
  /^children\/\d+\/children\/.+$/, // /children/[index]/children/[key]
  /^props\/.+$/,                   // /props/[key]
]

// Remove has extra deny rules beyond the granular allow
const REMOVE_DENY_RE = [
  /^children\/\d+$/,    // /children/[index] — node deletion
  /^children$/,         // /children — array clear
  /^children\/\d+\/children$/, // /children/[index]/children — children array clear
]

function isPathAllowed(segments: string[], op: string): boolean {
  const pathStr = segments.join('/')

  // Root deny
  if (segments.length === 0) return false

  // Check granular allow rules
  const allowed = GRANULAR_ALLOW_RE.some((re) => re.test(pathStr))
  if (!allowed) return false

  // Extra deny for remove
  if (op === 'remove') {
    const denied = REMOVE_DENY_RE.some((re) => re.test(pathStr))
    if (denied) return false
  }

  return true
}

// ═══════════════════════════════════════════════════════════════════════════
// Path Traversal & Mutation
// ═══════════════════════════════════════════════════════════════════════════

function traverseAndMutate(
  obj: any,
  segments: string[],
  op: string,
  value?: any,
): boolean {
  let current = obj

  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]
    // Handle array index segments
    const idx = /^\d+$/.test(seg) ? parseInt(seg, 10) : seg

    if (current[idx] === undefined || current[idx] === null) return false
    current = current[idx]
  }

  const lastKey = segments[segments.length - 1]
  const lastIdx = /^\d+$/.test(lastKey) ? parseInt(lastKey, 10) : lastKey

  if (op === 'remove') {
    if (Array.isArray(current) && typeof lastIdx === 'number') {
      if (lastIdx < 0 || lastIdx >= current.length) return false
      current.splice(lastIdx, 1)
    } else {
      if (!(lastKey in current)) return false
      delete current[lastKey]
    }
    return true
  }

  // add or replace
  current[lastIdx] = value
  return true
}

// ═══════════════════════════════════════════════════════════════════════════
// Apply Patches
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Apply an array of RFC 6902 patch operations to a layout object.
 * Returns the modified layout on success, or an error result.
 */
export function applyPatches(
  layout: any,
  operations: PatchOperation[],
): PatchResult {
  if (!Array.isArray(operations)) {
    return { success: false, error: 'Operations must be an array' }
  }

  if (operations.length > 20) {
    return { success: false, error: 'Exceeded maximum patch operations (20)' }
  }

  // Deep clone to avoid mutating the original
  const cloned = JSON.parse(JSON.stringify(layout))

  for (const op of operations) {
    // Validate op
    if (!['add', 'replace', 'remove'].includes(op.op)) {
      return {
        success: false,
        error: `Unsupported operation: ${op.op}`,
        path: op.path,
      }
    }

    // Parse path
    const parsed = parsePath(op.path)
    if (!parsed) {
      return {
        success: false,
        error: `Invalid path: ${op.path}`,
        path: op.path,
      }
    }

    // Validate path against whitelist
    if (!isPathAllowed(parsed.segments, op.op)) {
      return {
        success: false,
        error: `Path not allowed: ${op.path}`,
        path: op.path,
      }
    }

    // Apply mutation
    const applied = traverseAndMutate(cloned, parsed.segments, op.op, op.value)
    if (!applied) {
      return {
        success: false,
        error: `Cannot apply ${op.op} at ${op.path} — path does not exist`,
        path: op.path,
      }
    }
  }

  return { success: true, layout: cloned }
}
