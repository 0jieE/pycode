/**
 * Client-side preview of the student CSV import. The rules mirror the backend's (user_service.py)
 * only so problems can be shown before uploading; the backend stays the authority.
 */

export const IMPORT_COLUMNS = ['student_no', 'full_name', 'username', 'temp_password'] as const
export type ImportColumn = (typeof IMPORT_COLUMNS)[number]

// Nginx caps request bodies at 256 KB and the multipart wrapper adds a little, so stay under.
export const IMPORT_MAX_BYTES = 240 * 1024
export const IMPORT_MAX_ROWS = 1000

const USERNAME_RE = /^[A-Za-z0-9._-]{3,64}$/

/** RFC 4180 style parser: quoted fields, doubled quotes, CRLF or LF, optional BOM. */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      rows.push(row)
      row = []
    } else {
      field += ch
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  // A blank line is one empty field; the backend skips none, but a trailing newline must not count.
  return rows.filter((r) => !(r.length === 1 && r[0] === ''))
}

export interface PreviewRow {
  /** Spreadsheet row number: the header is row 1, so the first student is row 2. */
  row: number
  student_no: string
  full_name: string
  username: string
  temp_password: string
  /** Why the backend would skip this row, or null when it looks fine. */
  problem: string | null
}

export type ImportPreview =
  | { ok: false; error: string }
  | { ok: true; rows: PreviewRow[]; validCount: number; problemCount: number }

function checkRow(r: Omit<PreviewRow, 'problem' | 'row'>): string | null {
  if (!r.student_no || !r.full_name || !r.username || !r.temp_password) {
    return 'student_no, full_name, username and temp_password are all required'
  }
  if (!USERNAME_RE.test(r.username)) {
    return 'username must be 3-64 characters: letters, digits, dot, underscore or dash'
  }
  if (r.temp_password.length < 8 || r.temp_password.length > 128) {
    return 'temp_password must be 8-128 characters'
  }
  if (r.student_no.length > 32 || r.full_name.length > 150) {
    return 'student_no (max 32) or full_name (max 150) is too long'
  }
  return null
}

export function previewStudentCsv(text: string): ImportPreview {
  const table = parseCsv(text)
  const header = (table[0] ?? []).map((h) => h.trim().toLowerCase())
  const missing = IMPORT_COLUMNS.filter((c) => !header.includes(c))
  if (missing.length) {
    return { ok: false, error: `The file is missing these columns: ${missing.join(', ')}.` }
  }
  const dataRows = table.slice(1)
  if (dataRows.length === 0) return { ok: false, error: 'The file has no student rows.' }
  if (dataRows.length > IMPORT_MAX_ROWS) {
    return { ok: false, error: `The file has more than ${IMPORT_MAX_ROWS} rows.` }
  }

  const index = Object.fromEntries(IMPORT_COLUMNS.map((c) => [c, header.indexOf(c)])) as Record<
    ImportColumn,
    number
  >
  const seenUsernames = new Set<string>()
  const seenStudentNos = new Set<string>()
  const rows: PreviewRow[] = []

  dataRows.forEach((cells, i) => {
    const get = (c: ImportColumn) => (cells[index[c]] ?? '').trim()
    const base = {
      student_no: get('student_no'),
      full_name: get('full_name'),
      username: get('username'),
      temp_password: get('temp_password'),
    }
    let problem = checkRow(base)
    // The backend compares case-insensitively and keeps the first occurrence.
    if (!problem && seenUsernames.has(base.username.toLowerCase())) {
      problem = 'username appears more than once in this file'
    }
    if (!problem && seenStudentNos.has(base.student_no.toLowerCase())) {
      problem = 'student_no appears more than once in this file'
    }
    if (!problem) {
      seenUsernames.add(base.username.toLowerCase())
      seenStudentNos.add(base.student_no.toLowerCase())
    }
    rows.push({ row: i + 2, ...base, problem })
  })

  const problemCount = rows.filter((r) => r.problem).length
  return { ok: true, rows, validCount: rows.length - problemCount, problemCount }
}

export const CSV_TEMPLATE = `${IMPORT_COLUMNS.join(',')}\n2026-0001,Juan Dela Cruz,juan.delacruz,ChangeMe123\n`
