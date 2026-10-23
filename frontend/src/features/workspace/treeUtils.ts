import { baseName, parentOf } from '@/lib/paths'

/** The minimum a tree needs to know about an entry. API entries (with ids, sizes) satisfy this. */
export interface PathEntry {
  path: string
  is_folder: boolean
}

export interface TreeNode {
  name: string
  path: string
  isFolder: boolean
  children: TreeNode[]
}

const byName = (a: TreeNode, b: TreeNode) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })

/**
 * Flat paths -> nested tree. Folders come first, then files, each sorted by name.
 * A folder that is only implied by a file path ("lab/a.py" without a "lab" entry) is created.
 */
export function buildTree(entries: readonly PathEntry[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>()
  const roots: TreeNode[] = []

  const attach = (node: TreeNode) => {
    nodes.set(node.path, node)
    const parent = parentOf(node.path)
    if (parent === '') roots.push(node)
    else ensureFolder(parent).children.push(node)
  }

  function ensureFolder(path: string): TreeNode {
    const existing = nodes.get(path)
    if (existing) return existing
    const node: TreeNode = { name: baseName(path), path, isFolder: true, children: [] }
    attach(node)
    return node
  }

  for (const entry of entries) {
    if (entry.is_folder) {
      ensureFolder(entry.path)
    } else if (!nodes.has(entry.path)) {
      attach({ name: baseName(entry.path), path: entry.path, isFolder: false, children: [] })
    }
  }

  const sortDeep = (list: TreeNode[]) => {
    list.sort((a, b) => (a.isFolder === b.isFolder ? byName(a, b) : a.isFolder ? -1 : 1))
    list.forEach((n) => sortDeep(n.children))
  }
  sortDeep(roots)
  return roots
}

/** Every folder path in the tree, e.g. to start with everything expanded. */
export function folderPaths(entries: readonly PathEntry[]): string[] {
  const set = new Set<string>()
  for (const e of entries) {
    let p = e.is_folder ? e.path : parentOf(e.path)
    while (p !== '') {
      set.add(p)
      p = parentOf(p)
    }
  }
  return [...set]
}

/**
 * What the tree looks like after renaming or moving `from` to `to`: the entry itself and, for a
 * folder, everything inside it get the new prefix. Used to show a rename at once, before the server
 * has answered. A sibling that merely starts with the same letters ("lab2" next to "lab") is left alone.
 */
export function renameSubtree<T extends { path: string }>(
  entries: readonly T[],
  from: string,
  to: string,
): T[] {
  return entries.map((entry) => {
    if (entry.path === from) return { ...entry, path: to }
    if (entry.path.startsWith(from + '/'))
      return { ...entry, path: to + entry.path.slice(from.length) }
    return entry
  })
}
