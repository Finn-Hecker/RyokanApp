# Native generation presets (V1)

Presets are reusable templates, stored independently under `generation_presets_v1`
in the settings table. Library entries have a local preset ID and a native document.
The exported document has `format: "ryokan.preset"` and `version: 1`; it does not
contain the library ID, connection ID, model, endpoint, credentials or capability caches.
There is no SillyTavern import, compatibility layer or passthrough metadata.

## Configuration

- `generation`: temperature, multiplicative repetitionPenalty, topP, topK, minP
  and frequencyPenalty. Each has an explicit numeric `value` and boolean `enabled`.
  Disabled settings retain their values, but are not sent through typed controls.
- `prompt`: plain `system` and `postHistory` instructions. Empty system text uses
  the existing roleplay instructions. Character, player role, memory and world
  context remain application-owned. Final instructions follow conversation history.
  These fields do not evaluate macros or arbitrary code.
- `providers`: blocks keyed by Ryokan provider kind, containing maxTokens,
  thinkingBudget, reasoningLevel, serviceTier and additionalParameters. Output
  limits stay provider-bound because their thinking accounting differs. Custom JSON
  preserves objects, arrays, false, zero and null, including native thinking settings.
  Existing provider validation, capability gating and custom override precedence apply.

Additive presence penalties have no typed V1 preset control; they can be expressed
through the appropriate provider's custom JSON. They must never be mapped onto
`repetitionPenalty`. Profiles still serialize the legacy `presencePenalty` spelling,
and Tauri IPC retains its legacy payload spelling, solely for backwards compatibility.
Runtime code and native presets use the correct repetition name.

## Apply and edit

Create starts with the current connection's settings. Edit uses an isolated draft,
and updates the current provider block while retaining any other provider blocks.
Changing a preset does not implicitly change a connection. Apply resolves the
template into the selected profile and persists that profile before future request
snapshots. There is no live reference from a connection to a library entry.

Shared generation and prompt settings are replaced on Apply. Only the matching
provider block is applied. If it is absent, that connection's provider-specific
settings use the original manual baseline, with a notice in the UI. Endpoints, credentials, model,
context detection, memory strategy and summary connection selection stay unchanged.
The first activation persists an allowlisted `presetRestoreSnapshot` alongside
`appliedPresetId` in that connection's profile. It holds only preset-controlled
generation values and switches, provider controls, original custom JSON and prompts.
Switching presets keeps this baseline and resolves each new preset against it.
Deactivate restores it exactly, clears the association and removes the snapshot,
while retaining the library entry. Deleting an active preset performs the same
restoration for every affected connection before deleting the library entry.
Persistence errors roll back profile changes; failed library deletion restores
the previous profiles and their persisted associations and snapshots.

Older profiles without preset state remain manual. An older applied association
without a restore snapshot cannot recover settings already overwritten before this
feature; its current settings become the baseline on the next activation.

Normal chat and multiplayer use the resulting profile snapshots. Summary generation
continues to use its selected profile's generation settings and its own summary prompt
and output cap; roleplay instructions must not change the summary task. Prompt changes
participate in the existing generation fingerprint and token budget measurement.

## Native JSON boundary

V1 imports validate the exact supported structure and refuse unsupported versions,
unknown fields, non-finite/out-of-range numbers, protected request fields and custom
authentication/transport/session fields, including nested ones. JSON files are limited
to 1 MB, prompts to 100,000 characters each and custom nesting to 20 levels. Library
writes validate before persistence and publish only after success. An unreadable
library remains unavailable for editing rather than being silently overwritten.

Export reconstructs the allowlisted document instead of serializing a connection.
Import creates a new local library ID and never applies or overwrites a preset merely
because its name matches. Import/export preserve supported configuration values;
formatting and original JSON key order are not part of the contract.
