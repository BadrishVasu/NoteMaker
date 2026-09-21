// src/app/StorageError.tsx — 05-screens.md, "StorageError" (UI/UX, step 7). Full-screen, in place
// of the whole shell: the per-uid IndexedDB database would not open, so there is no list to show.
// Terminal, one action. No sign-out: the failure is this device's storage, not the account.

export function StorageError() {
  return (
    <main className="boot-failed">
      <p role="alert">Can&apos;t open this device&apos;s note storage. Nothing has been changed — try reloading.</p>
      <button type="button" className="primary" onClick={() => window.location.reload()}>
        Reload
      </button>
    </main>
  )
}
