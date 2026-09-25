# Local diagnostics

Settings → About Ryokan → Export Diagnostics downloads a JSON report using the same
WebView download mechanism as character export. The UI reports a download request,
not a confirmed save (the WebView controls the destination). Nothing is uploaded.
Exported files are user-owned; delete them when no longer needed.

The Rust logger writes JSONL to Tauri's app log directory, in `diagnostics/`.
It rotates at UTC day boundaries or 1 MiB per segment, with at most 48 segments
(48 MiB total). Segments expire seven days after their last write. Cleanup runs
at startup, before writes/exports, and hourly while the app is open. A closed app
cannot clean its files until the next launch. Exports read only the latest two
segments (at most 2 MiB source data; pretty-printed JSON can be larger).

There is no free-text logging API, console forwarding, dependency log subscriber,
telemetry, or automatic upload. Events/areas/providers are closed Rust enums.
Severity is derived from the event: lifecycle/generation starts are info,
recoverable fallback/stream issues are warn, and failed operations are error.
Generic event/area pairs are recorded at most once per minute. Structured decision
records preserve quick successive generations and transitions, with a 600-record
per-minute flood cap and an explicit `decisions_throttled` event. There is no
per-token or per-message logging. Frontend errors use fixed functional categories.
Do not add raw error strings, response bodies, headers, URLs, identifiers, model
names, settings dumps, or content to this schema. Privacy uses exclusion, not
heuristic secret matching. Export reparses strict records and discards malformed,
unknown-field, unknown-enum, expired, and future-dated records.

Reports contain the actual running app version, OS family, architecture, Tauri
major version, debug/release flag, active provider kind, model-configured flag,
summary-enabled flag, log availability/degradation, and recent events. Custom
model names may contain private paths/content, so only configuration status is
included. No database content is read for diagnostics.

## Context and rolling-summary traces

The existing orchestrator emits selected boundary decisions, not every candidate
in its compression/chunk-search loops. Schema version 2 includes:

- `detection`: provider kind, result/failure/stale state, cache reuse, detected
  capacity and its provenance, manual cap, and resolved hard limit.
- `budget`: strategy, working target and compression goal, hard limit, prompt
  estimate actually used, full local estimate, additional-parameter token cost,
  generation reserve and separate safety margin. Reserve details report valid
  total/reasoning limits and invalid/ambiguous reasoning-control flags, never
  the underlying custom JSON. Anchor status explains local estimation versus
  API-input reconciliation, including why an anchor was rejected. Trigger reasons
  distinguish chat pressure, summary-model pressure, both, neither, and disabled
  memory. History length, marker index, summary presence, revision and retry flag
  describe state without exporting raw IDs or content.
- `summary_capacity`: actual input estimate, output reserve/cap, safety margin,
  hard limit and fit result for initial summary pressure and actual summary
  requests. Candidate searches are not logged.
- `summary_state`: start, marker correction, selected compression/retention counts,
  result token count, recompression, commit, rollback, conflict, cancellation
  reason, failed preparation, fallback result and readiness.
- `usage`: provider input/cached-input/output/reasoning counts, local input estimate
  and reserved generation tokens, separately for chat and summary requests.
  Missing provider counts remain null. Cached input is a subset of input and
  reasoning can be a subset of output; these columns must not be blindly summed.

Every record has a process-session number and sequence. Operation, conversation,
connection and request numbers are ephemeral, randomly seeded frontend counters;
raw IDs, URLs, model names and fingerprints are never emitted or hashed into logs.
Aliases are bounded to 256 in-memory identities and can change after eviction or
restart. Correlate records within a session, then follow the operation number.
The summary limit is zero in budget stages where it was not evaluated; inspect
the operation's decision and capacity records for the independent summary model.
API-anchored decisions also compute a local estimate for comparison, using the
existing token cache. Diagnostics never change the selected budget or trigger.

`npm run test:diagnostics` covers export/privacy and IPC failures; `npm run
test:summary` exercises the real orchestrator, including diagnostic trigger reasons,
reserve overrides, API/local differences, anchor reuse, marker resets and cancellation.

I/O failures disable/drop logging without breaking the calling operation. An OS
file lock prevents concurrent writers across app instances; a second instance
can export metadata but has no logs. Export runs on a blocking worker and log
calls skip a busy export lock. `busyDecisionDropsThisSession` exposes contention
losses; rotation/export limits can also leave incomplete traces. `logsAvailable`
and `loggingDegraded` expose missing
logs without including filesystem errors or paths. Standard-library file locking
requires Rust 1.89 or newer. Existing unrelated files in the log directory are
never exported or deleted. This is not a crash reporter: native aborts and
uncaught WebView exceptions are not automatically captured.
