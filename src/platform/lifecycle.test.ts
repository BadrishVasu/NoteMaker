import { attachLifecycleFlush } from './lifecycle'

describe('attachLifecycleFlush', () => {
  it('calls flush on window blur', () => {
    const flush = vi.fn()
    const detach = attachLifecycleFlush(flush)
    window.dispatchEvent(new Event('blur'))
    expect(flush).toHaveBeenCalledTimes(1)
    detach()
  })

  it('calls flush on pagehide', () => {
    const flush = vi.fn()
    const detach = attachLifecycleFlush(flush)
    window.dispatchEvent(new Event('pagehide'))
    expect(flush).toHaveBeenCalledTimes(1)
    detach()
  })

  it('calls flush when visibility becomes hidden, not when it becomes visible', () => {
    const flush = vi.fn()
    const detach = attachLifecycleFlush(flush)
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(flush).toHaveBeenCalledTimes(1)

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(flush).toHaveBeenCalledTimes(1)
    detach()
  })

  it('stops listening after teardown', () => {
    const flush = vi.fn()
    const detach = attachLifecycleFlush(flush)
    detach()
    window.dispatchEvent(new Event('blur'))
    window.dispatchEvent(new Event('pagehide'))
    expect(flush).not.toHaveBeenCalled()
  })
})
