import { getAutoSync, setAutoSync } from './prefs'

describe('platform/prefs', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('defaults to true when nothing has been stored', () => {
    expect(getAutoSync()).toBe(true)
  })

  it('persists a value across reads', () => {
    setAutoSync(false)
    expect(getAutoSync()).toBe(false)
    setAutoSync(true)
    expect(getAutoSync()).toBe(true)
  })

  it('falls back to an in-memory value when localStorage throws on write', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError')
    })
    expect(() => setAutoSync(false)).not.toThrow()
    spy.mockRestore()
  })

  it('falls back to an in-memory value when localStorage throws on read', () => {
    setAutoSync(false)
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError')
    })
    expect(() => getAutoSync()).not.toThrow()
    expect(getAutoSync()).toBe(false)
    spy.mockRestore()
  })
})
