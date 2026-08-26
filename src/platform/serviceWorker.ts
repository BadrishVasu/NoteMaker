import { registerSW } from 'virtual:pwa-register'

/**
 * Ticket 10 / Badrish, 2026-08-26: update mode is `prompt`, and it is locked by the first deploy.
 *
 * `autoUpdate` was rejected because this is a text editor — `skipWaiting` + `clientsClaim` can swap
 * the running app out from under someone mid-sentence, and ticket 05's premise is that the editor
 * never moves under the user's hands.
 *
 * The reload itself is always safe and must never grow an Outbox interlock: ticket 03's mirror is
 * durable and the Outbox is a stored column, so a reload mid-push loses a push attempt, never a
 * keystroke.
 *
 * The bar's placement and copy are UI/UX's at build step 6 — it shares the shell's bottom strip
 * region with `N notes waiting to sync` and the two must not stack. This is the plumbing only.
 */
export function registerServiceWorker(): void {
  const updateSW = registerSW({
    onNeedRefresh() {
      // Placeholder affordance for step 0. Replaced by the real bar at step 6 — deliberately not
      // a `confirm()` in the shipped shell, because a modal can strand a write.
      if (window.confirm('A new version of NoteMaker is available. Reload now?')) {
        void updateSW(true)
      }
    },
  })
}
