// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { firestoreImportsIn, writePathViolations } from '../test/writePathGuard'

// Ticket 09's second guard. The ESLint boundary makes firestoreGateway.ts the only file that can
// import firebase/firestore; this makes runTransaction the only write path INSIDE it. Tested in
// both directions: a checker that never matches and a clean file look identical from outside.

const GATEWAY = 'src/sync/firestoreGateway.ts'

describe('runTransaction is the only write path in firestoreGateway.ts', () => {
  it('the real gateway has no direct write', () => {
    expect(writePathViolations(readFileSync(GATEWAY, 'utf8'))).toEqual([])
  })

  it('the checker is reading the real gateway: it sees runTransaction imported there', () => {
    expect(firestoreImportsIn(readFileSync(GATEWAY, 'utf8'))).toContain('runTransaction')
  })

  it.each([
    ['setDoc', `import { runTransaction, setDoc } from 'firebase/firestore'\n`],
    ['updateDoc', `import { updateDoc } from 'firebase/firestore'\n`],
    ['addDoc', `import { addDoc } from 'firebase/firestore'\n`],
    ['writeBatch', `import { writeBatch } from 'firebase/firestore'\n`],
    ['deleteDoc', `import { deleteDoc } from 'firebase/firestore'\n`],
    ['an aliased setDoc', `import { setDoc as put } from 'firebase/firestore'\n`],
    ['a namespace import', `import * as fs from 'firebase/firestore'\n`],
    ['a dynamic import', `export const lazy = () => import('firebase/firestore')\n`],
    ['a require', `const fs = require('firebase/firestore')\n`],
    ['a subpath import', `import { setDoc } from 'firebase/firestore/lite'\n`],
  ])('flags %s (negative control)', (_name, source) => {
    expect(writePathViolations(source)).not.toEqual([])
  })

  it('does not flag reads, the listener and runTransaction (negative control)', () => {
    const source = `import { runTransaction, doc, collection, onSnapshot, initializeFirestore, memoryLocalCache } from 'firebase/firestore'\n`
    expect(writePathViolations(source)).toEqual([])
  })

  it('does not flag a banned name from some other module', () => {
    expect(writePathViolations(`import { setDoc } from './somewhereElse'\n`)).toEqual([])
  })
})
