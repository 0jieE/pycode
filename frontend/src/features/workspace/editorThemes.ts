import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

/** The colours of one editor theme: the editor itself, then the syntax colours. */
interface Palette {
  dark: boolean
  bg: string
  fg: string
  caret: string
  selection: string
  selectionInactive: string
  activeLine: string
  gutter: string
  gutterActive: string
  bracketBg: string
  bracketOutline: string
  keyword: string // def, class, and, or, not, in, True...
  control: string // if, for, return, import...
  string: string
  escape: string
  number: string
  comment: string
  fn: string
  type: string
  variable: string
  link: string
}

function build(p: Palette): Extension {
  const theme = EditorView.theme(
    {
      '&': { color: p.fg, backgroundColor: p.bg },
      '&.cm-focused': { outline: 'none' },
      '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6' },
      '.cm-content': { caretColor: p.caret, padding: '6px 0' },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: p.caret },
      '.cm-selectionBackground': { backgroundColor: p.selectionInactive },
      '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-content ::selection':
        { backgroundColor: p.selection },
      '.cm-activeLine': { backgroundColor: p.activeLine },
      '.cm-gutters': { backgroundColor: p.bg, color: p.gutter, border: 'none' },
      '.cm-lineNumbers .cm-gutterElement': { padding: '0 14px 0 22px' },
      '.cm-activeLineGutter': { backgroundColor: 'transparent', color: p.gutterActive },
      '&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket': {
        backgroundColor: p.bracketBg,
        outline: `1px solid ${p.bracketOutline}`,
      },
    },
    { dark: p.dark },
  )

  const highlight = HighlightStyle.define([
    {
      tag: [t.keyword, t.modifier, t.definitionKeyword, t.operatorKeyword, t.self],
      color: p.keyword,
    },
    { tag: [t.bool, t.null], color: p.keyword },
    { tag: [t.controlKeyword, t.moduleKeyword], color: p.control },
    { tag: [t.string, t.special(t.string)], color: p.string },
    { tag: t.escape, color: p.escape },
    { tag: [t.number, t.integer, t.float], color: p.number },
    { tag: [t.comment, t.lineComment, t.blockComment], color: p.comment },
    {
      tag: [
        t.function(t.variableName),
        t.function(t.propertyName),
        t.function(t.definition(t.variableName)),
        t.meta,
      ],
      color: p.fn,
    },
    { tag: [t.className, t.definition(t.className), t.typeName], color: p.type },
    { tag: [t.variableName, t.propertyName, t.definition(t.variableName)], color: p.variable },
    // Markdown
    { tag: t.heading, color: p.keyword, fontWeight: 'bold' },
    { tag: t.strong, fontWeight: 'bold' },
    { tag: t.emphasis, fontStyle: 'italic' },
    { tag: [t.link, t.url], color: p.link },
    { tag: t.quote, color: p.comment },
    { tag: t.monospace, color: p.string },
  ])

  return [theme, syntaxHighlighting(highlight)]
}

/** VS Code's "Dark+" colours. */
export const vscodeDark = build({
  dark: true,
  bg: '#1e1e1e',
  fg: '#d4d4d4',
  caret: '#aeafad',
  selection: '#264f78',
  selectionInactive: '#3a3d41',
  activeLine: 'rgba(255, 255, 255, 0.05)',
  gutter: '#858585',
  gutterActive: '#c6c6c6',
  bracketBg: 'rgba(0, 100, 0, 0.1)',
  bracketOutline: '#888888',
  keyword: '#569cd6',
  control: '#c586c0',
  string: '#ce9178',
  escape: '#d7ba7d',
  number: '#b5cea8',
  comment: '#6a9955',
  fn: '#dcdcaa',
  type: '#4ec9b0',
  variable: '#9cdcfe',
  link: '#3794ff',
})

/** VS Code's "Light+" colours. */
export const vscodeLight = build({
  dark: false,
  bg: '#ffffff',
  fg: '#000000',
  caret: '#000000',
  selection: '#add6ff',
  selectionInactive: '#e5ebf1',
  activeLine: 'rgba(0, 0, 0, 0.04)',
  gutter: '#237893',
  gutterActive: '#0b216f',
  bracketBg: 'rgba(0, 100, 0, 0.1)',
  bracketOutline: '#b9b9b9',
  keyword: '#0000ff',
  control: '#af00db',
  string: '#a31515',
  escape: '#ee0000',
  number: '#098658',
  comment: '#008000',
  fn: '#795e26',
  type: '#267f99',
  variable: '#001080',
  link: '#0451a5',
})
