import type { StarterFile } from '@/api/types'
import { hasPathCollision, validateFilePath } from './paths'

// Same limits as the backend (activity_service.py / workspace_service.py). A starter file may be as large as the
// students' file limit, which an admin sets (Storage, at most 1 MB): the server checks that one and names the file.
export const MAX_STARTER_FILES = 50
export const MAX_FILE_BYTES = 1024 * 1024
export const MAX_STARTER_TOTAL_BYTES = 1024 * 1024

export const byteLength = (text: string) => new TextEncoder().encode(text).length

interface TreeEntry {
  id: number
  path: string
  is_folder: boolean
}

/** Whether a workspace folder has folders inside it (only flat folders can become an activity). */
export const hasSubfolders = (folder: string, entries: readonly TreeEntry[]): boolean =>
  entries.some((e) => e.is_folder && e.path.startsWith(`${folder}/`))

/** The files directly in a folder, with their names inside it ("lab1/main.py" -> "main.py"). */
export function filesInFolder(
  folder: string,
  entries: readonly TreeEntry[],
): { id: number; name: string }[] {
  return entries
    .filter((e) => !e.is_folder && e.path.startsWith(`${folder}/`))
    .map((e) => ({ id: e.id, name: e.path.slice(folder.length + 1) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** The file an activity runs and grades: main.py when there is one, else the first .py file. */
export function defaultEntryFile(names: readonly string[]): string | null {
  const py = names.filter((n) => n.toLowerCase().endsWith('.py'))
  return py.find((n) => n.toLowerCase() === 'main.py') ?? py[0] ?? null
}

/** The first thing wrong with a set of starter files, in plain English, or null when all is well. */
export function starterFilesProblem(files: readonly StarterFile[]): string | null {
  if (files.length > MAX_STARTER_FILES) return `Use at most ${MAX_STARTER_FILES} starter files.`
  const seen: string[] = []
  let total = 0
  for (const file of files) {
    const pathProblem = validateFilePath(file.path)
    if (pathProblem) return `${file.path || '(no name)'}: ${pathProblem}`
    if (hasPathCollision(file.path, seen))
      return `${file.path} appears twice (names ignore capitals).`
    seen.push(file.path)
    const size = byteLength(file.content)
    if (size > MAX_FILE_BYTES) return `${file.path} is larger than 1 MB.`
    total += size
  }
  if (total > MAX_STARTER_TOTAL_BYTES) return 'The starter files are larger than 1 MB in total.'
  return null
}
