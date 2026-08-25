# Cloudflare Pages build config and Firebase config as environment variables

Type: task
Status: open
Blocked by: 04

## Question

How does a commit become a live app on the `*.pages.dev` URL?

Settle and then set up: the Cloudflare Pages build command and output directory for a Vite build;
how the Firebase web config reaches the build as environment variables, and which of those values
are safe to expose in a client bundle (most are, but state it explicitly rather than assuming);
whether preview deployments on branches are enabled, and whether they need their own Firebase
project or can share one; and how Firestore security rules get deployed, since Cloudflare Pages
does not deploy them.

**Also settle the service-worker update mode (`autoUpdate` vs `prompt`).** Ticket 07 found this
must be chosen before the first deploy — switching afterward is problematic — and no other ticket
owns the choice. It belongs here because this is the ticket that actually ships the first build;
see `.scratch/notes-mvp/issues/07-pwa-service-worker.md` and `research/07-pwa-service-worker.md`
for the tradeoff.

Depends on ticket 04: there is no project or hostname to configure until the accounts exist.

## Flagged by the Overseer

Nothing has been deployed since ticket 04 closed, despite this ticket being open and unblocked the
whole time. The map's destination is a *running* app, not a specified one — the cheapest de-risking
step available is a Vite hello-world pushed through this exact pipeline: build, deploy to
`note-maker-f41.pages.dev`, install to the Android homescreen, sign in. That proves the referrer
allowlist, `signInWithPopup` across the origin split, and the manifest/icons — three things
currently believed to work on research alone rather than verified.
