import { describe, expect, it } from 'vitest'
import { capTerminalText, TERMINAL_MAX_CHARS } from './terminalText'

describe('capTerminalText', () => {
  it('leaves normal output alone', () => {
    expect(capTerminalText('hello\n')).toBe('hello\n')
    const exactly = 'x'.repeat(TERMINAL_MAX_CHARS)
    expect(capTerminalText(exactly)).toBe(exactly)
  })

  it('keeps the newest output and says that older output is hidden', () => {
    const text = 'old'.repeat(TERMINAL_MAX_CHARS) + 'THE END'
    const shown = capTerminalText(text)
    expect(shown.startsWith('… earlier output hidden …')).toBe(true)
    expect(shown.endsWith('THE END')).toBe(true)
    expect(shown.length).toBeLessThan(TERMINAL_MAX_CHARS + 40)
  })
})
