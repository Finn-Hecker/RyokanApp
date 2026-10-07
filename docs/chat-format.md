# Native chat interchange V1

A UTF-8 JSON object with `schema: "ryokan.chat"` and integer `version: 1`.
This is a single solo conversation, not an application backup or a transcript.
The command implementation and its typed DTOs live in
`src-tauri/src/database/chat_transfer.rs`.

Required top-level fields:

- `conversation`: title, mode (`singleplayer`), creation/activity timestamps,
  pinned state, nullable branch source title, nullable character and role
  snapshots, and `summary` (`text` and `last_message_id`, both explicitly null
  when absent).
- `messages`: the complete chronological array, with source-local ID, role,
  content, nullable author, timestamp, ordered swipe variants, selected index,
  and aligned usage variants. Empty legacy swipe/usage arrays remain intact.
- `world_infos`: only lorebooks referenced by the character snapshot, including
  entries and their activation/placement metadata. Missing/deleted references
  remain inactive; unrelated library records are excluded.

The character snapshot contains ID, name, prompt, greeting, initials, color,
embedded avatar (`avatarUrl`) and ordered `world_info_ids`. The export
uses embedded bytes for the two bundled solo avatars as well, converting their
installation-specific Vite URLs during export. Arbitrary external URLs are rejected.
The role snapshot
contains name and prompt. Usage records contain reported token counts, model,
service tier, connection display name and cost, with no connection configuration.
Summary validity depends on its boundary message, message order and selected
contents. Runtime revisions and token estimate caches are intentionally excluded;
the imported conversation starts with fresh runtime state and the existing
revision/CAS/cancellation logic still applies.

Import assigns fresh conversation, message, character and lorebook IDs, remaps
the summary boundary and character lore references, and preserves message order
(including timestamp ties), message/lorebook timestamps, variants and snapshots. It copies linked
lorebooks into the existing library without overwriting any records. The chat
starts unpinned and unfiled, with creation and activity timestamps set to the
local import time so it appears first among unpinned conversations. Exported
conversation timestamps and pinned state remain in V1 JSON as historical metadata;
import does not restore them. Successful import refreshes the library without
opening the chat or navigating away from the current screen.
The chat has a new local sort position; source folder IDs, sort positions and
branch conversation links belong to the source library and are not portable.
The branch title is retained. No library character or global role is created.
Import commits all records in one transaction. No schema migration is needed.

Readers reject malformed JSON, unsupported schemas/versions, missing required
state, duplicate IDs, invalid roles/timestamps/swipe selection/usage, unlinked
lorebooks and inconsistent summary boundaries before any write. The maximum
encoded size is 64 MiB, enforced in both the UI and native commands. Export also
rejects inconsistent persisted state instead of silently producing partial data.

V1 readers tolerate unknown additive metadata fields. Producers must not put
required behavioral state into fields an older reader can ignore: future LTM or
memory support must specify its persistence/validation and negotiate a new
version if dropping it changes behavior. Unknown metadata is not retained by
V1 readers. Existing V1 fields remain stable; no LTM is implemented here.

System prompts, generation/summary settings, text rules and provider connections
remain installation settings and are not exported. Reproducing generation also
requires choosing the same settings separately. Credentials, diagnostics,
multiplayer session state and caches never enter this format.
