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

Depends on ticket 04: there is no project or hostname to configure until the accounts exist.
