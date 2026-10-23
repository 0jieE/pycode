import { describe, expect, it } from 'vitest'
import {
  chunk,
  csvField,
  csvFileName,
  formatCodeInput,
  isCompleteCode,
  maskedCode,
  registrationCodesCsv,
  SLIPS_PER_PAGE,
  validateSignup,
  type SignupForm,
} from './registration'

describe('formatCodeInput', () => {
  it.each([
    ['', ''],
    ['abc', 'ABC'],
    ['abcde', 'ABCDE'],
    ['abcdef', 'ABCDE-F'],
    ['abcdefghjk', 'ABCDE-FGHJK'],
  ])('%j -> %j', (typed, shown) => {
    expect(formatCodeInput(typed)).toBe(shown)
  })

  it('accepts a code pasted with a dash, spaces, lower case or stray characters', () => {
    expect(formatCodeInput('ABCDE-FGHJK')).toBe('ABCDE-FGHJK')
    expect(formatCodeInput(' abcde fghjk ')).toBe('ABCDE-FGHJK')
    expect(formatCodeInput('abcde--fgh.jk')).toBe('ABCDE-FGHJK')
  })

  it('stops at 10 characters', () => {
    expect(formatCodeInput('ABCDEFGHJKMNP')).toBe('ABCDE-FGHJK')
  })

  it('is stable: formatting a formatted code changes nothing', () => {
    const once = formatCodeInput('abcdefg')
    expect(formatCodeInput(once)).toBe(once)
  })
})

describe('isCompleteCode', () => {
  it('needs all 10 characters', () => {
    expect(isCompleteCode('ABCDE-FGHJK')).toBe(true)
    expect(isCompleteCode('ABCDE-FGHJ')).toBe(false)
    expect(isCompleteCode('')).toBe(false)
  })
})

describe('maskedCode', () => {
  it('hides everything but the last 4 characters, in their real positions', () => {
    expect(maskedCode('AB3K')).toBe('•••••-•AB3K')
  })
})

const good: SignupForm = {
  code: 'ABCDE-FGHJK',
  studentNo: '2026-0001',
  fullName: 'Maria Santos',
  username: 'maria.s_1',
  password: 'longenough',
  confirm: 'longenough',
}

describe('validateSignup', () => {
  it('accepts a complete form', () => {
    expect(validateSignup(good)).toEqual({})
  })

  it('needs a complete code, a student number and a name', () => {
    const errors = validateSignup({ ...good, code: 'ABC', studentNo: ' ', fullName: '' })
    expect(Object.keys(errors).sort()).toEqual(['code', 'fullName', 'studentNo'])
  })

  it.each([
    ['abc', false], // too short
    ['abcd', true], // exactly 4
    ['a'.repeat(32), true],
    ['a'.repeat(33), false],
    ['Maria', false], // capitals are not allowed (the form lower-cases what is typed)
    ['maria s', false],
    ['maria-s', false], // dash is not allowed here, unlike admin-made accounts
    ['m.s_9', true],
  ])('username %j is %s', (username, ok) => {
    expect('username' in validateSignup({ ...good, username })).toBe(!ok)
  })

  it('needs a password of at least 8 characters', () => {
    expect(validateSignup({ ...good, password: '1234567', confirm: '1234567' }).password).toMatch(
      /at least 8/,
    )
    expect(validateSignup({ ...good, password: '12345678', confirm: '12345678' })).toEqual({})
  })

  it('needs the two passwords to match', () => {
    expect(validateSignup({ ...good, confirm: 'different!' }).confirm).toMatch(/do not match/)
    expect(validateSignup({ ...good, confirm: '' }).confirm).toMatch(/again/)
  })

  it('does not nag about the confirmation while the password itself is too short', () => {
    const errors = validateSignup({ ...good, password: 'abc', confirm: 'xyz' })
    expect(errors.password).toBeDefined()
    expect(errors.confirm).toBeUndefined()
  })
})

describe('csv export', () => {
  it('quotes fields that need it and doubles quotes', () => {
    expect(csvField('plain')).toBe('plain')
    expect(csvField('BSIT 1-A, 2026')).toBe('"BSIT 1-A, 2026"')
    expect(csvField('say "hi"')).toBe('"say ""hi"""')
  })

  it('defuses values a spreadsheet would run as a formula', () => {
    expect(csvField('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)")
    expect(csvField('@cmd')).toBe("'@cmd")
    expect(csvField('+1')).toBe("'+1")
    expect(csvField('-1')).toBe("'-1")
    expect(csvField('BSIT-1')).toBe('BSIT-1') // only a leading character matters
  })

  it('has the three columns the admin asked for, one row per code, and a BOM', () => {
    const csv = registrationCodesCsv(['ABCDE-FGHJK', 'MNPQR-STUVW'], 'BSIT 1-A 2026', null)
    expect(csv.startsWith('﻿code,batch,student_no\r\n')).toBe(true)
    expect(csv.split('\r\n').filter(Boolean)).toEqual([
      '﻿code,batch,student_no',
      'ABCDE-FGHJK,BSIT 1-A 2026,',
      'MNPQR-STUVW,BSIT 1-A 2026,',
    ])
  })

  it('puts the bound student number on the row of a single code', () => {
    const csv = registrationCodesCsv(['ABCDE-FGHJK'], 'Late enrolees', '2026-0042')
    expect(csv).toContain('ABCDE-FGHJK,Late enrolees,2026-0042')
  })

  it('names the file after the batch, safely', () => {
    expect(csvFileName('BSIT 1-A 2026')).toBe('registration-codes-bsit-1-a-2026.csv')
    expect(csvFileName('  ///  ')).toBe('registration-codes-batch.csv')
    expect(csvFileName('Año/Kidapawan:1')).toBe('registration-codes-a-o-kidapawan-1.csv')
  })
})

describe('chunk', () => {
  it('splits slips into pages of 10', () => {
    const codes = Array.from({ length: 25 }, (_, i) => `C${i}`)
    const pages = chunk(codes, SLIPS_PER_PAGE)
    expect(pages.map((p) => p.length)).toEqual([10, 10, 5])
    expect(pages.flat()).toEqual(codes)
  })

  it('gives one page for 1 code and none for no codes', () => {
    expect(chunk(['a'], 10)).toEqual([['a']])
    expect(chunk([], 10)).toEqual([])
  })
})
