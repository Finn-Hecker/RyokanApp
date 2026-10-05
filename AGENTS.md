# Working on Ryokan

Ryokan is a Svelte 5 / SvelteKit frontend with a Tauri 2 Rust backend and
SQLite persistence. Read [docs/architecture.md](docs/architecture.md) for entry
points and data flows. Use Node.js 24 and the Rust version required by Cargo.toml.

## Responsibilities and boundaries

- `src/lib/components`: UI and component-local interactions, grouped by screen.
- `src/lib/stores`: shared reactive state and application coordination. Preserve
  existing store exports and Svelte rune semantics.
- `src/lib/ai/{connections,generation,prompt,tokens,summary}`: AI domain logic.
  Keep pure computation separate from runtime code that uses stores or Tauri.
  Pass inputs explicitly to pure modules; do not add runtime store dependencies.
- `src/lib/chat`: message data, greetings, scrolling and message rendering.
- `src/lib/settings`, `diagnostics`, `updates`: the respective application services.
- `src/lib/utils`: general UI/platform helpers, not a catch-all for domain logic.
- `src-tauri/src/ai.rs`: stable AI command entry points, cancellation and streaming
  coordination; `ai/` contains parameter, usage, model, context and provider logic.
- `src-tauri/src/database`: SQLite schema, migrations and domain persistence.
- `src-tauri/src/import.rs` / `export.rs`: character-card import and export.

Split by responsibility, not by line count. Avoid circular runtime imports and
unnecessary re-export layers. Prefer direct module imports and colocated tests.
Preserve Tauri command names, payloads, event names, persisted formats and public
function contracts during refactors. Keep summary cancellation, immutable request
snapshots, revision checks and compare-and-swap commits intact. Diagnostics must
not include prompts, messages, credentials or multiplayer secrets.

Do not hand-edit generated `src/lib/paraglide`, `.svelte-kit`, `build`, or Rust
`target` output. Translation sources live in `messages/`. Do not broadly reformat
unrelated files or change UI/behavior as part of an architecture-only refactor.

## Runtime and visual verification

Do not start the application, development server, or Tauri runtime unless the
user explicitly asks you to. Do not run `npm run dev`, `vite`, `tauri dev`, or
equivalent commands by default.

Do not open the application in a browser or use browser automation for visual
verification unless explicitly requested. Automated tests, typechecks, linters,
Rust tests and production builds are the default verification methods.

If visual or runtime verification would be useful but was not explicitly
requested, mention it in the final summary instead of performing it.

## Validation (from repository root)

Run affected test groups after a focused change. After a domain relocation or
module split, run the full frontend suite, typecheck, production build and Rust
tests. Before completion run all four again against the final source tree.

```sh
npm test                     # every *.test.mjs under src/ and scripts/
npm run check                # Svelte + TypeScript
npm run build                # production frontend build
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo check --manifest-path src-tauri/Cargo.toml --locked
```

Existing focused test commands:

```sh
npm run test:summary
npm run test:prompt
npm run test:connections
npm run test:diagnostics
npm run test:updater
npm run test:usage
npm run test:tokens
npm run test:text-rules
```

`npm run check:watch` is the watch variant. Component, navigation, store and
remaining helper tests are included in `npm test`. Some tests execute extracted
production functions with VM/AST harnesses: update their source paths and module
resolution when moving files, without weakening assertions. Shared frontend/Rust
provider contracts live in `tests/fixtures/provider-contracts.json`.
