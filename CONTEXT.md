# NoteMaker

A personal, offline-first notes application: a web app and an installable Android PWA sharing one
account's notes, where a note written on either device appears on the other.

## Language

**Note**:
A single piece of markdown text belonging to exactly one user, identified by a stable id that
survives editing, syncing, and deletion.
_Avoid_: Document, entry, memo, page

**Conflict copy**:
The losing side of a last-write-wins resolution, preserved as a separate Note rather than
discarded, so a write is never silently lost.
_Avoid_: Duplicate, backup, revision, version

**Tombstone**:
The marker left behind when a Note is deleted, so that a device which never observed the deletion
cannot resurrect the Note by syncing its stale copy.
_Avoid_: Soft delete flag, archived, trashed

**Trash**:
The view listing Notes that carry a Tombstone but have not yet been purged. A Note in the Trash is
still recoverable; a purged Note is not.
_Avoid_: Bin, archive, recycle

**Outbox**:
The set of Notes a device has changed but not yet successfully pushed. A Note sits in the Outbox
from the moment it is edited until the server has accepted that exact edit.
_Avoid_: Queue, pending writes, dirty list, drafts

**Fork point**:
The version of a Note that a device's unpushed edit was made on top of. Comparing the fork point
against what the server currently holds is what tells a device whether anyone else changed the Note
while it was away.
_Avoid_: Base, ancestor, last known, baseline

**App shell**:
The part of the application that is cached ahead of time and rendered before any Note data is
available, so the app opens with no network.
_Avoid_: Skeleton, layout, frame

**Derived title**:
The state a Note is in while its title is taken automatically from the first line of its body,
updating as that line changes. Every Note starts here.
_Avoid_: Auto title, implicit title, placeholder title

**Custom title**:
The state a Note enters the moment the user types in the title field, after which the title is
whatever they set and no longer follows the body. The transition is one-way: a Note that has
become Custom titled never returns to Derived, not even if the user empties the title again.
_Avoid_: Manual title, overridden title, explicit title

**Default title**:
The fallback title `Untitled Note N` given to a Note that has nothing to derive a title from and no
custom title, so that a Note is never untitled. It does not latch: a Derived titled Note carrying a
Default title starts following its body again as soon as that body has a first line.
_Avoid_: Placeholder, unnamed, blank title
