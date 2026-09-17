#!/usr/bin/env node
// Wraps `firebase emulators:exec` for `npm run test:emulator`.
//
// Root cause this exists to handle: on Windows, `emulators:exec` sends the Firestore emulator's
// Java child SIGINT, which Windows only emulates — the Java process does not reliably honour it,
// even when firebase-tools itself logs a clean shutdown and exits 0. The next run then fails with
// "port taken", pointing at a `firestore.rules` or gateway bug that doesn't exist. See
// firebase/firebase-tools#1367, #8007, #3871.
//
// What this script does, in order:
//   1. Refuses to start if PORT is already bound, and says which process owns it — a stale
//      listener from a previous run should never silently eat the new run's results.
//   2. Runs `firebase emulators:exec --only firestore --project PROJECT_ID "<TEST_CMD>"`,
//      inheriting stdio so vitest's own output is unchanged.
//   3. After it exits, kills the process tree it started (`taskkill /F /T` on the PID we spawned,
//      which finds descendants even if the immediate firebase-tools process has already exited —
//      Windows records each process's parent PID at creation time, independent of whether that
//      parent is still alive). Then, defensively, re-checks PORT: since step 1 proved it free
//      before this run started, anything listening on it now was spawned by this run, tree-kill
//      or not, and gets killed directly by PID.
//   4. Exits with the exact code `firebase emulators:exec` returned, which is vitest's exit code
//      (firebase-tools propagates the wrapped script's own exit status) — a failing test must
//      still fail the npm script, cleanup or not.
//
// No sleeps: every wait here is a process exit event or a single synchronous state check, never a
// blind delay hoping the OS has caught up.

import { spawn, execFileSync } from 'node:child_process'

const PORT = 8080
const PROJECT_ID = 'demo-notemaker'
const TEST_CMD = 'vitest run --config vitest.emulator.config.ts'
const IS_WINDOWS = process.platform === 'win32'

function portOwner(port) {
  if (IS_WINDOWS) {
    let out
    try {
      out = execFileSync('cmd', ['/c', `netstat -ano | findstr :${port}`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    } catch {
      return null // findstr exits 1 when nothing matches — port is free.
    }
    for (const line of out.split(/\r?\n/)) {
      const cols = line.trim().split(/\s+/)
      // TCP  127.0.0.1:8080  0.0.0.0:0  LISTENING  <pid>
      if (cols.length >= 5 && cols[0] === 'TCP' && cols[3] === 'LISTENING' && cols[1].endsWith(`:${port}`)) {
        const pid = cols[4]
        let name = 'unknown process'
        try {
          // Direct argv, not `cmd /c "tasklist /FI ..."` — nesting this inside a second shell
          // quoting layer (as netstat|findstr needs, above) breaks tasklist's own /FI parsing.
          const tl = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
          })
          const first = tl.trim().split(/\s+/)[0]
          if (first) name = first
        } catch {
          // best-effort only — the PID is what matters for killing it
        }
        return { pid, name }
      }
    }
    return null
  }
  try {
    const out = execFileSync('lsof', ['-ti', `tcp:${port}`], { encoding: 'utf8' }).trim()
    const pid = out.split(/\r?\n/)[0]
    return pid ? { pid, name: 'unknown process' } : null
  } catch {
    return null
  }
}

function killPid(pid, { tree } = { tree: false }) {
  if (IS_WINDOWS) {
    const args = tree ? ['/F', '/T', '/PID', pid] : ['/F', '/PID', pid]
    try {
      execFileSync('taskkill', args, { stdio: 'ignore' })
    } catch {
      // Already gone by the time we got here — fine, that's the goal.
    }
    return
  }
  try {
    process.kill(Number(pid), 'SIGKILL')
  } catch {
    // Already gone.
  }
}

function main() {
  const busy = portOwner(PORT)
  if (busy) {
    console.error(
      `test:emulator: port ${PORT} is already in use by ${busy.name} (PID ${busy.pid}). ` +
        `Refusing to start — a stale emulator would silently corrupt this run's results. ` +
        `Kill it first: taskkill /F /PID ${busy.pid}${IS_WINDOWS ? '' : ' (or `kill -9`)'}.`,
    )
    process.exit(1)
  }

  // Built as a single command string, not spawn(cmd, args, { shell: true }): with shell:true,
  // Node quotes each array element independently before handing the line to cmd.exe, which
  // re-splits TEST_CMD's own spaces into separate emulators:exec arguments ("Too many arguments").
  // A pre-assembled string bypasses that re-quoting entirely.
  const command = `firebase emulators:exec --only firestore --project ${PROJECT_ID} "${TEST_CMD}"`
  const child = spawn(command, { stdio: 'inherit', shell: true })

  child.on('exit', (code, signal) => {
    // Step 3: clean up regardless of how the run went.
    if (child.pid) killPid(String(child.pid), { tree: true })
    const leftover = portOwner(PORT)
    if (leftover) {
      console.error(`test:emulator: cleaning up a leftover listener on port ${PORT} (PID ${leftover.pid}).`)
      killPid(leftover.pid, { tree: false })
    }
    process.exit(code ?? (signal ? 1 : 1))
  })

  child.on('error', (err) => {
    console.error(`test:emulator: failed to start firebase emulators:exec: ${err.message}`)
    process.exit(1)
  })
}

main()
