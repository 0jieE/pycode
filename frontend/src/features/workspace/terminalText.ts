/** The terminal keeps only the newest ~64 KB on screen, so a runaway print loop cannot slow the page. */
export const TERMINAL_MAX_CHARS = 64 * 1024

export function capTerminalText(text: string): string {
  if (text.length <= TERMINAL_MAX_CHARS) return text
  return '… earlier output hidden …\n' + text.slice(text.length - TERMINAL_MAX_CHARS)
}
