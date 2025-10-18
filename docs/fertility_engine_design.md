# Tracker Enhanced Fertility Engine Design (Phase 1)

## Scope
- Replace legacy `FertilityCycle` and `Pregnancy` string fields with deterministic fertility state managed by the extension runtime.
- Preserve authorial control: the LLM reports events (`LastCreampie`, explicit medical notes), while the engine calculates resultant biological outcomes (`WombStats`).
- Limit feature reach to fertility state up to "labor imminent"; childbirth, offspring creation, and long-gap reconciliation remain deferred.

## Objectives & Non-Goals
- Provide a complete schema blueprint for `WombStats` (STATIC, engine-owned) and `LastCreampie` (DYNAMIC, LLM-authored) with metadata, defaults, and sample values.
- Define instructions for prompt templates, logging, deterministic algorithms, and manual validation steps that Phase 2-3 implementers can follow.
- Non-goals: writing code, updating presets/locales, implementing UI changes, or altering existing pregnancy/child-related fields beyond documenting their future removal/migration.

## Terminology
- **Engine** - Fertility computations executed inside Tracker Enhanced during tracker reconciliation/generation.
- **LLM** - SillyTavern generation backend producing narrative tracker outputs for DYNAMIC fields.
- **Cycle Day (CD)** - Day index (1-based) within the current menstrual cycle.
- **Elapsed Days** - Derived from `buildTimeAnalysis`; primary time unit for fertility math.
- **Reservoir** - Stored sperm contribution awaiting decay/conception evaluation.

## Schema Blueprint

### Removal Summary
- Deprecate DYNAMIC strings `FertilityCycle` and `Pregnancy` from `Characters` objects.
- All reproductive state migrates into `Characters[].WombStats` (STATIC) and `Characters[].LastCreampie` (DYNAMIC).
- Legacy data encountered during migration is quarantined via existing legacy registry helpers; engine writes canonical structures after first reconciliation.

### `WombStats` (STATIC, engine-owned)
- **Top-level metadata**
  - `id`: `WombStats`
  - `label`: `Womb Stats`
  - `type`: `OBJECT`
  - `presence`: `STATIC`
  - `genderSpecific`: `female`
  - `prompt`: `System filled by fertility engine. Visible in tracker UI; withheld from LLM prompts.`
  - `metadata`: `{ "internal": true, "external": true, "internalOnly": false, "internalKeyId": "wombStats" }`
  - `defaultValue`: `{ "cycleState": null, "eggStatus": null, "spermReservoir": [], "contraceptionStatus": [], "pregnancyState": null }`
  - `exampleValues`: A prettified JSON snippet showing a typical filled object (include in Phase 2 preset update).
- **Children**
  - Each child declares `internalKeyId` for deterministic engine access (pattern: `wombStats<caps>`, nested keys append camelCase segments).
  - Set `prompt` to `System filled by fertility engine. Do not modify.` unless noted.

#### `CycleState`
- `id`: `CycleState`, `label`: `Cycle State`, `type`: `OBJECT`, `presence`: `STATIC`, `internalKeyId`: `wombStatsCycleState`.
- `defaultValue`: `null`.
- `example`: `{ "phase": "follicular", "cycleDay": 9, "eggPotencyScore": 62, "nextOvulationEstimate": { "cycleDay": 14, "approxDaysUntil": 5 } }`.
- **Nested fields**
  - `phase` - enum string (`menstrual`, `follicular`, `ovulation`, `luteal`, `pregnant`, `postpartum`, `paused`). `internalKeyId`: `cycleStatePhase`. Engine guards against invalid transitions.
  - `cycleDay` - integer >=1; pinned when `phase` is `pregnant`/`postpartum`. `internalKeyId`: `cycleStateDay`.
  - `eggPotencyScore` - integer 0-100 representing ovum viability; resets per ovulation. `internalKeyId`: `cycleStateEggPotency`.
  - `nextOvulationEstimate` - object with `cycleDay` (int) and `approxDaysUntil` (float), or `null` if pregnant/paused. Container `internalKeyId`: `cycleStateNextOvulation`. Child keys: `cycleDay` -> `nextOvulationDay`, `approxDaysUntil` -> `nextOvulationDeltaDays`.

#### `EggStatus`
- `id`: `EggStatus`, `label`: `Egg Status`, `type`: `OBJECT`, `presence`: `STATIC`, `internalKeyId`: `wombStatsEggStatus`.
- Tracks current ovum attributes separate from general cycle data.
- Fields:
  - `hasMatureEgg` (boolean) - true while ovulation window remains open. `internalKeyId`: `eggStatusHasMatureEgg`.
  - `hoursSinceOvulation` (float) - `null` outside ovulation. `internalKeyId`: `eggStatusHoursSinceOvulation`.
  - `viabilityWindowHoursRemaining` (float) - counts down from deterministic base (see algorithms). `internalKeyId`: `eggStatusViabilityHoursRemaining`.
  - `notes` (string) - optional short diagnostics (e.g., `Delayed ovulation due to stress`). `internalKeyId`: `eggStatusNotes`.

#### `SpermReservoir`
- `id`: `SpermReservoir`, `label`: `Sperm Reservoir`, `type`: `ARRAY_OBJECT`, `presence`: `STATIC`, `internalKeyId`: `wombStatsSpermReservoir`.
- Array entries (latest-first) with child `internalKeyId` pattern `wombStatsSpermReservoir<Child>`.
- Entry schema:
  - `partner` (string) - name or identifier aligning with `Characters` entries; normalized in engine. `internalKeyId`: `spermReservoirPartner`.
  - `lastDepositAnchor` (ISO string) - reuse tracker `TimeAnchor` for deposit event; `null` if derived outside current chat. `internalKeyId`: `spermReservoirDepositAnchor`.
  - `volumeScore` (0-100) - deterministic scale affecting sperm count. `internalKeyId`: `spermReservoirVolumeScore`.
  - `motilityScore` (0-100) - affects decay curve. `internalKeyId`: `spermReservoirMotilityScore`.
  - `effectiveContraception` - enum: `none`, `barrier`, `hormonal`, `implant`, `magical`, `unknown`. `internalKeyId`: `spermReservoirEffectiveContraception`.
  - `decayHoursRemaining` (float) - countdown adjusted via elapsed days. `internalKeyId`: `spermReservoirDecayHours`.
  - `fertilityModifierNote` (string | null) - optional description (e.g., `Lubricant reduced motility by 20%`). `internalKeyId`: `spermReservoirModifierNote`.

#### `ContraceptionStatus`
- `id`: `ContraceptionStatus`, `label`: `Contraception Status`, `type`: `ARRAY_OBJECT`, `presence`: `STATIC`, `internalKeyId`: `wombStatsContraceptionStatus`.
- Each entry:
  - `method` - enum: `barrier`, `hormonal`, `iud`, `implant`, `surgical`, `potion`, `ritual`, `natural`, `other`. `internalKeyId`: `contraceptionMethod`.
  - `state` - enum: `active`, `expired`, `failed`, `paused`. `internalKeyId`: `contraceptionState`.
  - `appliedBy` - string (optional) actor reference. `internalKeyId`: `contraceptionAppliedBy`.
  - `effectiveUntil` - ISO string or `null`. `internalKeyId`: `contraceptionEffectiveUntil`.
  - `effectStrength` - percentage 0-100 for probability adjustments. `internalKeyId`: `contraceptionEffectStrength`.
  - `notes` - short descriptive reason. `internalKeyId`: `contraceptionNotes`.
- Engine prunes expired or redundant entries.

#### `PregnancyState`
- `id`: `PregnancyState`, `label`: `Pregnancy State`, `type`: `OBJECT`, `presence`: `STATIC`, `internalKeyId`: `wombStatsPregnancyState`.
- `defaultValue`: `null` when not pregnant.
- Fields:
  - `status` - enum: `not_pregnant`, `conceived`, `first_trimester`, `second_trimester`, `third_trimester`, `labor_imminent`, `paused`. `internalKeyId`: `pregnancyStatus`.
  - `gestationalDay` - integer >=0 (resets on conception). `internalKeyId`: `pregnancyGestationalDay`.
  - `trimester` - integer `0`-`3` (0 when not pregnant). `internalKeyId`: `pregnancyTrimester`.
  - `fetusSummary` - string (1-140 chars) describing development, symptoms, or magical traits. `internalKeyId`: `pregnancyFetusSummary`.
  - `isMultiple` - boolean; true for twins/multiples. `internalKeyId`: `pregnancyIsMultiple`.
  - `conceptionAnchor` - ISO string referencing `TimeAnchor` when conception confirmed. `internalKeyId`: `pregnancyConceptionAnchor`.
  - `primaryPartner` - string linking to `partner` labels or `unknown`. `internalKeyId`: `pregnancyPrimaryPartner`.
  - `paternityConfidence` - float 0-1 representing deterministic confidence. `internalKeyId`: `pregnancyPaternityConfidence`.
  - `laborNote` - string when `status == labor_imminent` (e.g., `Contractions 5 min apart; water broken`). `internalKeyId`: `pregnancyLaborNote`.

### `LastCreampie` (DYNAMIC, LLM-authored)
- Purpose: capture narrative ejaculation events from the most recent message so the engine can process fertile outcomes on reconciliation.
- `id`: `LastCreampie`
- `label`: `Last Creampie`
- `type`: `OBJECT`
- `presence`: `DYNAMIC`
- `genderSpecific`: `female`
- `metadata`: `{ "internal": true, "external": true, "internalOnly": false, "internalKeyId": "lastCreampie" }`
- `defaultValue`: `null`
- `exampleValue`: `{ "occurred": true, "partner": "John", "ejaculationLocation": "vaginal", "contraception": ["barrier"], "notes": "Aftercare cuddle on the couch." }`
- **Children**
  - `occurred` - boolean; defaults `false`. `internalKeyId`: `lastCreampieOccurred`. LLM must set `true` only when an internal ejaculation happened during the **Last Message**.
  - `partner` - string; primary participant providing semen. Use `"unknown"` if narration omits identity. `internalKeyId`: `lastCreampiePartner`.
  - `ejaculationLocation` - enum: `vaginal`, `anal`, `oral`, `external`, `other`. Only `vaginal` or `cervical` trigger conception rolls; `cervical` is treated as `vaginal` but gets higher potency. `internalKeyId`: `lastCreampieLocation`.
  - `contraception` - array of enums: `barrier`, `hormonal`, `pullout`, `magical`, `none`, `unknown`. Multiple entries allowed (e.g., `["barrier","spermicide"]` once additional enums introduced). `internalKeyId`: `lastCreampieContraception`.
  - `notes` - short string for contextual clues (e.g., `Condom broke`, `Spell of infertility active`). `internalKeyId`: `lastCreampieNotes`.
- **Prompt guidance**
  - Extend `generateSystemPrompt` and `generateRequestPrompt` to include explicit instructions:
    - Report creampie events strictly from the current turn's narration.
    - Use controlled vocabulary provided above.
    - Set `occurred: false` and clear other fields when no qualifying event happened.
    - Record contraception evidence even if the method prevented penetration.
    - Highlight same-turn contradictions (e.g., `Protection remained intact` implies no creampie).
  - Document that the engine clears `LastCreampie` after processing--LLM should not persist prior events.

### Field Identity Conventions
- Preserve camelCase `id` while keeping human-friendly `label`.
- Every new field and nested child requires `metadata.internalKeyId`; recommended naming: top-level `wombStats`, child segments appended in camelCase without separators (`wombStatsCycleState`, `cycleStatePhase`), and arrays adopt plural container plus singular children (e.g., `wombStatsSpermReservoir`, `spermReservoirEntry`).
- STATIC fields have prompts that clearly warn the LLM not to touch them; DYNAMIC fields keep actionable prompts.
- Maintain identical ordering between English and Chinese presets to minimize diff churn; include placeholder English notes for translators during Phase 2.

## Prompt & Template Updates
- Remove references to `FertilityCycle` and `Pregnancy` from:
  - `generateSystemPrompt`, `generateRequestPrompt`, `generateContextTemplate`, `generateRecent...` templates, and message tracker HTML.
  - Replace with instructions telling the LLM to populate `LastCreampie` and any narrative pregnancy observations (e.g., medical diagnosis) as free-form text in other existing fields like `StoryEvents`.
- Introduce a dedicated **Fertility Engine** block in the prompts:
  - Outline the engine responsibilities vs LLM responsibilities.
  - Provide the controlled vocabulary enumerations.
  - Emphasize that STATIC fertility metrics are computed post-generation and should not be guessed by the LLM.
- Update tooltip/preview templates to surface `WombStats` summaries (Phase 2) using read-only badges or collapsed panels.

## Responsibility Split

### LLM Duties
- Populate `LastCreampie`.
- Narrate contraception use/failures and pregnancy symptoms in narrative fields.
- Refrain from editing STATIC fertility data.
- Respect gender; avoid assigning creampie events to non-female targets.

### Engine Duties
- Interpret `LastCreampie` each reconciliation cycle.
- Advance menstrual cycles using `ElapsedDays`.
- Maintain sperm reservoirs, contraception modifiers, and conceive probability calculations.
- Transition pregnancy states, including trimester, fetus summaries, and labor imminent flag.
- Reset `LastCreampie` after processing.
- Detect invalid configurations (missing anchors, gender mismatches) and emit debug warnings without crashing.

### Error Handling
- Missing `TimeAnchor` / zero `ElapsedDays`: skip advancement, log `[tracker-enhanced][fertility] skip (missing time anchor)` with context.
- Regressed anchors (negative elapsed): freeze cycle, log warning, and mark `CycleState.phase = "paused"` until time moves forward again.
- Gender mismatch: if `LastCreampie.occurred` on a non-female character, ignore event, log warning, and annotate `LastCreampie.notes` (`ignored_non_female`) before clearing.

## Algorithm Outline

### Cycle Advancement
- Default cycle length 28 days with deterministic per-character offset: `baseLength = 28 + characterSeed % 3 - 1` (range 27-29).
- `ElapsedDays` increments `cycleDay`; fractional days accumulate, advancement occurs once >=1.0 day elapsed.
- Phase boundaries:
  - `menstrual`: days 1-5
  - `follicular`: days 6-13
  - `ovulation`: day 14 (+/- deterministic shift using same seed)
  - `luteal`: remainder until reset
- When pregnant, set `phase = "pregnant"` and hold `cycleDay` constant.
- Postpartum cooldown: upon pregnancy reset, run `phase = "postpartum"` for configurable 7 days before returning to day 1.

### Egg Potency
- On entering ovulation, roll deterministic base potency (70-95) with slight adjustments:
  - Modify by +5 if cycle shorter than 28, -5 if longer.
  - Multiply by `(1 - stressPenalty)` where stress derived from narrative hints (Phase 3 heuristics).
- `EggStatus.viabilityWindowHoursRemaining` starts at 24; tick down via elapsed time.
- When viability expires, set `hasMatureEgg = false` and resume luteal progression.

### Sperm Reservoir
- Add new entry per creampie event with:
  - `volumeScore = clamp(baseVolume + bonusFromNotes, 10, 100)`.
  - `motilityScore` adjusted by contraception or narrative cues.
- Decay per elapsed hour: `decayRate = base (12h half-life) * barrierPenalty * hormonalPenalty`.
- Remove entries when `decayHoursRemaining <= 0`.
- Combine multiple deposits from same partner within 24h by averaging motility and summing volume.

### Contraception Modifiers
- Map `LastCreampie.contraception` tokens:
  - `barrier`: -60% conception chance, +40% faster sperm decay.
  - `hormonal`: -80% conception chance, ovulation suppressed (engine may shift cycle to `paused` or extend follicular phase).
  - `pullout`: -25% conception chance but still create reservoir with reduced volume.
  - `magical`: effect defined via notes; default -70%.
  - `none` / `unknown`: no reduction.
- Engine cross-references ongoing `ContraceptionStatus`; active hormonal methods suppress ovulation (phase remains follicular). When `state == failed`, remove reduction next turn and note failure in logs/UI.

### Conception Probability
- Base per-phase conception odds (before modifiers):
  - `menstrual`: 0%
  - `follicular`: linear ramp 5-20% (scaled by egg potency and days until ovulation)
  - `ovulation`: 45% + `(eggPotencyScore / 2)%` (capped 95%)
  - `luteal`: decay from 15% to 2% as days progress
- Multiply by:
  - Reservoir potency factor `(volumeScore / 100) * (motilityScore / 100)`.
  - Contraception reductions (product of active modifiers, minimum floor of 0%).
  - Bonus for `ejaculationLocation == cervical`: +10 percentage points before capping.
- If multiple reservoirs exist simultaneously, evaluate highest probability then apply diminishing returns for each additional partner (`prob *= 0.5`). Track candidate partner for paternity confidence.
- Twin determination: once conception succeeds, roll deterministic chance derived from `eggPotencyScore` (base 3%, +2% if multiple high-volume reservoirs, +5% if narrative notes specify fertility treatments). Set `isMultiple` accordingly.

### Pregnancy Progression
- Advance `gestationalDay` by elapsed days; clamp to 0 if negative delta.
- Trimester thresholds: 0-90, 91-180, 181-270. Switch `status` accordingly.
- `labor_imminent` triggered when `gestationalDay >= 260` and at least one narrative cue (notes or StoryEvents) indicates contractions, water break, or due date. Engine sets `laborNote` and stops conception logic.
- Fetus summary generation: deterministic template combining trimester, symptoms, and multiples (Phase 3 will define snippet builder). Should remain <=140 chars.
- Upon labor resolution (future phase), `status` transitions handled later; for now engine leaves `labor_imminent` untouched until manual intervention.

### Edge Cases
- Time jumps >60 days: engine loops day-by-day to ensure cycle transitions occur sequentially; pregnancy `gestationalDay` increments by total days immediately.
- Missing `LastCreampie` fields: treat missing `contraception` as `["unknown"]`. If partner missing, set `"unknown"` and reduce paternity confidence to 0.5.
- Characters flagged as male/non-binary: skip fertility engine entirely unless `genderSpecific` overrides changed; log debug once per character per session.

## Logging Expectations
- Prefix logs with `[tracker-enhanced][fertility]`.
- Required entries:
  - `Cycle advance` - include old/new day, phase, elapsed days.
  - `Reservoir updated` - include partner, new decay hours, contraception applied.
  - `Conception roll` - log probability breakdown, random seed, result.
  - `Pregnancy state change` - include previous status, new status, gestational day.
  - `Warning` - invalid inputs (gender mismatch, missing anchor, corrupted schema).
- Avoid verbose spam: collapse unchanged cycles into a heartbeat log once per 24h jump.

## Manual Testing Plan
- **Baseline idle** - progress chat multiple turns with no creampie events; verify cycle day increments using `ElapsedDays`.
- **Protected encounter** - apply `barrier` contraception, ensure reservoir decays rapidly and conception probability logs reflect reduction.
- **High fertility conception** - set cycle to ovulation, create high-potency reservoir without contraception; confirm pregnancy enters `conceived` then `first_trimester` after time passes.
- **Contraception failure** - mark `ContraceptionStatus` as `failed`; confirm engine removes reduction next turn and logs warning.
- **Twin outcome** - simulate multi-partner deposits to trigger `isMultiple = true`.
- **Labor imminent** - advance gestational day to threshold, add narrative cues, confirm status switches and engine stops additional conception processing.
- **Missing anchor regression** - feed decreasing or null `TimeAnchor` to confirm cycle pauses and warnings appear.

## Dependencies, Migration & Localization
- Presets (`en.json`, `zh-cn.json`) require synchronized structure change, prompt updates, and template adjustments.
- UI preview (`mesTrackerTemplate`, settings modal) must adopt read-only presentation for `WombStats`.
- Locale bundles need translation-ready keys for new labels and tooltip text; maintain ordering parity.
- Legacy data migration: hook into `lib/legacyRegistry` to quarantine old fertility strings and surface notification toast prompting users to reload tracker data.
- Documentation updates: README fertility section, `docs/locale_guide.md` append instructions for new keys, AGENTS.md note summarizing engine addition.

## Risk Assessment
- **Schema drift** - Mitigate by enforcing centralized `internalKeyId` constants and schema validation in Phase 3.
- **User confusion** - Provide clear UI copy that fertility data is system-managed and read-only.
- **Localization gaps** - Early translator brief with canonical key order reduces regressions.
- **Time discontinuities** - Document fallback to `paused` state when anchors regress to avoid inconsistent pregnancies.

## Phase 2 Checklist (Schema & Prompt Implementation)
- [ ] Update presets (`en`, `zh-cn`) to remove legacy fields, add `WombStats`, `LastCreampie`, and adjust templates/prompts.
- [ ] Add example/default JSON snippets in presets per structure above.
- [ ] Refresh localization keys and settings strings referencing fertility fields.
- [ ] Include translation TODO comments for Chinese copy.
- [ ] Adjust tracker UI templates to surface read-only fertility summaries.

## Phase 3 Checklist (Engine Implementation)
- [ ] Implement fertility engine module populating `WombStats` using deterministic algorithms.
- [ ] Integrate engine into tracker reconciliation flow (`trackerDataHandler`, `generation`).
- [ ] Wire logs through existing debug helpers with `[fertility]` prefix.
- [ ] Reset `LastCreampie` post-processing and ensure schema sanitation.
- [ ] Add migration handling for legacy fertility strings via `legacyRegistry`.
- [ ] Validate interplay with `TimeAnchor` and `ElapsedDays` calculations.

## Open Questions
- Should hormonal contraception fully prevent ovulation (`phase = paused`) or merely reduce potency? Decision affects narrative flexibility.
- Do we require manual overrides for non-standard reproductive biology (e.g., fantasy species)? Possibly Phase 4 documentation addition.
- How should engine behave if multiple creampies occur in one message involving different targets? Candidate approach: LLM splits per character; confirm with story team.

## Deferred Work
- Birth resolution and child record generation (`Children`, `StoryEvents.BirthEvents`) remain future scope; design assumes manual follow-up.
- Extreme time skips (>1 year) leading to retroactive child aging need dedicated reconciliation module.
- Integration with planned genetics system (if any) postponed; keep `fetusSummary` generic.
