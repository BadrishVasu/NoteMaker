# Editor and app-shell UX

Type: prototype
Status: open

## Question

What does the app actually look like, on a phone and on a desktop browser?

Raise the fidelity of the discussion by building something rough to react to rather than describing
it. Cover: the Note list and how a Note is opened; the editor itself — is markdown typed as markup
with a separate preview, split-pane, or rendered inline; how a new Note is created and how it is
saved (explicit save versus continuous); where search lives; how Trash is reached; how sync state
is surfaced, if at all, and what the user sees when offline.

Use the `prototype` skill and link the artefact from this ticket. This is HITL: the reactions are
Badrish's, and the agent never stands in for his side of it.

## Constraints from ticket 01

The title behaviour is already settled and the prototype must honour it rather than re-invent it:

- Every Note starts **Derived titled** — the title follows the first non-empty line of the body,
  markdown heading markers stripped, truncated to 100 characters.
- The moment the user types in the title field the Note becomes **Custom titled**, and this is a
  **one-way latch** — emptying the title afterwards does not restore derivation.
- A title is mandatory. A Note with nothing to derive from and no custom title falls back to the
  **Default title** `Untitled Note N`. The Default title does not latch.

What is still this ticket's to decide: how the title field is presented so the latch is
discoverable rather than surprising, and whether the user is shown anything when a Default title is
assigned.
