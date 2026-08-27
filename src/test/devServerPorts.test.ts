import { describe, expect, it } from 'vitest'
import config from '../../vite.config'

/**
 * The dev and preview ports are coupled to something outside this repo: ticket 04's HTTP-referrer
 * restriction on the Firebase web API key lists `http://localhost:5173/*` and
 * `http://localhost:4173/*` **explicitly**, because port wildcards are not reliably honoured.
 *
 * Vite's default is to increment past a busy port — 5173 becomes 5174 with one dim line in the
 * banner. 5174 is not on the allowlist, so Identity Toolkit answers the sign-in popup with
 * `403 Requests from referer http://localhost:5174 are blocked`, which reads as an auth bug and
 * not as a port that moved. `strictPort` converts that into a refusal to start, which is the
 * failure anyone can actually diagnose.
 *
 * So this asserts the coupling, not the config: the ports must be pinned, and pinned to the two
 * values ticket 04 verified with curl. Change either side and this test is the thing that says the
 * other side needs changing too.
 */

const ALLOWLISTED_PORTS = { dev: 5173, preview: 4173 } as const

describe('local server ports stay on ticket 04 referrer allowlist', () => {
  it('pins the dev server to the allowlisted port', () => {
    expect(config.server?.port).toBe(ALLOWLISTED_PORTS.dev)
  })

  it('pins the preview server to the allowlisted port', () => {
    expect(config.preview?.port).toBe(ALLOWLISTED_PORTS.preview)
  })

  it('refuses to fall back to an unlisted port rather than drifting silently', () => {
    expect(config.server?.strictPort).toBe(true)
    expect(config.preview?.strictPort).toBe(true)
  })
})
