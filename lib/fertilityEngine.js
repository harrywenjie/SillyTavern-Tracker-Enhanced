import { extensionSettings } from "../index.js";
import { debug, warn } from "./utils.js";

const INTERNAL_KEYS = Object.freeze({
	CHARACTERS: "characters",
	CHARACTER_GENDER: "characterGender",
	WOMB_STATS: "wombStats",
	CYCLE_STATE: "wombStatsCycleState",
	CYCLE_PHASE: "cycleStatePhase",
	CYCLE_DAY: "cycleStateDay",
	CYCLE_EGG_POTENCY: "cycleStateEggPotency",
	CYCLE_NEXT_OVULATION: "cycleStateNextOvulation",
	NEXT_OVULATION_DAY: "nextOvulationDay",
	NEXT_OVULATION_DELTA: "nextOvulationDeltaDays",
	EGG_STATUS: "wombStatsEggStatus",
	EGG_HAS_MATURE: "eggStatusHasMatureEgg",
	EGG_HOURS_SINCE: "eggStatusHoursSinceOvulation",
	EGG_VIABILITY: "eggStatusViabilityHoursRemaining",
	EGG_NOTES: "eggStatusNotes",
	SPERM_RESERVOIR: "wombStatsSpermReservoir",
	SPERM_PARTNER: "spermReservoirPartner",
	SPERM_VOLUME: "spermReservoirVolumeScore",
	SPERM_MOTILITY: "spermReservoirMotilityScore",
	SPERM_DECAY: "spermReservoirDecayHours",
	SPERM_ANCHOR: "spermReservoirDepositAnchor",
	SPERM_EFFECTIVE: "spermReservoirEffectiveContraception",
	SPERM_NOTE: "spermReservoirModifierNote",
	CONTRACEPTION_STATUS: "wombStatsContraceptionStatus",
	CONTRACEPTION_METHOD: "contraceptionMethod",
	CONTRACEPTION_STATE: "contraceptionState",
	CONTRACEPTION_EFFECT: "contraceptionEffectStrength",
	CONTRACEPTION_NOTES: "contraceptionNotes",
	CONTRACEPTION_APPLIED_BY: "contraceptionAppliedBy",
	CONTRACEPTION_UNTIL: "contraceptionEffectiveUntil",
	PREGNANCY_STATE: "wombStatsPregnancyState",
	PREGNANCY_STATUS: "pregnancyStatus",
	PREGNANCY_GESTATIONAL: "pregnancyGestationalDay",
	PREGNANCY_TRIMESTER: "pregnancyTrimester",
	PREGNANCY_SUMMARY: "pregnancyFetusSummary",
	PREGNANCY_MULTIPLE: "pregnancyIsMultiple",
	PREGNANCY_CONCEPTION_ANCHOR: "pregnancyConceptionAnchor",
	PREGNANCY_PRIMARY_PARTNER: "pregnancyPrimaryPartner",
	PREGNANCY_PATERNITY: "pregnancyPaternityConfidence",
	PREGNANCY_LABOR_NOTE: "pregnancyLaborNote",
	EJACULATION_EVENT: "ejaculationEvent",
	EJACULATION_EVENT_OCCURRED: "ejaculationEventOccurred",
	EJACULATION_EVENT_PARTNER: "ejaculationEventPartner",
	EJACULATION_EVENT_LOCATION: "ejaculationEventLocation",
	EJACULATION_EVENT_CONTRACEPTION: "ejaculationEventContraception",
	EJACULATION_EVENT_NOTES: "ejaculationEventNotes",
	LAST_CUM_RECEIVED: "lastCumReceived",
});

const ENGINE_VERSION = 1;
const HOURS_PER_DAY = 24;
const DEFAULT_OVULATION_WINDOW_HOURS = 24;
const DEFAULT_SPERM_DECAY_HOURS = 60;
const MAX_EGG_POTENCY = 100;
const LOCATION_BONUS = {
	cervical: 0.1,
	vaginal: 0.05,
};

let cachedSchemaRef = null;
let cachedIndex = null;
let lastDiagnostics = null;

export function runFertilityEngine(options) {
	const schema = extensionSettings?.trackerDef;
	if (!schema || typeof schema !== "object") {
		return { tracker: options?.tracker ?? null, internalData: options?.currentInternal ?? null };
	}

	const index = ensureSchemaIndex(schema);
	if (!index) {
		return { tracker: options?.tracker ?? null, internalData: options?.currentInternal ?? null };
	}

	const tracker = cloneIfObject(options?.tracker);
	if (!tracker || typeof tracker !== "object") {
		return { tracker: options?.tracker ?? null, internalData: options?.currentInternal ?? null };
	}

	const previousTracker = options?.previousTracker && typeof options.previousTracker === "object"
		? cloneIfObject(options.previousTracker)
		: null;
	const currentInternal = ensureInternalCollector(options?.currentInternal);
	const previousInternal = options?.previousInternal && typeof options.previousInternal === "object"
		? options.previousInternal
		: null;
	const timeAnalysis = normalizeTimeAnalysis(options?.timeAnalysis ?? currentInternal.TimeAnalysis ?? null);
	const fallbackAnalysis = normalizeTimeAnalysis(previousInternal?.TimeAnalysis ?? options?.previousTimeAnalysis ?? null);
	const anchor = ensureAnchor(options?.timeAnchor ?? currentInternal.TimeAnchor ?? previousInternal?.TimeAnchor ?? null);

	const elapsed = resolveElapsed(timeAnalysis, fallbackAnalysis);

	const internalState = buildInternalState(currentInternal?.FertilityEngine, previousInternal?.FertilityEngine);

	const characters = getNode(tracker, index.charactersFieldId);
	if (!characters || typeof characters !== "object") {
		return { tracker, internalData: currentInternal };
	}

	const previousCharacters = previousTracker && typeof previousTracker === "object"
		? getNode(previousTracker, index.charactersFieldId)
		: null;

	const diagnostics = { version: ENGINE_VERSION, anchor, elapsedDays: elapsed.days, characters: {} };
	const characterNames = Object.keys(characters);
	for (const name of characterNames) {
		const node = characters[name];
		if (!node || typeof node !== "object") {
			continue;
		}
		const previousNode = previousCharacters && typeof previousCharacters === "object" ? previousCharacters[name] : null;
		const result = processCharacter({
			anchor,
			elapsed,
			index,
			internalState,
			characterName: name,
			characterNode: node,
			previousCharacterNode: previousNode,
	});
		if (result) {
			diagnostics.characters[name] = result.diagnostics;
		}
	}

	currentInternal.FertilityEngine = internalState;
	if (timeAnalysis?.raw) {
		currentInternal.TimeAnalysis = timeAnalysis.raw;
	}
	if (anchor) {
		currentInternal.TimeAnchor = anchor;
	}

	lastDiagnostics = diagnostics;
	return { tracker, internalData: currentInternal };
}

export function getFertilityDiagnostics() {
	return lastDiagnostics ? JSON.parse(JSON.stringify(lastDiagnostics)) : null;
}

function ensureSchemaIndex(schema) {
	if (schema === cachedSchemaRef && cachedIndex) {
		return cachedIndex;
	}
	const index = buildSchemaIndex(schema);
	if (!index) {
		return null;
	}
	cachedSchemaRef = schema;
	cachedIndex = index;
	return cachedIndex;
}

function buildSchemaIndex(schema) {
	const pathMap = new Map();
	traverseSchema(schema, [], pathMap);
	const missingKeys = [];
	const pick = (key) => {
		const path = pathMap.get(key);
		if (!path || path.length === 0) {
			missingKeys.push(key);
			return null;
		}
		return path[path.length - 1];
	};
	const index = {
		charactersFieldId: pick(INTERNAL_KEYS.CHARACTERS),
		genderFieldId: pick(INTERNAL_KEYS.CHARACTER_GENDER),
		wombStatsFieldId: pick(INTERNAL_KEYS.WOMB_STATS),
		cycleStateFieldId: pick(INTERNAL_KEYS.CYCLE_STATE),
		cyclePhaseFieldId: pick(INTERNAL_KEYS.CYCLE_PHASE),
		cycleDayFieldId: pick(INTERNAL_KEYS.CYCLE_DAY),
		cycleEggPotencyFieldId: pick(INTERNAL_KEYS.CYCLE_EGG_POTENCY),
		nextOvulationFieldId: pick(INTERNAL_KEYS.CYCLE_NEXT_OVULATION),
		nextOvulationDayFieldId: pick(INTERNAL_KEYS.NEXT_OVULATION_DAY),
		nextOvulationDeltaFieldId: pick(INTERNAL_KEYS.NEXT_OVULATION_DELTA),
		eggStatusFieldId: pick(INTERNAL_KEYS.EGG_STATUS),
		eggHasMatureFieldId: pick(INTERNAL_KEYS.EGG_HAS_MATURE),
		eggHoursFieldId: pick(INTERNAL_KEYS.EGG_HOURS_SINCE),
		eggViabilityFieldId: pick(INTERNAL_KEYS.EGG_VIABILITY),
		eggNotesFieldId: pick(INTERNAL_KEYS.EGG_NOTES),
		spermReservoirFieldId: pick(INTERNAL_KEYS.SPERM_RESERVOIR),
		spermPartnerFieldId: pick(INTERNAL_KEYS.SPERM_PARTNER),
		spermVolumeFieldId: pick(INTERNAL_KEYS.SPERM_VOLUME),
		spermMotilityFieldId: pick(INTERNAL_KEYS.SPERM_MOTILITY),
		spermDecayFieldId: pick(INTERNAL_KEYS.SPERM_DECAY),
		spermAnchorFieldId: pick(INTERNAL_KEYS.SPERM_ANCHOR),
		spermEffectiveFieldId: pick(INTERNAL_KEYS.SPERM_EFFECTIVE),
		spermNoteFieldId: pick(INTERNAL_KEYS.SPERM_NOTE),
		contraceptionFieldId: pick(INTERNAL_KEYS.CONTRACEPTION_STATUS),
		contraceptionMethodFieldId: pick(INTERNAL_KEYS.CONTRACEPTION_METHOD),
		contraceptionStateFieldId: pick(INTERNAL_KEYS.CONTRACEPTION_STATE),
		contraceptionEffectFieldId: pick(INTERNAL_KEYS.CONTRACEPTION_EFFECT),
		contraceptionNotesFieldId: pick(INTERNAL_KEYS.CONTRACEPTION_NOTES),
		contraceptionAppliedByFieldId: pick(INTERNAL_KEYS.CONTRACEPTION_APPLIED_BY),
		contraceptionUntilFieldId: pick(INTERNAL_KEYS.CONTRACEPTION_UNTIL),
		pregnancyFieldId: pick(INTERNAL_KEYS.PREGNANCY_STATE),
		pregnancyStatusFieldId: pick(INTERNAL_KEYS.PREGNANCY_STATUS),
		pregnancyGestationalFieldId: pick(INTERNAL_KEYS.PREGNANCY_GESTATIONAL),
		pregnancyTrimesterFieldId: pick(INTERNAL_KEYS.PREGNANCY_TRIMESTER),
		pregnancySummaryFieldId: pick(INTERNAL_KEYS.PREGNANCY_SUMMARY),
		pregnancyMultipleFieldId: pick(INTERNAL_KEYS.PREGNANCY_MULTIPLE),
		pregnancyAnchorFieldId: pick(INTERNAL_KEYS.PREGNANCY_CONCEPTION_ANCHOR),
		pregnancyPartnerFieldId: pick(INTERNAL_KEYS.PREGNANCY_PRIMARY_PARTNER),
		pregnancyPaternityFieldId: pick(INTERNAL_KEYS.PREGNANCY_PATERNITY),
		pregnancyLaborNoteFieldId: pick(INTERNAL_KEYS.PREGNANCY_LABOR_NOTE),
		ejaculationEventFieldId: pick(INTERNAL_KEYS.EJACULATION_EVENT),
		ejaculationOccurredFieldId: pick(INTERNAL_KEYS.EJACULATION_EVENT_OCCURRED),
		ejaculationPartnerFieldId: pick(INTERNAL_KEYS.EJACULATION_EVENT_PARTNER),
		ejaculationLocationFieldId: pick(INTERNAL_KEYS.EJACULATION_EVENT_LOCATION),
		ejaculationContraceptionFieldId: pick(INTERNAL_KEYS.EJACULATION_EVENT_CONTRACEPTION),
		ejaculationNotesFieldId: pick(INTERNAL_KEYS.EJACULATION_EVENT_NOTES),
		lastCumReceivedFieldId: pick(INTERNAL_KEYS.LAST_CUM_RECEIVED),
	};

	const missing = missingKeys.filter(Boolean);
	if (missing.length > 0) {
		warn("[tracker-enhanced][fertility] Missing internalKeyId mappings", { missing });
		return null;
	}

	return index;
}

function traverseSchema(node, path, collector) {
	if (!node || typeof node !== "object") {
		return;
	}
	for (const field of Object.values(node)) {
		if (!field || typeof field !== "object") {
			continue;
		}
		const fieldId = typeof field.id === "string" ? field.id : null;
		const nextPath = fieldId ? [...path, fieldId] : path;
		const metadata = field.metadata || {};
		if (metadata.internalKeyId) {
			collector.set(metadata.internalKeyId, nextPath);
		}
		traverseSchema(field.nestedFields || {}, nextPath, collector);
	}
}

function ensureInternalCollector(currentInternal) {
	if (!currentInternal || typeof currentInternal !== "object") {
		return {};
	}
	return currentInternal;
}

function ensureAnchor(anchor) {
	if (!anchor || typeof anchor !== "string") {
		return null;
	}
	const trimmed = anchor.trim();
	return trimmed || null;
}

function normalizeTimeAnalysis(raw) {
	if (!raw || typeof raw !== "object") {
		return null;
	}
	const days = parseFloat(raw.ElapsedDays ?? raw.elapsedDays ?? "0");
	const seconds = parseFloat(raw.ElapsedSeconds ?? raw.elapsedSeconds ?? "0");
	return {
		days: Number.isFinite(days) ? days : 0,
		seconds: Number.isFinite(seconds) ? seconds : Math.max(0, (Number.isFinite(days) ? days : 0) * 86400),
		raw,
	};
}

function resolveElapsed(current, fallback) {
	if (current && Number.isFinite(current.days)) {
		return current;
	}
	return fallback || { days: 0, seconds: 0 };
}

function cloneIfObject(value) {
	if (!value || typeof value !== "object") {
		return value;
	}
	try {
		return JSON.parse(JSON.stringify(value));
	} catch (_err) {
		return value;
	}
}

function getNode(parent, fieldId) {
	if (!parent || typeof parent !== "object") {
		return null;
	}
	if (!fieldId || !Object.prototype.hasOwnProperty.call(parent, fieldId)) {
		return null;
	}
	return parent[fieldId];
}

function processCharacter(context) {
	const {
		anchor,
		elapsed,
		index,
		internalState,
		characterName,
		characterNode,
		previousCharacterNode,
	} = context;

	const genderValue = extractString(getNode(characterNode, index.genderFieldId));
	const isFemale = checkFemaleEligibility(genderValue);
	const diagnostics = { eligible: isFemale, gender: genderValue, actions: [] };

	if (!isFemale) {
		characterNode[index.wombStatsFieldId] = null;
		if (index.ejaculationEventFieldId) {
			characterNode[index.ejaculationEventFieldId] = null;
		}
		if (index.lastCumReceivedFieldId && Object.prototype.hasOwnProperty.call(characterNode, index.lastCumReceivedFieldId)) {
			characterNode[index.lastCumReceivedFieldId] = "";
		}
		purgeInternalCharacter(internalState, characterName);
		return { diagnostics };
	}

	const previousStateNode = previousCharacterNode && typeof previousCharacterNode === "object" ? previousCharacterNode : null;
	const engineState = ensureCharacterState(internalState, characterName);

	const wombStats = buildBaseWombStats(characterNode[index.wombStatsFieldId]);
	const previousWombStats = buildBaseWombStats(previousStateNode ? previousStateNode[index.wombStatsFieldId] : null);

	const contraceptionSnapshot = collectContraceptionStatus(characterNode[index.contraceptionFieldId], index);
	const ejaculationEvent = normalizeEjaculationEvent(characterNode[index.ejaculationEventFieldId], index);
	const elapsedDays = Number.isFinite(elapsed.days) ? elapsed.days : 0;
	const elapsedHours = Math.max(0, Number.isFinite(elapsed.seconds) ? elapsed.seconds / 3600 : elapsedDays * HOURS_PER_DAY);

	const cycleOutcome = advanceCycle({
		anchor,
		characterName,
		engineState,
		wombStats,
		previousWombStats,
		elapsedDays,
		elapsedHours,
		contraceptionSnapshot,
		diagnostics,
	});

	const reservoirOutcome = reconcileReservoirs({
		anchor,
		engineState,
		wombStats,
		ejaculationEvent,
		elapsedHours,
		diagnostics,
	});

	const conceptionOutcome = evaluateConception({
		anchor,
		characterName,
		engineState,
		wombStats,
		cycleOutcome,
		reservoirOutcome,
		contraceptionSnapshot,
		ejaculationEvent,
		diagnostics,
	});

	updatePregnancy({
		anchor,
		engineState,
		wombStats,
		elapsedDays,
		elapsedHours,
		conceptionOutcome,
		diagnostics,
	});

	characterNode[index.wombStatsFieldId] = finalizeWombStats(wombStats);
	if (index.ejaculationEventFieldId) {
		characterNode[index.ejaculationEventFieldId] = null;
	}

	return { diagnostics };
}

function purgeInternalCharacter(internalState, characterName) {
	if (!internalState?.characters || typeof internalState.characters !== "object") {
		return;
	}
	delete internalState.characters[characterName];
}

function ensureCharacterState(internalState, characterName) {
	if (!internalState.characters || typeof internalState.characters !== "object") {
		internalState.characters = {};
	}
	if (!internalState.characters[characterName] || typeof internalState.characters[characterName] !== "object") {
		internalState.characters[characterName] = createDefaultCharacterState(characterName);
	}
	return internalState.characters[characterName];
}

function createDefaultCharacterState(name) {
	const seed = hashString(name || "character");
	const baseCycleLength = 27 + (seed % 3);
	const ovulationShift = ((seed >>> 3) % 3) - 1;
	const ovulationDay = clamp(14 + ovulationShift, 12, baseCycleLength - 2);
	const initialDay = (Math.floor(seed / 97) % baseCycleLength) + 1;
	return {
		version: ENGINE_VERSION,
		seed,
		cycle: {
			baseLength: baseCycleLength,
			ovulationDay,
			dayFloat: Math.max(0, initialDay - 1),
			paused: false,
			hormonalSuppressed: false,
			postpartumDays: 0,
			lastPhase: "menstrual",
			eggWindowHours: 0,
			eggHoursSince: 0,
		},
		pregnancy: null,
		spermReservoirs: [],
	};
}

function buildInternalState(currentState, previousState) {
	const base = currentState && typeof currentState === "object" ? cloneIfObject(currentState) : null;
	if (base && base.version === ENGINE_VERSION) {
		return base;
	}
	if (previousState && typeof previousState === "object" && previousState.version === ENGINE_VERSION) {
		return cloneIfObject(previousState);
	}
	return { version: ENGINE_VERSION, characters: {} };
}

function buildBaseWombStats(raw) {
	const wombStats = raw && typeof raw === "object" ? cloneIfObject(raw) : {};
	wombStats.CycleState = wombStats.CycleState && typeof wombStats.CycleState === "object" ? cloneIfObject(wombStats.CycleState) : {};
	wombStats.EggStatus = wombStats.EggStatus && typeof wombStats.EggStatus === "object" ? cloneIfObject(wombStats.EggStatus) : {};
	wombStats.SpermReservoir = Array.isArray(wombStats.SpermReservoir) ? wombStats.SpermReservoir.map(cloneIfObject) : [];
	wombStats.ContraceptionStatus = Array.isArray(wombStats.ContraceptionStatus) ? wombStats.ContraceptionStatus.map(cloneIfObject) : [];
	wombStats.PregnancyState = wombStats.PregnancyState && typeof wombStats.PregnancyState === "object" ? cloneIfObject(wombStats.PregnancyState) : null;
	return wombStats;
}

function buildCycleSnapshot(wombStats) {
	const cycle = wombStats?.CycleState || {};
	return {
		phase: extractString(cycle.phase) || "menstrual",
		day: parseIntSafe(cycle.cycleDay, 1),
		eggPotency: parseIntSafe(cycle.eggPotencyScore, 0),
		nextOvulation: cycle.nextOvulationEstimate && typeof cycle.nextOvulationEstimate === "object"
			? {
				cycleDay: parseIntSafe(cycle.nextOvulationEstimate.cycleDay, null),
				approxDaysUntil: parseFloatSafe(cycle.nextOvulationEstimate.approxDaysUntil, null),
			}
			: { cycleDay: null, approxDaysUntil: null },
	};
}

function normalizeEjaculationEvent(raw, index) {
	if (!raw || typeof raw !== "object") {
		return null;
	}
	const occurredRaw = getNode(raw, index.ejaculationOccurredFieldId);
	const occurred = typeof occurredRaw === "string" ? occurredRaw.trim().toLowerCase() === "true" : Boolean(occurredRaw);
	if (!occurred) {
		return null;
	}
	const partner = extractString(getNode(raw, index.ejaculationPartnerFieldId)) || "unknown";
	const location = (extractString(getNode(raw, index.ejaculationLocationFieldId)) || "vaginal").toLowerCase();
	let contraception = getNode(raw, index.ejaculationContraceptionFieldId);
	if (Array.isArray(contraception)) {
		contraception = contraception.map((entry) => (typeof entry === "string" ? entry.trim().toLowerCase() : "")).filter(Boolean);
	} else if (typeof contraception === "string" && contraception.trim()) {
		contraception = contraception
			.split(/[,|]/)
			.map((entry) => entry.trim().toLowerCase())
			.filter(Boolean);
	} else {
		contraception = [];
	}
	const notes = extractString(getNode(raw, index.ejaculationNotesFieldId)) || "";
	return { partner, location, contraception, notes };
}

function collectContraceptionStatus(raw, index) {
	const entries = Array.isArray(raw) ? raw : [];
	const normalized = [];
	for (const entry of entries) {
		if (!entry || typeof entry !== "object") {
			continue;
		}
		normalized.push({
			method: extractString(entry[index.contraceptionMethodFieldId])?.toLowerCase() || "",
			state: extractString(entry[index.contraceptionStateFieldId])?.toLowerCase() || "",
			effectStrength: parseFloatSafe(entry[index.contraceptionEffectFieldId], null),
			notes: extractString(entry[index.contraceptionNotesFieldId]) || "",
			effectiveUntil: extractString(entry[index.contraceptionUntilFieldId]) || "",
			appliedBy: extractString(entry[index.contraceptionAppliedByFieldId]) || "",
		});
	}
	return normalized;
}

function advanceCycle(options) {
	const {
		anchor,
		characterName,
		engineState,
		wombStats,
		previousWombStats,
		elapsedDays,
		elapsedHours,
		contraceptionSnapshot,
		diagnostics,
	} = options;

	const cycleState = engineState.cycle || createDefaultCharacterState(characterName).cycle;
	engineState.cycle = cycleState;

	if (!Number.isFinite(cycleState.dayFloat)) {
		const snapshot = buildCycleSnapshot(previousWombStats);
		if (Number.isFinite(snapshot.day)) {
			cycleState.dayFloat = Math.max(0, snapshot.day - 1);
		} else {
			cycleState.dayFloat = Math.max(0, cycleState.dayFloat || 0);
		}
	}

	const hormonalActive = contraceptionSnapshot.some((entry) => entry.method.includes("hormonal") && entry.state === "active");
	const hormonalFailed = contraceptionSnapshot.some((entry) => entry.method.includes("hormonal") && entry.state === "failed");
	const barrierActive = contraceptionSnapshot.some((entry) => entry.method.includes("barrier") && entry.state === "active");

	const wasPaused = cycleState.paused;
	if (elapsedDays < 0) {
		cycleState.paused = true;
		if (!wasPaused) {
			diagnostics.actions.push({ type: "cycle_paused", reason: "time_regression" });
		}
	} else if (cycleState.paused && elapsedDays > 0) {
		cycleState.paused = false;
		diagnostics.actions.push({ type: "cycle_resumed" });
	}

	cycleState.hormonalSuppressed = hormonalActive;

	const baseLength = Math.max(24, cycleState.baseLength || 28);
	const ovulationDay = clamp(cycleState.ovulationDay || 14, 10, baseLength - 2);

	let phase = "menstrual";
	let eggPotency = 0;
	let nextOvulationEstimate = { cycleDay: ovulationDay, approxDaysUntil: null };

	if (!cycleState.paused && !(engineState.pregnancy?.active)) {
		cycleState.dayFloat = Math.max(0, cycleState.dayFloat + Math.max(0, elapsedDays));
		while (cycleState.dayFloat >= baseLength) {
			cycleState.dayFloat -= baseLength;
		}

		const cycleDay = Math.floor(cycleState.dayFloat) + 1;
		if (cycleDay <= 5) {
			phase = "menstrual";
			eggPotency = Math.round((cycleDay / 5) * 12);
			nextOvulationEstimate.approxDaysUntil = parseFloat((ovulationDay - cycleDay).toFixed(1));
		} else if (cycleDay < ovulationDay) {
			phase = "follicular";
			const progress = (cycleDay - 5) / Math.max(1, ovulationDay - 5);
			eggPotency = clamp(Math.round(15 + progress * 50), 15, 65);
			nextOvulationEstimate.approxDaysUntil = parseFloat((ovulationDay - cycleDay).toFixed(1));
		} else if (cycleDay === ovulationDay || cycleDay === ovulationDay + 1) {
			phase = "ovulation";
			const potencyBase = 70 + ((engineState.seed >>> 5) % 26);
			eggPotency = clamp(potencyBase, 55, 95);
			nextOvulationEstimate.approxDaysUntil = 0;
			if (cycleState.lastPhase !== "ovulation" || !Number.isFinite(cycleState.eggWindowHours) || cycleState.eggWindowHours <= 0) {
				cycleState.eggWindowHours = DEFAULT_OVULATION_WINDOW_HOURS;
				cycleState.eggHoursSince = 0;
			} else {
				cycleState.eggWindowHours = Math.max(0, cycleState.eggWindowHours - elapsedHours);
				cycleState.eggHoursSince += elapsedHours;
			}
		} else {
			phase = "luteal";
			const lutealProgress = (cycleDay - ovulationDay) / Math.max(1, baseLength - ovulationDay);
			eggPotency = clamp(Math.round(35 - lutealProgress * 30), 0, 45);
			nextOvulationEstimate.approxDaysUntil = parseFloat((baseLength - cycleDay + ovulationDay).toFixed(1));
			cycleState.eggWindowHours = Math.max(0, cycleState.eggWindowHours - elapsedHours);
			cycleState.eggHoursSince += elapsedHours;
		}
	} else if (engineState.pregnancy?.active) {
		phase = "pregnant";
		cycleState.eggWindowHours = 0;
		cycleState.eggHoursSince = 0;
	} else {
		phase = "paused";
	}

	if (hormonalActive) {
		phase = "paused";
		eggPotency = Math.round(eggPotency * 0.25);
	}

	if (barrierActive) {
		diagnostics.actions.push({ type: "contraception_barrier_active" });
	}
	if (hormonalFailed) {
		diagnostics.actions.push({ type: "contraception_failure", method: "hormonal" });
	}

	const cycleDayOutput = Math.floor(cycleState.dayFloat) + 1;
	const hasMatureEgg = phase === "ovulation" && (cycleState.eggWindowHours ?? 0) > 0 && eggPotency > 60;
	const eggStatusNotes = hormonalActive ? "Hormonal suppression dampening fertility." : "";

	wombStats.CycleState.phase = phase;
	wombStats.CycleState.cycleDay = cycleDayOutput;
	wombStats.CycleState.eggPotencyScore = clamp(eggPotency, 0, MAX_EGG_POTENCY);
	wombStats.CycleState.nextOvulationEstimate = {
		cycleDay: nextOvulationEstimate.cycleDay,
		approxDaysUntil: Number.isFinite(nextOvulationEstimate.approxDaysUntil) ? parseFloat(nextOvulationEstimate.approxDaysUntil.toFixed(1)) : null,
	};

	wombStats.EggStatus = {
		hasMatureEgg,
		hoursSinceOvulation: hasMatureEgg ? Math.round(cycleState.eggHoursSince || 0) : null,
		viabilityWindowHoursRemaining: hasMatureEgg ? Math.max(0, Math.round(cycleState.eggWindowHours || DEFAULT_OVULATION_WINDOW_HOURS)) : 0,
		notes: eggStatusNotes,
	};

	cycleState.lastPhase = phase;

	debug("[tracker-enhanced][fertility] cycle advance", {
		character: characterName,
		phase,
		cycleDay: cycleDayOutput,
		elapsedDays,
		anchor,
	});

	return { phase, eggPotency: wombStats.CycleState.eggPotencyScore };
}

function reconcileReservoirs(options) {
	const {
		anchor,
		engineState,
		wombStats,
		ejaculationEvent,
		elapsedHours,
		diagnostics,
	} = options;

	const existingState = Array.isArray(engineState.spermReservoirs) ? engineState.spermReservoirs : [];
	const updatedState = [];

	for (const entry of existingState) {
		if (!entry || typeof entry !== "object") {
			continue;
		}
		const decayMultiplier = Number.isFinite(entry.decayMultiplier) ? entry.decayMultiplier : 1;
		const previousDecay = Number.isFinite(entry.decayHoursRemaining) ? entry.decayHoursRemaining : DEFAULT_SPERM_DECAY_HOURS;
		const newDecay = Math.max(0, previousDecay - elapsedHours * decayMultiplier);
		if (newDecay <= 0) {
			continue;
		}
		const ratio = previousDecay > 0 ? newDecay / previousDecay : 0.5;
		entry.decayHoursRemaining = newDecay;
		entry.lastKnownDecayHours = newDecay;
		entry.volumeScore = clamp(Math.round((entry.volumeScore ?? 0) * ratio), 0, 100);
		entry.motilityScore = clamp(Math.round((entry.motilityScore ?? 0) * ratio), 0, 100);
		updatedState.push(entry);
	}

	if (ejaculationEvent) {
		const reservoir = createReservoirEntry(ejaculationEvent, anchor, engineState);
		const mergeTarget = findReservoirMergeTarget(updatedState, reservoir);
		if (mergeTarget) {
			mergeTarget.volumeScore = clamp(mergeTarget.volumeScore + reservoir.volumeScore, 0, 100);
			mergeTarget.motilityScore = clamp(Math.round((mergeTarget.motilityScore + reservoir.motilityScore) / 2), 0, 100);
			mergeTarget.decayHoursRemaining = Math.max(mergeTarget.decayHoursRemaining, reservoir.decayHoursRemaining);
			mergeTarget.lastKnownDecayHours = mergeTarget.decayHoursRemaining;
			mergeTarget.lastDepositAnchor = reservoir.lastDepositAnchor;
			if (reservoir.fertilityModifierNote) {
				mergeTarget.fertilityModifierNote = reservoir.fertilityModifierNote;
			}
			mergeTarget.decayMultiplier = Math.max(mergeTarget.decayMultiplier ?? 1, reservoir.decayMultiplier ?? 1);
			diagnostics.actions.push({ type: "reservoir_merged", partner: mergeTarget.partner });
		} else {
			updatedState.unshift(reservoir);
			diagnostics.actions.push({ type: "reservoir_added", partner: reservoir.partner });
		}
	}

	engineState.spermReservoirs = updatedState;
	const wombReservoirs = updatedState.map((entry) => ({
		partner: entry.partner,
		volumeScore: clamp(Math.round(entry.volumeScore ?? 0), 0, 100),
		motilityScore: clamp(Math.round(entry.motilityScore ?? 0), 0, 100),
		decayHoursRemaining: Math.max(0, Math.round(entry.decayHoursRemaining ?? DEFAULT_SPERM_DECAY_HOURS)),
		lastDepositAnchor: entry.lastDepositAnchor,
		effectiveContraception: entry.effectiveContraception,
		fertilityModifierNote: entry.fertilityModifierNote,
	}));

	wombStats.SpermReservoir = wombReservoirs;

	return { reservoirs: wombReservoirs };
}

function createReservoirEntry(ejaculationEvent, anchor, engineState) {
	const partner = ejaculationEvent.partner || "unknown";
	const baseSeed = hashString(`${engineState.seed}|${partner}`);
	const baseVolume = clamp(55 + (baseSeed % 26), 30, 95);
	const baseMotility = clamp(60 + ((baseSeed >>> 3) % 30), 30, 95);
	const modifiers = interpretContraception(ejaculationEvent.contraception);
	const locationBonus = LOCATION_BONUS[ejaculationEvent.location] || 0;
	const volumeScore = clamp(Math.round(baseVolume * modifiers.spermMultiplier + locationBonus * 100), 0, 100);
	const motilityScore = clamp(Math.round(baseMotility * modifiers.spermMultiplier), 0, 100);
	return {
		id: `${partner}|${anchor || "unknown"}|${baseSeed}`,
		partner,
		volumeScore,
		motilityScore,
		decayHoursRemaining: Math.round(DEFAULT_SPERM_DECAY_HOURS * modifiers.decayMultiplier),
		decayMultiplier: modifiers.decayMultiplier,
		lastKnownDecayHours: Math.round(DEFAULT_SPERM_DECAY_HOURS * modifiers.decayMultiplier),
		lastDepositAnchor: anchor,
		effectiveContraception: modifiers.summary,
		fertilityModifierNote: modifiers.note,
		notes: ejaculationEvent.notes || "",
	};
}

function findReservoirMergeTarget(existingReservoirs, candidate) {
	for (const entry of existingReservoirs) {
		if (!entry || typeof entry !== "object") {
			continue;
		}
		if (normalizeName(entry.partner) !== normalizeName(candidate.partner)) {
			continue;
		}
		const hours = estimateHoursBetween(entry.lastDepositAnchor, candidate.lastDepositAnchor);
		if (hours <= 24) {
			return entry;
		}
	}
	return null;
}

function evaluateConception(options) {
	const {
		anchor,
		characterName,
		engineState,
		wombStats,
		cycleOutcome,
		reservoirOutcome,
		contraceptionSnapshot,
		ejaculationEvent,
		diagnostics,
	} = options;

	if (engineState.pregnancy?.active) {
		return { conceived: false };
	}

	const eggPotency = clamp(cycleOutcome.eggPotency ?? 0, 0, MAX_EGG_POTENCY);
	if (eggPotency <= 0) {
		return { conceived: false };
	}

	const reservoirs = reservoirOutcome.reservoirs || [];
	if (reservoirs.length === 0) {
		return { conceived: false };
	}

	let eggModifier = 1;
	let spermModifier = 1;
	const contraceptionNotes = [];
	for (const entry of contraceptionSnapshot) {
		if (entry.method.includes("hormonal") && entry.state === "active") {
			eggModifier *= Number.isFinite(entry.effectStrength) ? clamp(entry.effectStrength, 0, 1) : 0.2;
			contraceptionNotes.push("hormonal");
		}
		if (entry.method.includes("barrier") && entry.state === "active") {
			spermModifier *= Number.isFinite(entry.effectStrength) ? clamp(entry.effectStrength, 0, 1) : 0.4;
			contraceptionNotes.push("barrier");
		}
	}

	const baseChance = computeBaseConceptionChance(cycleOutcome.phase, wombStats.CycleState.cycleDay, eggPotency);
	if (baseChance <= 0) {
		return { conceived: false };
	}

	const candidates = reservoirs
		.map((entry) => ({
			partner: entry.partner,
			potency: (entry.volumeScore / 100) * (entry.motilityScore / 100),
			locationBonus: entry.effectiveContraception?.includes("cervical") ? 0.1 : 0,
		}))
		.filter((entry) => entry.potency > 0)
		.sort((a, b) => b.potency - a.potency);

	if (candidates.length === 0) {
		return { conceived: false };
	}

	let diminishing = 1;
	let rollIndex = 0;
	let conception = null;
	const seedBase = `${characterName}|${anchor || ""}|${engineState.seed}`;

	for (const candidate of candidates) {
		const chance = clamp(baseChance * eggModifier * spermModifier * candidate.potency * diminishing + candidate.locationBonus, 0, 0.95);
		if (chance <= 0) {
			diminishing *= 0.5;
			continue;
		}
		const roll = deterministicRandom(`${seedBase}|${candidate.partner}|${rollIndex++}`);
		if (roll < chance) {
			conception = {
				partner: candidate.partner,
				chance,
				roll,
				paternityConfidence: clamp(parseFloat((candidate.potency / (candidates[0].potency || 1)).toFixed(2)), 0.1, 1),
				contraception: contraceptionNotes,
			};
			break;
		}
		diminishing *= 0.5;
	}

	if (!conception) {
		diagnostics.actions.push({ type: "conception_roll", result: "miss", baseChance, eggModifier, spermModifier });
		return { conceived: false };
	}

	const twinChance = determineTwinChance(candidates, eggPotency, ejaculationEvent);
	const twinRoll = deterministicRandom(`${seedBase}|twin`);
	const isMultiple = twinRoll < twinChance;

	diagnostics.actions.push({ type: "conception_success", partner: conception.partner, probability: conception.chance, roll: conception.roll, isMultiple });

	return {
		conceived: true,
		partner: conception.partner,
		paternityConfidence: conception.paternityConfidence,
		isMultiple,
		contraception: conception.contraception,
		baseChance,
	};
}

function updatePregnancy(options) {
	const {
		anchor,
		engineState,
		wombStats,
		elapsedDays,
		elapsedHours,
		conceptionOutcome,
		diagnostics,
	} = options;

	if (conceptionOutcome?.conceived) {
		engineState.pregnancy = {
			active: true,
			dayFloat: 0,
			conceivedAt: anchor,
			partner: conceptionOutcome.partner,
			isMultiple: conceptionOutcome.isMultiple,
		};
		wombStats.PregnancyState = {
			status: "conceived",
			gestationalDay: 0,
			trimester: 0,
			fetusSummary: "Conception confirmed; implantation underway.",
			isMultiple: conceptionOutcome.isMultiple,
			conceptionAnchor: anchor,
			primaryPartner: conceptionOutcome.partner,
			paternityConfidence: conceptionOutcome.paternityConfidence,
			laborNote: null,
		};
		wombStats.SpermReservoir = [];
		diagnostics.actions.push({ type: "pregnancy_started", partner: conceptionOutcome.partner });
		return;
	}

	const pregnancyState = engineState.pregnancy && engineState.pregnancy.active ? engineState.pregnancy : null;
	if (!pregnancyState) {
		wombStats.PregnancyState = wombStats.PregnancyState && typeof wombStats.PregnancyState === "object" ? wombStats.PregnancyState : null;
		return;
	}

	pregnancyState.dayFloat = Math.max(0, pregnancyState.dayFloat + Math.max(0, elapsedDays));
	const gestationalDay = Math.round(pregnancyState.dayFloat);
	const trimester = determineTrimester(gestationalDay);
	let status = "conceived";
	if (gestationalDay >= 260) {
		status = "labor_imminent";
	} else if (gestationalDay >= 181) {
		status = "third_trimester";
	} else if (gestationalDay >= 91) {
		status = "second_trimester";
	} else if (gestationalDay >= 1) {
		status = "first_trimester";
	}
	const fetusSummary = buildFetusSummary(status, trimester, pregnancyState.isMultiple);
	const laborNote = status === "labor_imminent" ? "Contractions regular; awaiting delivery." : null;

	wombStats.PregnancyState = {
		status,
		gestationalDay,
		trimester,
		fetusSummary,
		isMultiple: pregnancyState.isMultiple,
		conceptionAnchor: pregnancyState.conceivedAt,
		primaryPartner: pregnancyState.partner,
		paternityConfidence: wombStats.PregnancyState?.paternityConfidence ?? 1,
		laborNote,
	};

	if (status === "labor_imminent") {
		diagnostics.actions.push({ type: "labor_imminent", day: gestationalDay });
		engineState.cycle.paused = true;
	}

	debug("[tracker-enhanced][fertility] pregnancy progression", {
		gestationalDay,
		status,
		trimester,
	});
}

function finalizeWombStats(wombStats) {
	return {
		CycleState: wombStats.CycleState,
		EggStatus: wombStats.EggStatus,
		SpermReservoir: wombStats.SpermReservoir,
		ContraceptionStatus: wombStats.ContraceptionStatus,
		PregnancyState: wombStats.PregnancyState,
	};
}

function determineTwinChance(partners, eggPotency, ejaculationEvent) {
	let chance = 0.03;
	const potentPartners = partners.filter((entry) => entry.potency > 0.35).length;
	if (potentPartners >= 2) {
		chance += 0.02;
	}
	if (eggPotency > 90) {
		chance += 0.01;
	}
	if (ejaculationEvent?.notes && /ivf|fertility|treatment/i.test(ejaculationEvent.notes)) {
		chance += 0.05;
	}
	return Math.min(chance, 0.12);
}

function computeBaseConceptionChance(phase, cycleDay, eggPotency) {
	switch (phase) {
		case "menstrual":
			return 0;
		case "follicular": {
			const progress = clamp((cycleDay - 5) / 10, 0, 1);
			return 0.05 + progress * 0.15 * (eggPotency / MAX_EGG_POTENCY);
		}
		case "ovulation":
			return Math.min(0.95, 0.45 + eggPotency / 200);
		case "luteal": {
			const decay = clamp((cycleDay - 15) / 10, 0, 1);
			return Math.max(0.02, (0.15 - decay * 0.13) * (eggPotency / MAX_EGG_POTENCY));
		}
		default:
			return 0;
	}
}

function determineTrimester(day) {
	if (day >= 181) {
		return 3;
	}
	if (day >= 91) {
		return 2;
	}
	if (day >= 1) {
		return 1;
	}
	return 0;
}

function buildFetusSummary(status, trimester, isMultiple) {
	const prefix = isMultiple ? "Multiples" : "Fetus";
	switch (status) {
		case "conceived":
			return `${prefix} implanting; formation just beginning.`;
		case "first_trimester":
			return `${prefix} in first trimester; heartbeat forming.`;
		case "second_trimester":
			return `${prefix} in second trimester; movement noticeable.`;
		case "third_trimester":
			return `${prefix} in final trimester; gaining weight steadily.`;
		case "labor_imminent":
			return `${prefix} ready for delivery; labor imminent.`;
		default:
			return `${prefix} development steady.`;
	}
}

function interpretContraception(tokens) {
	if (!Array.isArray(tokens) || tokens.length === 0) {
		return { spermMultiplier: 1, decayMultiplier: 1, summary: "none", note: "" };
	}
	let spermMultiplier = 1;
	let decayMultiplier = 1;
	const parts = [];
	const notes = [];
	for (const tokenRaw of tokens) {
		const token = String(tokenRaw || "").toLowerCase();
		if (!token) {
			continue;
		}
		if (token.includes("sperm") || token.includes("barrier")) {
			spermMultiplier *= 0.4;
			decayMultiplier *= 1.4;
			parts.push("barrier");
		}
		if (token.includes("ovulation")) {
			parts.push("ovulation-suppression");
			notes.push("Hormonal suppression applied.");
		}
		if (token.includes("other")) {
			parts.push("other");
			notes.push("Unspecified contraception effect noted.");
		}
		if (token.includes("pullout")) {
			spermMultiplier *= 0.75;
			parts.push("withdrawal");
		}
	}
	if (parts.length === 0) {
		parts.push("reported");
	}
	return {
		spermMultiplier: clamp(spermMultiplier, 0, 1),
		decayMultiplier: clamp(decayMultiplier, 0.5, 2),
		summary: parts.join(", "),
		note: notes.join(" ") || "",
	};
}

function estimateHoursBetween(anchorA, anchorB) {
	if (!anchorA || !anchorB) {
		return Number.POSITIVE_INFINITY;
	}
	const timeA = Date.parse(anchorA);
	const timeB = Date.parse(anchorB);
	if (Number.isNaN(timeA) || Number.isNaN(timeB)) {
		return Number.POSITIVE_INFINITY;
	}
	return Math.abs(timeB - timeA) / 3600000;
}

function extractString(value) {
	if (typeof value === "string") {
		return value;
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	return "";
}

function parseIntSafe(value, fallback) {
	const num = parseInt(value, 10);
	return Number.isFinite(num) ? num : fallback;
}

function parseFloatSafe(value, fallback) {
	const num = parseFloat(value);
	return Number.isFinite(num) ? num : fallback;
}

function clamp(value, min, max) {
	if (!Number.isFinite(value)) {
		return min;
	}
	return Math.min(Math.max(value, min), max);
}

function checkFemaleEligibility(genderValue) {
	const normalized = (genderValue || "").trim().toLowerCase();
	if (!normalized) {
		return false;
	}
	return normalized.includes("female") || normalized.includes("woman") || normalized.includes("feminine");
}

function normalizeName(value) {
	return (value || "").trim().toLowerCase();
}

function hashString(input) {
	let hash = 2166136261;
	const str = String(input || "");
	for (let i = 0; i < str.length; i++) {
		hash ^= str.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

function deterministicRandom(seed) {
	const hash = hashString(seed);
	return (hash % 1000000) / 1000000;
}

if (typeof window !== "undefined") {
	window.trackerEnhanced = window.trackerEnhanced || {};
	if (typeof window.trackerEnhanced.getFertilityDiagnostics !== "function") {
		window.trackerEnhanced.getFertilityDiagnostics = () => getFertilityDiagnostics();
	}
}
