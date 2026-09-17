// A clock the test advances by hand. The engine consults no clock directly; it is given one.

import type { Clock } from '../sync/engine'

interface Timer {
  id: number
  at: number
  fn: () => void
}

export class ManualClock implements Clock {
  private t = 1_000_000
  private seq = 0
  private timers: Timer[] = []

  now(): number {
    return this.t
  }

  setTimeout(fn: () => void, ms: number): number {
    const id = ++this.seq
    this.timers.push({ id, at: this.t + ms, fn })
    return id
  }

  clearTimeout(handle: unknown): void {
    this.timers = this.timers.filter((x) => x.id !== handle)
  }

  /** Delays of the timers currently armed, relative to now, soonest first. */
  pending(): number[] {
    return this.timers.map((x) => x.at - this.t).sort((a, b) => a - b)
  }

  /** Moves time forward, firing every timer that falls due, in order. */
  advance(ms: number): void {
    const end = this.t + ms
    for (;;) {
      const due = this.timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0]
      if (due === undefined) break
      this.timers = this.timers.filter((x) => x !== due)
      this.t = due.at
      due.fn()
    }
    this.t = end
  }
}
