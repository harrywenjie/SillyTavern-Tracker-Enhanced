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

## UI Localization
- Settings and modal markup use `data-i18n-key` for every translatable string; avoid mixing in legacy `for`-selector lookups.
- Attribute translations piggyback on `data-i18n-target="attr:foo"` (or `attr:title`, `attr:value`, etc.), and multiple attributes can be hooked with dedicated `data-i18n-key-*`/`data-i18n-target-*` pairs.
- When labels need to control inputs, keep `for`/`aria-labelledby` in place for accessibility—the localization hook lives alongside those attributes.
- Locale bundles (`locales/en.json`, `locales/zh-cn.json`, plus any additional `locales/<locale>.json`) stay in identical key order to simplify diffs and reduce merge errors. Tracker Enhanced pulls the locale list from SillyTavern at runtime—consult `docs/locale_guide.md` before adding or reviewing translations.

## Tracker Behaviour Notes
- Tracker auto-generation hooks fire from `onGenerateAfterCommands`, `onMessageSent/Received`, and render callbacks. SillyTavern emits a `generation_after_commands` dry-run immediately after `chat_id_changed`; we now bail early and log `GENERATION_AFTER_COMMANDS dry run skip { type: "normal", dryRun: true, ... }` to confirm no request is sent.
- The first real turn after a reload still fires a second `generation_after_commands` with `dryRun: false`. Look for the log payload `(3) [undefined, options, false]` before tracker generation starts. If that never appears, reload the extension to clear stale `chat_metadata`.
- `addTrackerToMessage` writes tracker data before the DOM exists; previews/interface updates must run in `onUserMessageRendered`/`onCharacterMessageRendered`. Skipping those handlers after a tracker exists hides UI updates.
- When investigating tracker gaps, capture the full console sequence (chat open -> user turn -> character reply). Two sequential generation calls are expected in single-stage mode: one for the previous message, one for the newly rendered message. Only unexpected dry-run omissions should be treated as regressions.
- “Automation Target” now exclusively controls which speakers trigger automatic tracker runs (and which entries appear in the popup selector), while “Participant Focus” only drives seeding/prompt guidance for defaults.
- Participant guidance text is now editable in settings; the template supports the `{{participants}}` placeholder and defaults live in `participantGuidanceTemplate` for presets/locales.

## Fertility Engine Prep
- Phase 2 replaced legacy `FertilityCycle`/`Pregnancy` strings with the STATIC `WombStats` hierarchy and the DYNAMIC `LastCreampie` object exactly as captured in `docs/fertility_engine_design.md`.
- Presets (`presets/en.json`, `presets/zh-cn.json`) and locale prompts now instruct models to keep `WombStats` read-only while populating `LastCreampie` for the latest message only; the UI preview surfaces the new structure in place of the removed fields.
- Tracker previews render `WombStats` summaries and the most recent creampie report; the hide script keys off `internalKeyId` so non-female characters suppress the new rows automatically.
- Engine implementers should note the template assumes `SpermReservoir`/`ContraceptionStatus` arrive as keyed objects (not bare arrays) so we can iterate safely until helper support for ordered arrays lands.

## Fertility Engine Implementation – Phase 3
- Added `lib/fertilityEngine.js` to deterministically advance cycles, decay sperm reservoirs, roll conception, and progress pregnancies using `WombStats`/`LastCreampie` plus `TimeAnalysis`. All lookups rely on tracker `internalKeyId` metadata.
- `runFertilityEngine()` now executes during tracker generation and manual saves; `LastCreampie` events are consumed each turn, and resulting state is persisted via `trackerInternal.FertilityEngine` alongside refreshed `WombStats`.
- Debug hooks surface through `window.trackerEnhanced.getFertilityDiagnostics()`, while existing `debug` logs gain `[fertility]` context for cycle, reservoir, and pregnancy transitions.
- Pregnancy halts cycle advancement at `labor_imminent`; birth handling remains a TODO logged for future phases. Hormonal contraception pauses ovulation, and barrier methods attenuate reservoir potency per design doc multipliers.

## Testing Workflow
- Manual validation only: stage chats, send user/character turns, run `/tracker save`, inspect preview pane, and watch console for `[tracker-enhanced]` logs or unexpected mutex captures.
- For regression checks, confirm both standalone tracker interface updates and inline preview rendering for freshly generated messages.

## Commit & PR Expectations
- Follow history style: short imperative titles (e.g., `add createAndJoin`).
- PRs should note motivation, UX impact, preset migration steps, and link relevant SillyTavern changes. Include screenshots or YAML snippets if UI output changes.

## Migration Context
- Development moved from Claude to Codex agents. Keep AGENTS.md updated with key learnings (like the tracker generation findings above) so future compactions retain context.

## Environment Notes
- WSL2 Ubuntu 22.04

## Time System Notes
- Time handling now uses two fields: `TimeAnchor` (internal-only ISO timestamp stored in `chat[mesId].trackerInternal`) and `LocalTime` (public flavour text for the same moment).
- `buildTimeAnalysis` (lib/timeManager.js) records the anchor, epoch milliseconds, elapsed seconds/days relative to the previous stored analysis, and a timeline note. If no new anchor is provided, the last analysis is reused.
- Regeneration (`TrackerInterface.regenerateTracker`) writes `generationResult.trackerInternal` back to the message before saving, so the UI’s “Show Internal Events” view reflects the latest anchor/analysis immediately.
- Debug logging prints a single `🕒 Parsed TimeAnchor` entry whenever a fresh anchor is parsed; seeing more usually means the save path reprocessed data incorrectly.
- Prompts instruct the LLM to advance `TimeAnchor` each turn (unless the story truly freezes time) and then describe the same moment in `LocalTime`.

## Tracker Schema Maintenance
- The canonical tracker schema now loads from the bundled preset snapshots (`presets/en.json`, etc.) at runtime. `defaultSettings.js` only keeps extension-level toggles, so update the English preset when fields change.
- Tracker fields now declare separate `id` and `label` values (metadata version 4). IDs stay machine-safe for prompts/templates, while labels surface localized display text; follow-up phases must migrate runtime accessors off the old `name` property.
- Locale presets must mirror the canonical field IDs/metadata. When adjusting defaults, copy the same structure into JSON presets (e.g. `presets/zh-cn.json`) and translate prompts there.
- `sanitizeTrackerDefinition` now only normalises metadata against the canonical map. It no longer injects missing fields, so missing required keys are treated as legacy presets and routed to the auto-backup flow.
- Tracker field presence is now a read-only attribute: `DYNAMIC` fields are generated each turn, while `STATIC` fields are reserved for engine-managed state. The prompt maker shows this as a badge instead of an editable dropdown, and the deprecated `EPHEMERAL` presence automatically maps to `DYNAMIC` during schema sanitisation.

## Legacy Registry & Preset Quarantine
- All preset validation routes through `lib/legacyRegistry.js`. Use `analyzeTrackerDefinition`, `analyzePresetSnapshot`, and `generateLegacyPresetName` instead of mutating payloads directly; the registry returns reason codes and timestamps that feed the UI.
- Settings bootstrap, reset, locale seeding, and import flows must normalize `extensionSettings.legacyPresets` using the shared helpers before touching live presets. Quarantined entries stay in that archive; do not rehydrate them into active maps.
- The **Legacy presets (view only)** button launches `LegacyPresetManagerModal`, which surfaces archive records, reason summaries, export/delete hooks, and links into `LegacyPresetViewerModal`. Any new workflow touching legacy data should reuse these components instead of duplicating UI.
- Toast/notification copy is localized. When adding new quarantine outcomes, wire them through `announcePresetQuarantine()` and add matching keys to both locale bundles (entry order must remain identical).
- Runtime code now enforces canonical IDs/labels only. `trackerDataHandler` funnels unknown fields into `_extraFields`, and `generation.js` warns about unexpected response keys—avoid reintroducing fallbacks that revive legacy `name` support.

## Prompt Maker Notes
- Field IDs remain stable; the prompt maker now synchronises backend order with the DOM without renumbering. This preserves metadata on nested additions/removals and avoids inheriting internal flags from unrelated parents.

## Field Identity QA – Oct 2025
- Manual pass covers field creation, Unicode label edits, drag reordering, template regeneration, gender hide logic, tracker generation, `/tracker save`, and preset export—all succeeded with IDs remaining stable.
- `lib/fieldIdentity.js` is the single point for bridging legacy `name` fields; new code should import helpers instead of re-reading `field.id` directly so fallback logs stay centralized.
- Expect a one-time debug log when a legacy name is encountered. That is our signal to rebuild presets or reset defaults; do not strip the helper until we decide to drop name-based saves entirely.

## Preset UX – Oct 2025
- Built-in and locale defaults now hold edits in place; the dropdown shows a trailing `*` while unsaved changes exist. When the user chooses **Save**, we duplicate the preset to `(<copy suffix>)` and switch the session to that clone so the base template stays intact.
- The presets dropdown renders the active name with a trailing `*` when current settings diverge from the stored snapshot; the inline tip keeps the marker self-explanatory.
- Selecting a ❌ Backup preset no longer applies it—users get a modal with pretty-printed JSON plus a copy button instead. Any future migration tooling should hook into that same viewer rather than re-introducing partial support.

## Preset Behaviour Updates
- Presets now store tracker runtime flags (`automationTarget`, `participantTarget`, `showPopupFor`, `trackerFormat`, `devToolsEnabled`, `debugMode`, `trackerInjectionEnabled`, `toolbarIndicatorEnabled`) so loading a preset realigns both prompts and toggles.
- The settings reset button is labelled “Reset Extension Defaults” and simply reapplies `defaultSettings` while preserving connection/profile settings and custom presets; built-in templates refresh automatically on reload.
- Locale defaults are bundled as JSON snapshots (`presets/en.json`, `presets/zh-cn.json`). Initialization now requires those files; missing or invalid presets surface an error instead of silently using embedded fallbacks.
- `defaultSettings.presetAutoMode` now defaults to `true`. The preset dropdown sorts names alphabetically, prepends an **Auto (Follow SillyTavern Language)** entry, and resolves that option through SillyTavern’s live `getCurrentLocale()` with an English fallback. Locale changes and the Reset flow both reapply the resolved snapshot so prompts/UI stay aligned without manual intervention. When Auto is active, the dropdown label reflects the resolved preset name so it’s clear which locale bundle is running.
