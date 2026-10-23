/** 0 B, 512 B, 1.5 KB, 2 MB. Binary units, one decimal at most, no trailing ".0". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(1).replace(/\.0$/, '')} ${units[i]}`
}
