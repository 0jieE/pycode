import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The test backend's accounts, from the file its seed writes (`python -m app.e2e_seed`); passwords are never
 * copied into the repo. The demo's seed_credentials.txt is a different set of people.
 */
const FILE = resolve(import.meta.dirname, '../../backend/e2e_credentials.txt')

export interface Account {
  username: string
  password: string
  role: 'admin' | 'instructor' | 'student'
}

export function loadAccounts(): Map<string, Account> {
  const accounts = new Map<string, Account>()
  for (const line of readFileSync(FILE, 'utf8').split(/\r?\n/)) {
    // "username  role  password" and, in newer files, a trailing "LOGIN" column ("ok"): ignore extras.
    const m = line.trim().match(/^(\S+)\s+(admin|instructor|student)\s+(\S+)(?:\s+\S+)?$/)
    if (m) accounts.set(m[1]!, { username: m[1]!, role: m[2] as Account['role'], password: m[3]! })
  }
  return accounts
}

export function account(username: string): Account {
  const found = loadAccounts().get(username)
  if (!found)
    throw new Error(`${username} is not in e2e_credentials.txt (is the test backend seeded?)`)
  return found
}
