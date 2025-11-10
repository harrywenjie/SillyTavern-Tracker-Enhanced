# Repository Guidelines

## Project Structure & Module Organization
- `index.js` wires SillyTavern events, generation mutex listeners, and slash commands into the extension entry point.
- Core logic under `src/`: `tracker.js` orchestrates generation/injection, `generation.js` handles independent connection requests, `trackerDataHandler.js` manages schema reconciliation, and `ui/` + `settings/` hold modals, previews, and defaults.
- Shared helpers live in `lib/` (`utils.js`, `interconnection.js`, `ymlParser.js`); reuse them before adding new utilities.
- UI assets remain in `html/settings.html`, `sass/style.scss`, and compiled `style.css`. Treat `docs/Tracker Documentation.pdf` as legacy; rely on `README.md` for current behaviour.

## Build, Test & Development Commands
- `npx sass sass/style.scss style.css --no-source-map` rebuilds stylesheets (`--watch` for live edits).
- After JS/HTML changes reload via SillyTavern `Settings -> Extensions -> Reload`.
- In the browser console inspect `window.trackerEnhanced` to view runtime state or toggle debug logging.

## Coding Style & Conventions
- ES modules, double quotes, trailing semicolons. Core logic uses tabs; selective UI helpers use four spaces; match the file.
- Naming: PascalCase classes, camelCase functions/vars, SCREAMING_SNAKE_CASE constants, DOM IDs prefixed with `tracker_enhanced_`.
- Use provided `debug/log/warn/error` helpers for console output so debug mode can silence them globally.

## Tracker Behaviour Notes (2025-09)
- Tracker auto-generation hooks fire from `onGenerateAfterCommands`, `onMessageSent/Received`, and render callbacks. SillyTavern emits a `generation_after_commands` dry-run immediately after `chat_id_changed`; we now bail early and log `GENERATION_AFTER_COMMANDS dry run skip { type: "normal", dryRun: true, ... }` to confirm no request is sent.
- The first real turn after a reload still fires a second `generation_after_commands` with `dryRun: false`. Look for the log payload `(3) [undefined, options, false]` before tracker generation starts. If that never appears, reload the extension to clear stale `chat_metadata`.
- `addTrackerToMessage` writes tracker data before the DOM exists; previews/interface updates must run in `onUserMessageRendered`/`onCharacterMessageRendered`. Skipping those handlers after a tracker exists hides UI updates.
- When investigating tracker gaps, capture the full console sequence (chat open -> user turn -> character reply). Two sequential generation calls are expected in single-stage mode: one for the previous message, one for the newly rendered message. Only unexpected dry-run omissions should be treated as regressions.

## Testing Workflow
- Manual validation only: stage chats, send user/character turns, run `/tracker save`, inspect preview pane, and watch console for `[tracker-enhanced]` logs or unexpected mutex captures.
- For regression checks, confirm both standalone tracker interface updates and inline preview rendering for freshly generated messages.

## Commit & PR Expectations
- Follow history style: short imperative titles (e.g., `add createAndJoin`).
- PRs should note motivation, UX impact, preset migration steps, and link relevant SillyTavern changes. Include screenshots or YAML snippets if UI output changes.

## Migration Context
- Development moved from Claude to Codex agents. Keep AGENTS.md updated with key learnings (like the tracker generation findings above) so future compactions retain context.

## Environment Notes
- Windows 11 with PowerShell 7; prefer launching commands via `pwsh -NoLogo -NoProfile` to avoid user profile noise.
- Long embedded strings in PowerShell inline commands are brittle, so use here-strings or drop a temporary script file (e.g., write a `.py` helper) when you need heavy quoting or backslashes.
- Python resolves through pyenv shims; prefer explicit `python` but be ready to pass `encoding="utf-8"` when reading repo files to dodge the default `gbk` codec.
