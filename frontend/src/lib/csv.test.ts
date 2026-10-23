import { describe, expect, it } from 'vitest'
import { parseCsv, previewStudentCsv } from './csv'

const HEADER = 'student_no,full_name,username,temp_password'

describe('parseCsv', () => {
  it('handles quotes, commas inside fields, CRLF and a BOM', () => {
    const rows = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n')
    expect(rows).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
    ])
  })

  it('ignores blank lines and a missing final newline', () => {
    expect(parseCsv('a,b\n\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })
})

describe('previewStudentCsv', () => {
  it('numbers rows like a spreadsheet (header = 1) and accepts valid rows', () => {
    const p = previewStudentCsv(`${HEADER}\n2026-1,Ana Reyes,ana.reyes,Passw0rd!\n`)
    expect(p).toMatchObject({ ok: true, validCount: 1, problemCount: 0 })
    if (p.ok) expect(p.rows[0]).toMatchObject({ row: 2, username: 'ana.reyes', problem: null })
  })

  it('matches headers case-insensitively and in any order', () => {
    const p = previewStudentCsv(
      'Username,Temp_Password,Full_Name,Student_No\nbob_s,Passw0rd!,Bob,1\n',
    )
    expect(p).toMatchObject({ ok: true, validCount: 1 })
  })

  it('reports missing columns', () => {
    const p = previewStudentCsv('student_no,full_name,username\n1,A,abc\n')
    expect(p).toEqual({ ok: false, error: 'The file is missing these columns: temp_password.' })
  })

  it('rejects a file with only a header', () => {
    expect(previewStudentCsv(`${HEADER}\n`)).toMatchObject({ ok: false })
  })

  it('flags bad usernames, short passwords and empty cells', () => {
    const p = previewStudentCsv(
      `${HEADER}\n1,A,ab,Passw0rd!\n2,B,valid.name,short\n3,,someone,Passw0rd!\n`,
    )
    if (!p.ok) throw new Error('expected a preview')
    expect(p.rows.map((r) => r.problem)).toEqual([
      expect.stringMatching(/username must be 3-64/),
      expect.stringMatching(/temp_password must be 8-128/),
      expect.stringMatching(/all required/),
    ])
    expect(p.validCount).toBe(0)
  })

  it('flags duplicates inside the file case-insensitively, keeping the first', () => {
    const p = previewStudentCsv(
      `${HEADER}\n1,A,sam.lee,Passw0rd!\n2,B,SAM.LEE,Passw0rd!\n1,C,other.one,Passw0rd!\n`,
    )
    if (!p.ok) throw new Error('expected a preview')
    expect(p.rows[0]!.problem).toBeNull()
    expect(p.rows[1]!.problem).toMatch(/username appears more than once/)
    expect(p.rows[2]!.problem).toMatch(/student_no appears more than once/)
    expect(p).toMatchObject({ validCount: 1, problemCount: 2 })
  })
})
