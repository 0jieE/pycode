/**
 * Friendly client-side pre-checks for workspace paths. They mirror the backend's rules
 * (workspace_service.normalize_path) so mistakes show up before a request; the server still decides.
 */

export const ALLOWED_EXTENSIONS = ['.py', '.txt', '.csv', '.json', '.md'] as const
export const MAX_PATH_LENGTH = 255

/** Returns a plain-English problem with `path`, or null when it is acceptable. */
export function validatePath(path: string): string | null {
  if (!path) return 'Enter a name.'
  if (path.length > MAX_PATH_LENGTH) return `Use at most ${MAX_PATH_LENGTH} characters.`
  if (path.includes('\\')) return 'Use / between folders, not \\.'
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  if (/[\u0000-\u001f]/.test(path)) return 'Control characters are not allowed.'
  if (path.startsWith('/')) return "Don't start with /."
  const segments = path.split('/')
  if (segments.some((s) => s === '')) return 'Folder and file names cannot be empty.'
  if (segments.some((s) => s === '.' || s === '..')) return "'.' and '..' are not allowed."
  if (segments.some((s) => s.startsWith('.'))) return "Names cannot start with '.'."
  if (segments.some((s) => s !== s.trim())) return 'Names cannot start or end with a space.'
  return null
}

export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot).toLowerCase()
}

/** Like validatePath, plus: only .py .txt .csv .json .md files. */
export function validateFilePath(path: string): string | null {
  const problem = validatePath(path)
  if (problem) return problem
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(extensionOf(path))) {
    return `Use one of these file types: ${ALLOWED_EXTENSIONS.join(' ')}`
  }
  return null
}

/** An activity title becomes one folder in every student workspace, so it must be a single name. */
export function validateActivityTitle(title: string): string | null {
  if (!title.trim()) return 'Enter a title.'
  if (title.includes('/')) return "The title can't contain '/'."
  return validatePath(title.trim())
}

/** Case-insensitive collision check (`A.py` and `a.py` are the same file). */
export function hasPathCollision(path: string, existing: Iterable<string>): boolean {
  const lower = path.toLowerCase()
  for (const other of existing) if (other.toLowerCase() === lower) return true
  return false
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function parentOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

export interface EntryLike {
  path: string
  is_folder: boolean
}

/**
 * Full pre-check for creating or renaming/moving a workspace entry: the path rules, the file-type
 * rule (files only), name collisions, a file standing where a folder is needed, and folder-into-itself.
 * `movingFrom` is the entry's current path when renaming (so it does not collide with itself).
 */
export function validateEntryPath(
  path: string,
  opts: { isFolder: boolean; entries: readonly EntryLike[]; movingFrom?: string },
): string | null {
  const problem = opts.isFolder ? validatePath(path) : validateFilePath(path)
  if (problem) return problem

  const others = opts.entries.filter((e) => e.path !== opts.movingFrom)
  if (
    hasPathCollision(
      path,
      others.map((e) => e.path),
    )
  ) {
    return 'Something with that name already exists here (names ignore capitals).'
  }
  // Every folder along the way must be a folder, not a file.
  let parent = parentOf(path)
  while (parent !== '') {
    const clash = others.find((e) => e.path.toLowerCase() === parent.toLowerCase())
    if (clash && !clash.is_folder) return `"${clash.path}" is a file, so it can't hold other files.`
    parent = parentOf(parent)
  }
  if (opts.movingFrom && opts.isFolder) {
    const from = opts.movingFrom.toLowerCase()
    if ((path.toLowerCase() + '/').startsWith(from + '/')) {
      return "A folder can't be moved into itself."
    }
  }
  return null
}
