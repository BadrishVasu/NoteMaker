import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCorpus } from './corpus'
import { makeRow, id } from '../test/rows'

let corpus: ReturnType<typeof createCorpus>

beforeEach(() => {
  corpus = createCorpus()
})

describe('reading', () => {
  it('starts empty', () => {
    expect(corpus.getRows().size).toBe(0)
    expect(corpus.getRow(id('nope'))).toBeUndefined()
  })

  it('replaceAll seeds the whole corpus', () => {
    const a = makeRow({ id: 'a' })
    const b = makeRow({ id: 'b' })
    corpus.replaceAll([a, b])
    expect(corpus.getRows().size).toBe(2)
    expect(corpus.getRow(id('a'))).toBe(a)
  })

  it('hands back the row object it was given, not a copy — identity is the re-render contract', () => {
    const a = makeRow({ id: 'a' })
    corpus.replaceAll([a])
    corpus.applyWrites([{ op: 'put', row: makeRow({ id: 'b' }) }])
    expect(corpus.getRow(id('a'))).toBe(a)
  })
})

describe('useSyncExternalStore contract', () => {
  it('getRows is referentially stable while nothing changes', () => {
    corpus.replaceAll([makeRow({ id: 'a' })])
    expect(corpus.getRows()).toBe(corpus.getRows())
  })

  it('getRows returns a NEW map after a change, so React sees one', () => {
    corpus.replaceAll([makeRow({ id: 'a' })])
    const before = corpus.getRows()
    corpus.applyWrites([{ op: 'put', row: makeRow({ id: 'b' }) }])
    expect(corpus.getRows()).not.toBe(before)
  })

  it('leaves untouched rows referentially identical across a change — this is the whole point', () => {
    const a = makeRow({ id: 'a' })
    corpus.replaceAll([a])
    corpus.applyWrites([{ op: 'put', row: makeRow({ id: 'b' }) }])
    expect(corpus.getRows().get(id('a'))).toBe(a)
  })

  it('getRow is stable for an untouched Note and changes for a written one', () => {
    const a1 = makeRow({ id: 'a' })
    corpus.replaceAll([a1])
    const a2 = makeRow({ id: 'a', body: 'edited' })
    corpus.applyWrites([{ op: 'put', row: a2 }])
    expect(corpus.getRow(id('a'))).toBe(a2)
  })

  it('the version counter moves on a change and not otherwise', () => {
    const v0 = corpus.getVersion()
    corpus.applyWrites([])
    expect(corpus.getVersion()).toBe(v0)
    corpus.applyWrites([{ op: 'put', row: makeRow({ id: 'a' }) }])
    expect(corpus.getVersion()).toBe(v0 + 1)
  })
})

describe('notification', () => {
  it('notifies subscribers once per batch, not once per write', () => {
    const seen = vi.fn()
    corpus.subscribe(seen)
    corpus.applyWrites([
      { op: 'put', row: makeRow({ id: 'a' }) },
      { op: 'put', row: makeRow({ id: 'b' }) },
      { op: 'put', row: makeRow({ id: 'c' }) },
    ])
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it('does not notify on an empty batch — a snapshot that changed nothing must not re-render', () => {
    const seen = vi.fn()
    corpus.subscribe(seen)
    corpus.applyWrites([])
    expect(seen).not.toHaveBeenCalled()
  })

  it('notifies on replaceAll', () => {
    const seen = vi.fn()
    corpus.subscribe(seen)
    corpus.replaceAll([makeRow({ id: 'a' })])
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it('unsubscribe stops notifications', () => {
    const seen = vi.fn()
    corpus.subscribe(seen)()
    corpus.applyWrites([{ op: 'put', row: makeRow({ id: 'a' }) }])
    expect(seen).not.toHaveBeenCalled()
  })

  it('a subscriber that throws does not stop the others — one bad component is not a dead app', () => {
    const second = vi.fn()
    corpus.subscribe(() => {
      throw new Error('render exploded')
    })
    corpus.subscribe(second)
    expect(() => corpus.applyWrites([{ op: 'put', row: makeRow({ id: 'a' }) }])).not.toThrow()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('notifies AFTER the new snapshot is readable, never before', () => {
    let seenSize = -1
    corpus.subscribe(() => {
      seenSize = corpus.getRows().size
    })
    corpus.applyWrites([{ op: 'put', row: makeRow({ id: 'a' }) }])
    expect(seenSize).toBe(1)
  })
})

describe('deletes', () => {
  it('a delete write removes the row', () => {
    corpus.replaceAll([makeRow({ id: 'a' })])
    corpus.applyWrites([{ op: 'delete', id: id('a') }])
    expect(corpus.getRow(id('a'))).toBeUndefined()
  })

  it('deleting an absent row is not a change and does not notify', () => {
    const seen = vi.fn()
    corpus.subscribe(seen)
    corpus.applyWrites([{ op: 'delete', id: id('ghost') }])
    expect(seen).not.toHaveBeenCalled()
    expect(corpus.getVersion()).toBe(0)
  })
})

describe('the conflict redirect — 02: the editor follows the content, not the id', () => {
  it('delivers from → to to redirect subscribers', () => {
    const seen = vi.fn()
    corpus.subscribeRedirect(seen)
    corpus.redirect(id('note'), id('note__c7f__r9'))
    expect(seen).toHaveBeenCalledWith({ from: id('note'), to: id('note__c7f__r9') })
  })

  it('does not reach ordinary corpus subscribers — a redirect is not a data change', () => {
    const data = vi.fn()
    corpus.subscribe(data)
    corpus.redirect(id('a'), id('b'))
    expect(data).not.toHaveBeenCalled()
  })

  it('unsubscribe stops redirects', () => {
    const seen = vi.fn()
    corpus.subscribeRedirect(seen)()
    corpus.redirect(id('a'), id('b'))
    expect(seen).not.toHaveBeenCalled()
  })

  it('a redirect subscriber that throws does not stop the others', () => {
    const second = vi.fn()
    corpus.subscribeRedirect(() => {
      throw new Error('boom')
    })
    corpus.subscribeRedirect(second)
    expect(() => corpus.redirect(id('a'), id('b'))).not.toThrow()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('the rows the redirect points at are already in the corpus when it is delivered', () => {
    // The engine writes the copy and the surviving Note in one store transaction, then tells the
    // corpus. The editor must be able to read `to` the instant it hears about it, or it renders a
    // blank editor for one frame — which is "a character on screen changed" and 05 forbids it.
    let toBody: string | undefined
    corpus.subscribeRedirect(({ to }) => {
      toBody = corpus.getRow(to)?.body
    })
    corpus.applyWrites([{ op: 'put', row: makeRow({ id: 'copy', body: 'my text' }) }])
    corpus.redirect(id('note'), id('copy'))
    expect(toBody).toBe('my text')
  })
})
