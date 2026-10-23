import { useMemo } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { python } from '@codemirror/lang-python'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { indentUnit } from '@codemirror/language'
import { EditorState, type Extension } from '@codemirror/state'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-500.css'
import { extensionOf } from '@/lib/paths'
import { useEditorTheme } from '@/lib/useTheme'
import { vscodeDark, vscodeLight } from './editorThemes'

interface CodeEditorProps {
  /** The file's path: its extension picks the syntax highlighting, and a new path resets undo. */
  path: string
  value: string
  onChange?: (value: string) => void
  readOnly?: boolean
  /** Default: the signed-in user's editor colours (Settings). */
  theme?: 'dark' | 'light'
  /** Accessible name for the editor region. */
  label?: string
}

function languageFor(path: string): Extension[] {
  switch (extensionOf(path)) {
    case '.py':
      return [python()]
    case '.json':
      return [json()]
    case '.md':
      return [markdown()]
    default:
      return []
  }
}

/** CodeMirror 6 with 4-space indentation, line numbers and bracket matching. */
export default function CodeEditor({
  path,
  value,
  onChange,
  readOnly = false,
  theme: forced,
  label = 'Code editor',
}: CodeEditorProps) {
  const preferred = useEditorTheme()
  const theme = forced ?? preferred
  const extensions = useMemo(
    () => [...languageFor(path), indentUnit.of('    '), EditorState.tabSize.of(4)],
    [path],
  )

  return (
    <CodeMirror
      // A different file starts with a clean editor state (cursor, undo history).
      key={path}
      value={value}
      onChange={onChange}
      extensions={extensions}
      readOnly={readOnly}
      editable={!readOnly}
      theme={theme === 'dark' ? vscodeDark : vscodeLight}
      height="100%"
      style={{ height: '100%', fontSize: 14 }}
      aria-label={label}
      basicSetup={{
        lineNumbers: true,
        bracketMatching: true,
        closeBrackets: true,
        indentOnInput: true,
        autocompletion: false,
        foldGutter: false,
        highlightActiveLine: !readOnly,
      }}
    />
  )
}
