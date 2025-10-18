import { saveSettingsDebounced } from "../../../../../../script.js";
import { getContext } from '../../../../../../scripts/extensions.js';

import { extensionFolderPath, extensionSettings } from "../../index.js";
import { error, debug, warn, toTitleCase } from "../../lib/utils.js";
import { analyzePresetSnapshot, analyzeTrackerDefinition, generateLegacyPresetName, setLegacyRegistryLogger } from "../../lib/legacyRegistry.js";
import { getSupportedLocales, setLocale, t, translateHtml, onLocaleChange, getCurrentLocale, getSillyTavernLocale, ensureLocalesLoaded } from "../../lib/i18n.js";
import { DEFAULT_PRESET_NAME, defaultSettings, automationTargets, participantTargets } from "./defaultSettings.js";
import { ensureDefaultPresetSnapshot, getCanonicalFieldMap as getPresetCanonicalFieldMap, loadLocalePresetDefinition } from "./presetLoader.js";
import { generationCaptured } from "../../lib/interconnection.js";
import { TrackerPromptMakerModal } from "../ui/trackerPromptMakerModal.js";
import { TrackerTemplateGenerator } from "../ui/components/trackerTemplateGenerator.js";
import { TrackerJavaScriptGenerator } from "../ui/components/trackerJavaScriptGenerator.js";
import { legacyPresetViewer } from "../ui/components/legacyPresetViewerModal.js";
import { legacyPresetManager } from "../ui/components/legacyPresetManagerModal.js";
import { TrackerInterface } from "../ui/trackerInterface.js";
import { DevelopmentTestUI } from "../ui/developmentTestUI.js";

export { automationTargets, participantTargets, trackerFormat } from "./defaultSettings.js";

const AUTO_PRESET_OPTION = "__auto_locale__";
const FALLBACK_LOCALE = "en";
const localePresetMap = new Map();
const canonicalLocalePresetNames = new Set([DEFAULT_PRESET_NAME]);

let settingsRootElement = null;
let localeListenerRegistered = false;
const BUILTIN_PRESET_NAMES = new Set([DEFAULT_PRESET_NAME]);
const BUILTIN_PRESET_TEMPLATES = new Map();
let canonicalFieldMap = new Map();
let defaultPresetBaseline = null;
let activePresetName = null;
let activePresetBaseline = null;
let presetDirty = false;
let lastAppliedPresetName = null;
let lastAutoResolvedPresetName = null;

setLegacyRegistryLogger(debug);

function getCanonicalTrackerMap() {
	return canonicalFieldMap;
}

function getDefaultPresetValue(key, fallback) {
	if (defaultPresetBaseline && Object.prototype.hasOwnProperty.call(defaultPresetBaseline, key)) {
		return defaultPresetBaseline[key];
	}
	return fallback;
}

function cloneDefaultPresetValues() {
	return defaultPresetBaseline ? deepClone(defaultPresetBaseline) : null;
}

function registerBuiltInPresetTemplate(name, presetValues) {
	if (!name || typeof name !== "string" || !presetValues) {
		return;
	}
	BUILTIN_PRESET_NAMES.add(name);
	const templateClone = deepClone(presetValues);
	if (templateClone?.trackerDef) {
		const sanitized = sanitizeTrackerDefinition(templateClone.trackerDef);
		templateClone.trackerDef = sanitized.definition;
	}
	BUILTIN_PRESET_TEMPLATES.set(name, templateClone);
}

function isBuiltInPresetName(name) {
	return Boolean(name && BUILTIN_PRESET_NAMES.has(name));
}

function ensureUniquePresetName(baseName, existingPresets) {
	let candidate = baseName;
	let counter = 2;
	while (Object.prototype.hasOwnProperty.call(existingPresets, candidate)) {
		candidate = `${baseName} (${counter++})`;
	}
	return candidate;
}

function registerLocalePresetMapping(localeId, presetName) {
	if (!localeId || !presetName) {
		return;
	}
	const normalizedLocale = String(localeId).trim().toLowerCase();
	if (!normalizedLocale) {
		return;
	}
	localePresetMap.set(normalizedLocale, presetName);
	canonicalLocalePresetNames.add(presetName);
}

function resolvePresetNameForLocale(localeId) {
	const presets = extensionSettings.presets || {};
	const normalizedLocale = (localeId ? String(localeId) : FALLBACK_LOCALE).trim().toLowerCase() || FALLBACK_LOCALE;
	const directMatch = localePresetMap.get(normalizedLocale);
	if (directMatch && Object.prototype.hasOwnProperty.call(presets, directMatch)) {
		return directMatch;
	}

	if (normalizedLocale !== FALLBACK_LOCALE) {
		const fallbackMatch = localePresetMap.get(FALLBACK_LOCALE);
		if (fallbackMatch && Object.prototype.hasOwnProperty.call(presets, fallbackMatch)) {
			return fallbackMatch;
		}
	}

	if (Object.prototype.hasOwnProperty.call(presets, DEFAULT_PRESET_NAME)) {
		return DEFAULT_PRESET_NAME;
	}

	const presetNames = Object.keys(presets);
	return presetNames[0] || null;
}

function getResolvedAutoPresetDisplayName() {
	if (!extensionSettings.presetAutoMode) {
		return null;
	}
	const presets = extensionSettings.presets || {};
	const selected = extensionSettings.selectedPreset;
	if (selected && Object.prototype.hasOwnProperty.call(presets, selected) && canonicalLocalePresetNames.has(selected)) {
		return selected;
	}
	const remembered = lastAutoResolvedPresetName;
	if (remembered && Object.prototype.hasOwnProperty.call(presets, remembered) && canonicalLocalePresetNames.has(remembered)) {
		return remembered;
	}
	const resolved = resolvePresetNameForLocale(getSillyTavernLocale());
	if (resolved && Object.prototype.hasOwnProperty.call(presets, resolved) && canonicalLocalePresetNames.has(resolved)) {
		return resolved;
	}
	if (Object.prototype.hasOwnProperty.call(presets, DEFAULT_PRESET_NAME) && canonicalLocalePresetNames.has(DEFAULT_PRESET_NAME)) {
		return DEFAULT_PRESET_NAME;
	}
	return null;
}

function reapplyAutoPreset(options = {}) {
	if (!extensionSettings.presetAutoMode) {
		return null;
	}
	const localeId = options.localeId || getSillyTavernLocale();
	const resolvedPresetName = resolvePresetNameForLocale(localeId);
	if (!resolvedPresetName) {
		warn("Auto preset resolution failed - no presets available", { localeId });
		return null;
	}

	lastAutoResolvedPresetName = resolvedPresetName;

	if (extensionSettings.selectedPreset === resolvedPresetName && !options.force) {
		refreshPresetBaseline();
		updatePresetDirtyState();
		refreshPresetOptionLabels();
		return resolvedPresetName;
	}

	const presets = extensionSettings.presets || {};
	if (!Object.prototype.hasOwnProperty.call(presets, resolvedPresetName)) {
		warn("Auto preset resolution missing preset snapshot", { resolvedPresetName, presets: Object.keys(presets) });
		return null;
	}

	extensionSettings.presetAutoMode = true;
	applyPreset(resolvedPresetName);
	return resolvedPresetName;
}

function refreshPresetOptionLabels() {
	const presetSelect = $("#tracker_enhanced_preset_select");
	if (!presetSelect.length) {
		return;
	}
	const autoMode = Boolean(extensionSettings.presetAutoMode);
	presetSelect.find("option").each((_, option) => {
		const baseLabel = option.dataset.baseLabel || option.value;
		let label = baseLabel;
		if (option.value === AUTO_PRESET_OPTION) {
			if (autoMode) {
				const resolvedName = getResolvedAutoPresetDisplayName();
				if (resolvedName) {
					const template = t(
						"settings.presets.option.autoCurrent",
						"Auto (Current preset: {{preset}})"
					);
					label = template.replace("{{preset}}", resolvedName);
				}
			}
			if (autoMode && presetDirty) {
				label = `${label}*`;
			}
		} else if (!autoMode && option.value === activePresetName && presetDirty) {
			label = `${baseLabel}*`;
		}
		option.text = label;
	});
}

function normalizePresetForComparison(preset) {
	if (!preset || typeof preset !== "object") {
		return null;
	}
	const normalized = {};
	for (const key of PRESET_VALUE_KEYS) {
		if (Object.prototype.hasOwnProperty.call(preset, key)) {
			const value = preset[key];
			normalized[key] = typeof value === "object" ? deepClone(value) : value;
		}
	}
	return normalized;
}

function arePresetSettingsEqual(a, b) {
	const normalizedA = normalizePresetForComparison(a);
	const normalizedB = normalizePresetForComparison(b);
	if (!normalizedA && !normalizedB) {
		return true;
	}
	if (!normalizedA || !normalizedB) {
		return false;
	}
	return JSON.stringify(normalizedA) === JSON.stringify(normalizedB);
}

function refreshPresetBaseline() {
	const presetName = extensionSettings.selectedPreset;
	activePresetName = presetName || null;
	const presetSettings = presetName && extensionSettings.presets ? extensionSettings.presets[presetName] : null;
	activePresetBaseline = presetSettings ? deepClone(presetSettings) : null;
	if (presetName) {
		lastAppliedPresetName = presetName;
	}
	if (extensionSettings.presetAutoMode) {
		lastAutoResolvedPresetName = presetName || null;
	}
	presetDirty = false;
	refreshPresetOptionLabels();
}

function updatePresetDirtyState() {
	if (!activePresetName || !activePresetBaseline) {
		presetDirty = false;
		refreshPresetOptionLabels();
		return;
	}
	const currentSnapshot = getCurrentPresetSettings();
	const isDirty = !arePresetSettingsEqual(currentSnapshot, activePresetBaseline);
	if (isDirty !== presetDirty) {
		presetDirty = isDirty;
		refreshPresetOptionLabels();
	}
}

function ensureEditablePreset(options = {}) {
	const forceDuplicate = Boolean(options?.forceDuplicate);
	const presetName = extensionSettings.selectedPreset;
	if (!presetName || !isBuiltInPresetName(presetName)) {
		return false;
	}
	if (!presetDirty && !forceDuplicate) {
		return false;
	}

	const sourceSnapshot = presetDirty
		? getCurrentPresetSettings()
		: activePresetBaseline
			? deepClone(activePresetBaseline)
			: getCurrentPresetSettings();
	const suffix = t("settings.presets.copySuffix", "copy");
	const duplicateBaseName = `${presetName} (${suffix})`;
	const duplicateName = ensureUniquePresetName(duplicateBaseName, extensionSettings.presets);
	extensionSettings.presets[duplicateName] = deepClone(sourceSnapshot);
	extensionSettings.selectedPreset = duplicateName;
	activePresetName = duplicateName;
	lastAppliedPresetName = duplicateName;
	if (extensionSettings.presetAutoMode) {
		extensionSettings.presetAutoMode = false;
		lastAutoResolvedPresetName = null;
	}
	updatePresetDropdown();
	refreshPresetBaseline();
	if (typeof toastr !== "undefined") {
		const messageTemplate = t(
			"settings.presets.toast.duplicated",
			"Built-in preset duplicated to {{name}}. Future edits apply to this copy."
		);
		const toastTitle = t("settings.presets.toast.title", "Tracker Enhanced Presets");
		toastr.info(messageTemplate.replace("{{name}}", duplicateName), toastTitle);
	}
	return true;
}

function handleSettingsMutation(options = {}) {
	updatePresetDirtyState();
	if (options.save !== false) {
		saveSettingsDebounced();
	}
}

function sanitizeTrackerDefinition(definition) {
	const analysis = analyzeTrackerDefinition(definition, { canonicalMap: getCanonicalTrackerMap() });
	return {
		definition: analysis.normalizedDefinition,
		changed: Boolean(analysis.changed),
		legacyDetected: Boolean(analysis.isLegacy),
		reasons: analysis.reasons,
	};
}

function createBuiltInPresetSnapshot(name, sourcePreset) {
	if (!name || !sourcePreset) {
		return null;
	}
	const cloned = deepClone(sourcePreset);
	if (cloned?.trackerDef) {
		const sanitized = sanitizeTrackerDefinition(cloned.trackerDef);
		cloned.trackerDef = sanitized.definition;
	}
	registerBuiltInPresetTemplate(name, cloned);
	return cloned;
}

const LEGACY_PRESET_SUMMARY_LIMIT = 5;
const LEGACY_EXPORT_SUFFIX = " (legacy)";

function normalizeLegacyPresetStore(existingStore) {
	const normalized = {};
	if (!existingStore || typeof existingStore !== "object" || Array.isArray(existingStore)) {
		return normalized;
	}
	for (const [key, entry] of Object.entries(existingStore)) {
		if (!entry || typeof entry !== "object") {
			normalized[key] = {
				originalName: key,
				quarantinedAt: null,
				reasons: [],
				preset: deepClone(entry),
			};
			continue;
		}
		const originalName = typeof entry.originalName === "string"
			? entry.originalName
			: typeof entry.name === "string"
				? entry.name
				: key;
		const quarantinedAt = typeof entry.quarantinedAt === "string"
			? entry.quarantinedAt
			: typeof entry.timestamp === "string"
				? entry.timestamp
				: null;
		const reasons = Array.isArray(entry.reasons) ? entry.reasons.slice() : [];
		const payload = entry.preset ?? entry.payload ?? entry.snapshot ?? entry;
		normalized[key] = {
			originalName,
			quarantinedAt,
			reasons,
			preset: deepClone(payload),
		};
	}
	return normalized;
}

function quarantineExtensionPresets(options = {}) {
	const timestamp = options.timestamp instanceof Date ? options.timestamp : new Date();
	const isoTimestamp = timestamp.toISOString();
	const legacyStore = normalizeLegacyPresetStore(extensionSettings.legacyPresets);
	const legacyNameSet = new Set([
		...Object.keys(legacyStore),
		...Object.keys(extensionSettings.presets || {}),
	]);
	const newlyQuarantined = [];
	const validPresets = {};
	const presetEntries = Object.entries(extensionSettings.presets || {});
	const canonicalOptions = { canonicalMap: getCanonicalTrackerMap() };

	for (const [presetName, presetValue] of presetEntries) {
		if (!presetValue || typeof presetValue !== "object") {
			validPresets[presetName] = presetValue;
			continue;
		}

		const analysis = analyzePresetSnapshot(presetName, presetValue, canonicalOptions);
		if (analysis.isLegacy) {
			const legacyLabel = generateLegacyPresetName(presetName, legacyNameSet, { timestamp });
			legacyNameSet.add(legacyLabel);
			legacyStore[legacyLabel] = {
				originalName: presetName,
				quarantinedAt: isoTimestamp,
				reasons: analysis.reasons,
				preset: deepClone(presetValue),
			};
			newlyQuarantined.push({
				originalName: presetName,
				legacyLabel,
				reasonCodes: analysis.reasons.map((entry) => entry.code),
			});
			continue;
		}

		const normalizedSnapshot = analysis.normalizedSnapshot || deepClone(presetValue);
		validPresets[presetName] = normalizedSnapshot;
		if (isBuiltInPresetName(presetName)) {
			registerBuiltInPresetTemplate(presetName, normalizedSnapshot);
		}
	}

	const replacedBuiltIns = [];
	for (const builtInName of BUILTIN_PRESET_NAMES) {
		if (!Object.prototype.hasOwnProperty.call(validPresets, builtInName)) {
			const template =
				BUILTIN_PRESET_TEMPLATES.get(builtInName) ||
				createBuiltInPresetSnapshot(builtInName, defaultSettings.presets?.[builtInName]);
			if (template) {
				validPresets[builtInName] = deepClone(template);
				registerBuiltInPresetTemplate(builtInName, template);
				replacedBuiltIns.push(builtInName);
			}
		}
	}

	const rootAnalysis = analyzeTrackerDefinition(extensionSettings.trackerDef, { canonicalMap: getCanonicalTrackerMap() });
	let trackerDefinition = rootAnalysis.normalizedDefinition;
	let trackerReplacedWithDefault = false;
	if (rootAnalysis.isLegacy) {
		const defaultTracker = defaultPresetBaseline?.trackerDef;
		if (defaultTracker) {
			trackerDefinition = deepClone(defaultTracker);
			trackerReplacedWithDefault = true;
		}
	}
	extensionSettings.trackerDef = trackerDefinition;

	extensionSettings.presets = validPresets;
	extensionSettings.legacyPresets = legacyStore;

	const previousSelected = extensionSettings.selectedPreset;
	let selectedPreset = previousSelected && Object.prototype.hasOwnProperty.call(validPresets, previousSelected)
		? previousSelected
		: null;

	if (!selectedPreset) {
		if (lastAppliedPresetName && Object.prototype.hasOwnProperty.call(validPresets, lastAppliedPresetName)) {
			selectedPreset = lastAppliedPresetName;
		} else if (Object.prototype.hasOwnProperty.call(validPresets, DEFAULT_PRESET_NAME)) {
			selectedPreset = DEFAULT_PRESET_NAME;
		} else {
			selectedPreset = Object.keys(validPresets)[0] || null;
		}
	}

	if (selectedPreset) {
		extensionSettings.selectedPreset = selectedPreset;
	} else {
		delete extensionSettings.selectedPreset;
	}

	activePresetName = selectedPreset || null;
	activePresetBaseline = selectedPreset ? deepClone(validPresets[selectedPreset]) : null;
	lastAppliedPresetName = selectedPreset || null;
	presetDirty = false;

	if (selectedPreset && validPresets[selectedPreset]) {
		Object.assign(extensionSettings, deepClone(validPresets[selectedPreset]));
	}

	return {
		newlyQuarantined,
		replacedBuiltIns,
		rootChanged: Boolean(rootAnalysis.changed),
		rootIsLegacy: Boolean(rootAnalysis.isLegacy),
		trackerReplacedWithDefault,
		selectedPresetChanged: previousSelected !== selectedPreset,
		selectedPreset,
		validPresetCount: Object.keys(validPresets).length,
		legacyPresetCount: Object.keys(legacyStore).length,
	};
}

function announcePresetQuarantine(summary = {}, options = {}) {
	const context = options.context || "init";
	const quarantined = summary.newlyQuarantined || [];
	const replacedBuiltIns = summary.replacedBuiltIns || [];
	const notifications = [];
	const hasVisibleChanges = quarantined.length || replacedBuiltIns.length || summary.trackerReplacedWithDefault || summary.selectedPresetChanged;
	const hasAnyChanges = hasVisibleChanges || summary.rootChanged || summary.rootIsLegacy;

	if (!hasAnyChanges) {
		debug("Preset quarantine completed without changes", {
			context,
			rootChanged: summary.rootChanged,
			validPresetCount: summary.validPresetCount,
			legacyPresetCount: summary.legacyPresetCount,
		});
		return;
	}

	debug("Preset quarantine results", {
		context,
		quarantined,
		replacedBuiltIns,
		rootChanged: summary.rootChanged,
		rootIsLegacy: summary.rootIsLegacy,
		trackerReplacedWithDefault: summary.trackerReplacedWithDefault,
		selectedPreset: summary.selectedPreset,
		validPresetCount: summary.validPresetCount,
		legacyPresetCount: summary.legacyPresetCount,
	});

	if (!hasVisibleChanges) {
		return;
	}

	if (quarantined.length) {
		const count = quarantined.length;
		const pluralSuffix = count === 1 ? "" : "s";
		const headerTemplate = t(
			"settings.presets.legacy.toast.quarantined_list.header",
			"Quarantined {{count}} preset{{plural}}:"
		);
		const header = headerTemplate.replace("{{count}}", String(count)).replace("{{plural}}", pluralSuffix);
		const preview = quarantined
			.slice(0, LEGACY_PRESET_SUMMARY_LIMIT)
			.map((entry) => `${entry.originalName} → ${entry.legacyLabel}`)
			.join("<br>");
		const messageParts = [header, preview];
		if (count > LEGACY_PRESET_SUMMARY_LIMIT) {
			const remainder = count - LEGACY_PRESET_SUMMARY_LIMIT;
			const moreTemplate = t(
				"settings.presets.legacy.toast.quarantined_list.more",
				"…and {{count}} more."
			);
			messageParts.push(moreTemplate.replace("{{count}}", String(remainder)));
		}
		notifications.push(messageParts.filter(Boolean).join("<br>"));
	}

	if (replacedBuiltIns.length) {
		const builtInTemplate = t(
			"settings.presets.legacy.toast.reinstalled_builtins",
			"Reinstalled built-in defaults for: {{names}}"
		);
		notifications.push(builtInTemplate.replace("{{names}}", replacedBuiltIns.join(", ")));
	}

	if (summary.trackerReplacedWithDefault) {
		notifications.push(
			t(
				"settings.presets.legacy.toast.tracker_reset",
				"Active tracker definition reset to the canonical default."
			)
		);
	}

	if (summary.selectedPresetChanged && summary.selectedPreset) {
		const switchedTemplate = t(
			"settings.presets.legacy.toast.preset_switched",
			"Active preset switched to {{name}}."
		);
		notifications.push(switchedTemplate.replace("{{name}}", summary.selectedPreset));
	}

	if (typeof toastr === "undefined" || notifications.length === 0) {
		return;
	}

	const highlightLabel = quarantined[0]?.legacyLabel || null;
	let message = notifications.join("<br><br>");
	if (quarantined.length) {
		const actionLabel = t("settings.presets.legacy.toastAction", "View legacy presets");
		message = `${message}<br><br><button type="button" class="tracker-legacy-toast-button" data-action="view-legacy">${actionLabel}</button>`;
	}
	const toastTitle = t("settings.presets.toast.title", "Tracker Enhanced Presets");
	const toast = toastr.info(message, toastTitle, {
		closeButton: true,
		timeOut: 0,
		extendedTimeOut: 0,
		escapeHtml: false,
	});
	attachLegacyToastAction(toast, { highlightLabel });
}

function getLegacyPresetSnapshot(name) {
	const legacyStore = extensionSettings.legacyPresets;
	if (!legacyStore || typeof legacyStore !== "object" || Array.isArray(legacyStore)) {
		return null;
	}
	const record = legacyStore[name];
	if (!record || typeof record !== "object") {
		return null;
	}
	const presetPayload = record.preset ?? record.payload ?? record.snapshot ?? record;
	return {
		originalName: typeof record.originalName === "string" ? record.originalName : name,
		quarantinedAt: typeof record.quarantinedAt === "string" ? record.quarantinedAt : null,
		reasons: Array.isArray(record.reasons) ? record.reasons : [],
		preset: presetPayload,
	};
}

function getNormalizedLegacyStore() {
	return normalizeLegacyPresetStore(extensionSettings.legacyPresets);
}

function refreshLegacyPresetManager(options = {}) {
	if (!legacyPresetManager?.modal || !legacyPresetManager.modal.open) {
		return;
	}
	const normalizedStore = getNormalizedLegacyStore();
	legacyPresetManager.updateStore(normalizedStore, options);
}

function removeLegacyPreset(label) {
	if (!label) {
		return false;
	}
	if (!extensionSettings.legacyPresets || typeof extensionSettings.legacyPresets !== "object" || Array.isArray(extensionSettings.legacyPresets)) {
		return false;
	}
	if (!Object.prototype.hasOwnProperty.call(extensionSettings.legacyPresets, label)) {
		warn("Attempted to remove unknown legacy preset", { label });
		return false;
	}
	const template = t(
		"settings.presets.legacy.delete.confirm",
		'Remove legacy preset "{{name}}"? This action cannot be undone.'
	);
	const message = template.replace("{{name}}", label);
	if (!confirm(message)) {
		return false;
	}

	delete extensionSettings.legacyPresets[label];
	refreshLegacyPresetManager();
	saveSettingsDebounced();
	if (typeof toastr !== "undefined") {
		const toastTitle = t("settings.presets.legacy.toast.title", "Legacy Presets");
		toastr.success(
			t("settings.presets.legacy.delete.success", 'Legacy preset "{{name}}" removed.').replace("{{name}}", label),
			toastTitle
		);
	}
	debug("Removed legacy preset entry", { label });
	return true;
}

function showLegacyPresetManager(options = {}) {
	const normalizedStore = getNormalizedLegacyStore();
	const highlightLabel = options.highlightLabel || null;
	legacyPresetManager.show(
		normalizedStore,
		{
			onView: (record) => {
				legacyPresetViewer.show(record.label, record.preset, {
					originalName: record.originalName,
					quarantinedAt: record.quarantinedAt,
					reasons: record.reasons,
				});
			},
			onExport: (record) => {
				exportPresetByName(record.label, { allowLegacy: true });
			},
			onDelete: (record) => {
				removeLegacyPreset(record.label);
			},
		},
		{ highlightLabel }
	);
}

function onLegacyPresetsClick(event) {
	event.preventDefault();
	showLegacyPresetManager();
}

function attachLegacyToastAction(toastResult, options = {}) {
	if (!toastResult) {
		return;
	}
	let toastElement = null;
	if (typeof toastResult.get === "function") {
		toastElement = toastResult.get(0);
	} else if (Array.isArray(toastResult) && toastResult.length && toastResult[0] instanceof HTMLElement) {
		[toastElement] = toastResult;
	} else if (toastResult.nodeType === 1) {
		toastElement = toastResult;
	}
	if (!toastElement) {
		return;
	}
	const button = toastElement.querySelector(".tracker-legacy-toast-button");
	if (!button) {
		return;
	}
	const highlightLabel = options.highlightLabel || null;
	button.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		showLegacyPresetManager({ highlightLabel });
	});
}

const targetOptionLabelKeys = {
	[automationTargets.BOTH]: "settings.generation_target.option.both",
	[automationTargets.USER]: "settings.generation_target.option.user",
	[automationTargets.CHARACTER]: "settings.generation_target.option.character",
	[automationTargets.NONE]: "settings.generation_target.option.none",
};

const DEFAULT_RECENT_MESSAGE_ENTRY_TEMPLATE = "{{#if tracker}}Tracker: <tracker>\\n{{tracker}}\\n</tracker>\\n{{/if}}{{char}}: {{message}}";

const staticLocalizationBindings = [];
const PRESET_VALUE_KEYS = [
	"generateContextTemplate",
	"generateSystemPrompt",
	"generateRequestPrompt",
	"participantGuidanceTemplate",
	"generateRecentMessagesTemplate",
	"generateRecentMessageEntryTemplate",
	"includeTrackersInRecentMessages",
	"characterDescriptionTemplate",
	"mesTrackerTemplate",
	"mesTrackerJavascript",
	"roleplayPrompt",
	"automationTarget",
	"participantTarget",
	"showPopupFor",
	"trackerFormat",
	"numberOfMessages",
	"generateFromMessage",
	"minimumDepth",
	"responseLength",
	"devToolsEnabled",
	"debugMode",
	"trackerInjectionEnabled",
	"toolbarIndicatorEnabled",
	"trackerDef",
];

function applyPresetSnapshotToSettings(target, presetValues, options = {}) {
	if (!target || !presetValues || typeof presetValues !== "object") {
		return;
	}
	const overwrite = options.overwrite !== false;
	for (const key of PRESET_VALUE_KEYS) {
		if (!Object.prototype.hasOwnProperty.call(presetValues, key)) {
			continue;
		}
		if (!overwrite && typeof target[key] !== "undefined") {
			continue;
		}
		target[key] = deepClone(presetValues[key]);
	}
}

/**
 * Checks if the extension is enabled.
 * @returns {Promise<boolean>} True if enabled, false otherwise.
 */
export async function isEnabled() {
	debug("Checking if extension is enabled:", extensionSettings.enabled);
	return extensionSettings.enabled && (await generationCaptured());
}

export async function toggleExtension(enable = true) {
	extensionSettings.enabled = enable;
	$("#tracker_enhanced_enable").prop("checked", enable);
	saveSettingsDebounced();
}

// #region Settings Initialization

/**
 * Initializes the extension settings.
 * If certain settings are missing, uses default settings.
 * Saves the settings and loads the settings UI.
 */
export async function initSettings() {
	const currentSettings = { ...extensionSettings };

	const defaultPresetSnapshot = await ensureDefaultPresetSnapshot();
	defaultPresetBaseline = deepClone(defaultPresetSnapshot);
	canonicalFieldMap = getPresetCanonicalFieldMap();

	defaultSettings.presets = defaultSettings.presets || {};
	defaultSettings.presets[DEFAULT_PRESET_NAME] = deepClone(defaultPresetBaseline);

	const baseDefaults = deepClone(defaultSettings);
	baseDefaults.presets = baseDefaults.presets || {};
	baseDefaults.presets[DEFAULT_PRESET_NAME] = deepClone(defaultPresetBaseline);

	const resetExtensionSettingsFromBase = () => {
		for (const key of Object.keys(extensionSettings)) {
			delete extensionSettings[key];
		}
		Object.assign(extensionSettings, deepClone(baseDefaults));
	};

	if (!currentSettings.trackerDef) {
		const allowedKeys = [
			"enabled",
			"generateContextTemplate",
			"generateSystemPrompt",
			"generateRequestPrompt",
			"roleplayPrompt",
			"characterDescriptionTemplate",
			"mesTrackerTemplate",
			"numberOfMessages",
			"responseLength",
			"debugMode",
			"devToolsEnabled",
		];

		resetExtensionSettingsFromBase();
		applyPresetSnapshotToSettings(extensionSettings, defaultPresetBaseline, { overwrite: true });

		if (currentSettings.presets && typeof currentSettings.presets === "object" && !Array.isArray(currentSettings.presets)) {
			const preservedPresets = deepClone(currentSettings.presets);
			extensionSettings.presets = {
				...preservedPresets,
				...extensionSettings.presets,
			};
		}

		for (const key of allowedKeys) {
			if (typeof currentSettings[key] !== "undefined") {
				extensionSettings[key] = deepClone(currentSettings[key]);
			}
		}

		extensionSettings.oldSettings = currentSettings;
	} else {
		migrateIsDynamicToPresence(currentSettings);

		resetExtensionSettingsFromBase();
		applyPresetSnapshotToSettings(extensionSettings, defaultPresetBaseline, { overwrite: true });
		Object.assign(extensionSettings, currentSettings);
	}

	delete extensionSettings.localePresetSnapshot;

	if (typeof extensionSettings.presets !== "object" || extensionSettings.presets === null || Array.isArray(extensionSettings.presets)) {
		extensionSettings.presets = {};
	}
	if (!Object.prototype.hasOwnProperty.call(extensionSettings.presets, DEFAULT_PRESET_NAME)) {
		const defaultPresetClone = cloneDefaultPresetValues();
		if (defaultPresetClone) {
			extensionSettings.presets[DEFAULT_PRESET_NAME] = defaultPresetClone;
		}
	}

	if (typeof extensionSettings.presetAutoMode !== "boolean") {
		extensionSettings.presetAutoMode = Boolean(defaultSettings.presetAutoMode);
	}

	if (!extensionSettings.selectedPreset) {
		extensionSettings.selectedPreset = defaultSettings.selectedPreset || DEFAULT_PRESET_NAME;
	}

	await ensureLocalePresetsRegistered();
	const defaultPresetForRegistration = extensionSettings.presets?.[DEFAULT_PRESET_NAME];
	if (defaultPresetForRegistration) {
		registerBuiltInPresetTemplate(DEFAULT_PRESET_NAME, defaultPresetForRegistration);
	}
	const quarantineSummary = quarantineExtensionPresets({ timestamp: new Date() });
	announcePresetQuarantine(quarantineSummary, { context: "init" });

	if (extensionSettings.presetAutoMode) {
		reapplyAutoPreset({ force: true });
	}

	saveSettingsDebounced();

	await loadSettingsUI();
}

/**
 * Migrates the isDynamic field to presence for all objects in the settings.
 * @param {Object} obj The object to migrate.
 * @returns {void}
*/
function migrateIsDynamicToPresence(obj) {
	if (typeof obj !== "object" || obj === null) return;

	for (const key in obj) {
		if (key === "isDynamic") {
			// Replace isDynamic with presence, mapping true → "DYNAMIC" and false → "STATIC"
			obj.presence = obj[key] ? "DYNAMIC" : "STATIC";
			delete obj.isDynamic; // Remove old key
		} else if (typeof obj[key] === "object") {
			// Recursively migrate nested objects
			migrateIsDynamicToPresence(obj[key]);
		}
	}
}

/**
 * Loads the settings UI by fetching the HTML and appending it to the page.
 * Sets initial values and registers event listeners.
 */
async function loadSettingsUI() {
	try {
		debug("Loading settings UI from path:", `${extensionFolderPath}/html/settings.html`);
		const settingsHtml = await $.get(`${extensionFolderPath}/html/settings.html`);
		$("#extensions_settings2").append(settingsHtml);
		debug("Settings UI HTML appended successfully");

		settingsRootElement = document.getElementById("tracker_enhanced_settings");
		await ensureLocalesLoaded();
		const currentLocale = getCurrentLocale();
		applySettingsLocalization(currentLocale);

		if (!localeListenerRegistered) {
			onLocaleChange((locale) => {
				applySettingsLocalization(locale);
				if (extensionSettings.presetAutoMode) {
					reapplyAutoPreset();
				}
			});
			localeListenerRegistered = true;
		}


		await ensureLocalePresetsRegistered();
		DevelopmentTestUI.init();
		setSettingsInitialValues();
		registerSettingsListeners();
		
		debug("Settings UI initialization completed");
	} catch (error) {
		error("Failed to load settings UI:", error);
		console.error("Tracker Enhanced: Failed to load settings UI:", error);
	}
}

function applySettingsLocalization(locale = getCurrentLocale()) {
	if (!settingsRootElement) {
		return;
	}
	translateHtml(settingsRootElement);
	refreshLanguageOverrideDropdown();
	localizeStaticSettingsContent();
	updatePopupDropdown();
}

function localizeStaticSettingsContent() {
	if (!settingsRootElement) {
		return;
	}
	for (const binding of staticLocalizationBindings) {
		const element = typeof binding.element === "function" ? binding.element() : settingsRootElement.querySelector(binding.element);
		if (!element) {
			continue;
		}
		const target = binding.target || "text";
		if (target.startsWith("attr:")) {
			const attrName = target.split(":")[1];
			const fallbackAttr = element.getAttribute(attrName) || "";
			element.setAttribute(attrName, t(binding.key, fallbackAttr));
			continue;
		}
		let fallback = "";
		switch (target) {
			case "html":
				fallback = element.innerHTML || "";
				break;
			case "value":
				fallback = element.value || "";
				break;
			default:
				fallback = element.textContent || "";
				break;
		}
		const localized = t(binding.key, fallback);
		if (target === "html") {
			element.innerHTML = localized;
		} else if (target === "value") {
			element.value = localized;
		} else {
			element.textContent = localized;
		}
	}
}
let localePresetRegistrationPromise = null;

async function ensureLocalePresetsRegistered(options = {}) {
	if (options.force) {
		localePresetRegistrationPromise = null;
	}

	if (!localePresetRegistrationPromise) {
		localePresetRegistrationPromise = seedLocalePresetEntries(options);
	}
	return localePresetRegistrationPromise;
}

async function seedLocalePresetEntries(options = {}) {
	const forceDiscovery = Boolean(options?.force);
	await ensureLocalesLoaded({ force: forceDiscovery });
	localePresetMap.clear();
	canonicalLocalePresetNames.clear();
	canonicalLocalePresetNames.add(DEFAULT_PRESET_NAME);
	extensionSettings.presets = extensionSettings.presets || {};
	const legacyStore = normalizeLegacyPresetStore(extensionSettings.legacyPresets);
	extensionSettings.legacyPresets = legacyStore;
	refreshLegacyPresetManager();

	let changesMade = false;
	const legacyNameSet = new Set([
		...Object.keys(extensionSettings.presets),
		...Object.keys(legacyStore),
	]);
	const localeCatalog = new Map();
	const localeIds = [];
	const timestamp = new Date();
	const isoTimestamp = timestamp.toISOString();
	const quarantinedLocales = [];

	const defaultPresetSource =
		extensionSettings.presets[DEFAULT_PRESET_NAME] ||
		defaultSettings.presets?.[DEFAULT_PRESET_NAME] ||
		cloneDefaultPresetValues();
	if (defaultPresetSource) {
		const fallbackSnapshot = createBuiltInPresetSnapshot(DEFAULT_PRESET_NAME, defaultPresetSource);
		if (fallbackSnapshot) {
			const previousSnapshot = extensionSettings.presets[DEFAULT_PRESET_NAME];
			const serializedPrevious = previousSnapshot ? JSON.stringify(previousSnapshot) : null;
			extensionSettings.presets[DEFAULT_PRESET_NAME] = fallbackSnapshot;
			if (!serializedPrevious || JSON.stringify(fallbackSnapshot) !== serializedPrevious) {
				changesMade = true;
			}
		}
	}

	for (const locale of getSupportedLocales()) {
		if (!locale || !locale.id || locale.id === "auto") {
			continue;
		}
		const normalizedLocaleId = String(locale.id).trim().toLowerCase();
		if (!normalizedLocaleId) {
			continue;
		}
		localeIds.push(normalizedLocaleId);
		if (locale.label) {
			localeCatalog.set(normalizedLocaleId, locale.label);
		}
	}

	await Promise.all(
		localeIds.map(async (localeId) => {
			const definition = await loadLocalePresetDefinition(localeId);
			if (!definition || !definition.values) {
				return;
			}
			const presetTitle = (definition.title || "").trim() || getFallbackPresetTitle(localeId, localeCatalog.get(localeId));
			if (!presetTitle) {
				return;
			}
			const localeAnalysis = buildLocalePresetAnalysis(presetTitle, definition.values);
			if (!localeAnalysis || !localeAnalysis.normalizedSnapshot) {
				return;
			}
			if (localeAnalysis.isLegacy) {
				const legacyLabel = generateLegacyPresetName(presetTitle, legacyNameSet, { timestamp });
				legacyNameSet.add(legacyLabel);
				legacyStore[legacyLabel] = {
					originalName: presetTitle,
					quarantinedAt: isoTimestamp,
					reasons: localeAnalysis.reasons,
					preset: deepClone(definition.values),
				};
				quarantinedLocales.push({ originalName: presetTitle, legacyLabel, localeId });
				changesMade = true;
				return;
			}
			const normalizedSnapshot = deepClone(localeAnalysis.normalizedSnapshot);
			const previousSnapshot = extensionSettings.presets[presetTitle];
			extensionSettings.presets[presetTitle] = normalizedSnapshot;
			registerBuiltInPresetTemplate(presetTitle, normalizedSnapshot);
			registerLocalePresetMapping(localeId, presetTitle);
			legacyNameSet.add(presetTitle);
			if (!previousSnapshot || JSON.stringify(previousSnapshot) !== JSON.stringify(normalizedSnapshot)) {
				changesMade = true;
			}
		})
	);

	if (!localePresetMap.has(FALLBACK_LOCALE) && Object.prototype.hasOwnProperty.call(extensionSettings.presets, DEFAULT_PRESET_NAME)) {
		registerLocalePresetMapping(FALLBACK_LOCALE, DEFAULT_PRESET_NAME);
	}

	if (quarantinedLocales.length) {
		debug("Locale presets quarantined", { entries: quarantinedLocales });
	}

	if (changesMade) {
		extensionSettings.legacyPresets = legacyStore;
		refreshLegacyPresetManager();
		saveSettingsDebounced();
	}
}

function getFallbackPresetTitle(localeId, localeLabel) {
	if (localeLabel && typeof localeLabel === "string") {
		return `Locale Default (${localeLabel})`;
	}
	return `Locale Default (${localeId})`;
}

function buildLocalePresetAnalysis(presetName, values = {}) {
	if (!values || typeof values !== "object") {
		return null;
	}
	const sanitized = {};
	for (const key of PRESET_VALUE_KEYS) {
		if (Object.prototype.hasOwnProperty.call(values, key)) {
			sanitized[key] = deepClone(values[key]);
		}
	}
	if (Object.keys(sanitized).length === 0) {
		return null;
	}
	migrateIsDynamicToPresence(sanitized);
	return analyzePresetSnapshot(presetName, sanitized, { canonicalMap: getCanonicalTrackerMap() });
}

function deepClone(value) {
	if (value === null || typeof value !== "object") {
		return value;
	}
	try {
		return JSON.parse(JSON.stringify(value));
	} catch (err) {
		debug("Failed to clone preset value", { error: err });
		return value;
	}
}

function refreshLanguageOverrideDropdown() {
	if (!settingsRootElement) {
		return;
	}
	const select = settingsRootElement.querySelector("#tracker_enhanced_language_override");
	if (!select) {
		return;
	}
	const previousValue = extensionSettings.languageOverride || "auto";
	select.innerHTML = "";

	const autoOption = document.createElement("option");
	autoOption.value = "auto";
	autoOption.textContent = t("settings.language.auto", "Auto (SillyTavern default)");
	select.append(autoOption);

	for (const locale of getSupportedLocales()) {
		const option = document.createElement("option");
		option.value = locale.id;
		option.textContent = locale.label;
		select.append(option);
	}

	const hasExisting = Array.from(select.options).some((option) => option.value === previousValue);
	select.value = hasExisting ? previousValue : "auto";

	if (!hasExisting && previousValue !== "auto") {
		extensionSettings.languageOverride = "auto";
		saveSettingsDebounced();
	}
}

/**
 * Sets the initial values for the settings UI elements based on current settings.
 */
function setSettingsInitialValues() {
	refreshLanguageOverrideDropdown();
	if (typeof extensionSettings.presetAutoMode !== "boolean") {
		extensionSettings.presetAutoMode = Boolean(defaultSettings.presetAutoMode);
	}
	// Populate presets dropdown
	updatePresetDropdown();
	initializeOverridesDropdowns();

	$("#tracker_enhanced_enable").prop("checked", extensionSettings.enabled);
	const defaultAutomationTarget = getDefaultPresetValue("automationTarget", automationTargets.BOTH);
	if (typeof extensionSettings.automationTarget === "undefined") {
		extensionSettings.automationTarget = defaultAutomationTarget;
	}
	const defaultParticipantTarget = getDefaultPresetValue("participantTarget", participantTargets.BOTH);
	if (typeof extensionSettings.participantTarget === "undefined") {
		extensionSettings.participantTarget = defaultParticipantTarget;
	}
	const defaultGuidanceTemplate = getDefaultPresetValue("participantGuidanceTemplate", "");
	if (typeof extensionSettings.participantGuidanceTemplate !== "string") {
		extensionSettings.participantGuidanceTemplate = defaultGuidanceTemplate;
	}
	const automationTarget = extensionSettings.automationTarget ?? defaultAutomationTarget;
	const participantTarget = extensionSettings.participantTarget ?? defaultParticipantTarget;
	const participantGuidanceTemplate = extensionSettings.participantGuidanceTemplate ?? defaultGuidanceTemplate ?? "";

	updatePopupDropdown();
	const defaultPopupTarget = getDefaultPresetValue("showPopupFor", automationTargets.NONE);
	const popupTarget = extensionSettings.showPopupFor ?? defaultPopupTarget;

	$("#tracker_enhanced_automation_target").val(automationTarget);
	$("#tracker_enhanced_participant_target").val(participantTarget);
	$("#tracker_enhanced_participant_guidance").val(participantGuidanceTemplate);
	$("#tracker_enhanced_show_popup_for").val(popupTarget);
	$("#tracker_enhanced_format").val(extensionSettings.trackerFormat);
	$("#tracker_enhanced_toolbar_indicator").prop("checked", extensionSettings.toolbarIndicatorEnabled !== false);
	$("#tracker_enhanced_dev_tools").prop("checked", Boolean(extensionSettings.devToolsEnabled));
	$("#tracker_enhanced_debug").prop("checked", extensionSettings.debugMode);
	let includeTrackers = extensionSettings.includeTrackersInRecentMessages;
	if (typeof includeTrackers !== "boolean") {
		includeTrackers = Boolean(getDefaultPresetValue("includeTrackersInRecentMessages", false));
		extensionSettings.includeTrackersInRecentMessages = includeTrackers;
	}
	$("#tracker_enhanced_recent_messages_include_trackers").prop("checked", includeTrackers);

	// Set other settings fields
	$("#tracker_enhanced_context_prompt").val(extensionSettings.generateContextTemplate);
	$("#tracker_enhanced_system_prompt").val(extensionSettings.generateSystemPrompt);
	$("#tracker_enhanced_request_prompt").val(extensionSettings.generateRequestPrompt);
	$("#tracker_enhanced_roleplay_prompt").val(extensionSettings.roleplayPrompt);
	$("#tracker_enhanced_recent_messages").val(extensionSettings.generateRecentMessagesTemplate);
	const defaultEntryTemplate = getDefaultPresetValue("generateRecentMessageEntryTemplate", DEFAULT_RECENT_MESSAGE_ENTRY_TEMPLATE);
	if (typeof extensionSettings.generateRecentMessageEntryTemplate !== "string") {
		extensionSettings.generateRecentMessageEntryTemplate = defaultEntryTemplate;
	}
	$("#tracker_enhanced_recent_message_entry").val(extensionSettings.generateRecentMessageEntryTemplate);
	$("#tracker_enhanced_character_description").val(extensionSettings.characterDescriptionTemplate);
	$("#tracker_enhanced_mes_tracker_template").val(extensionSettings.mesTrackerTemplate);
	$("#tracker_enhanced_mes_tracker_javascript").val(extensionSettings.mesTrackerJavascript);
	$("#tracker_enhanced_number_of_messages").val(extensionSettings.numberOfMessages);
	$("#tracker_enhanced_generate_from_message").val(extensionSettings.generateFromMessage);
	$("#tracker_enhanced_minimum_depth").val(extensionSettings.minimumDepth);
	$("#tracker_enhanced_response_length").val(extensionSettings.responseLength);

	// Process the tracker javascript
	processTrackerJavascript();

	DevelopmentTestUI.setEnabled(Boolean(extensionSettings.devToolsEnabled));

	if (typeof TrackerInterface.setIndicatorVisibility === "function") {
		TrackerInterface.setIndicatorVisibility(extensionSettings.toolbarIndicatorEnabled !== false);
	}
	if (typeof TrackerInterface.syncInjectionToggle === "function") {
		TrackerInterface.syncInjectionToggle(extensionSettings.trackerInjectionEnabled !== false);
	} else if (typeof TrackerInterface.updateInjectionIndicator === "function") {
		TrackerInterface.updateInjectionIndicator(extensionSettings.trackerInjectionEnabled !== false);
	}

	refreshPresetBaseline();
	updatePresetDirtyState();
}

// #endregion

// #region Event Listeners

/**
 * Registers event listeners for settings UI elements.
 */
function registerSettingsListeners() {
	// Preset management
	$("#tracker_enhanced_preset_select").on("change", onPresetSelectChange);
	$("#tracker_enhanced_legacy_presets").on("click", onLegacyPresetsClick);
	$("#tracker_enhanced_connection_profile").on("change", onConnectionProfileSelectChange);
	$("#tracker_enhanced_completion_preset").on("change", onCompletionPresetSelectChange);
	$("#tracker_enhanced_preset_new").on("click", onPresetNewClick);
	$("#tracker_enhanced_preset_save").on("click", onPresetSaveClick);
	$("#tracker_enhanced_preset_rename").on("click", onPresetRenameClick);
	$("#tracker_enhanced_preset_restore").on("click", onPresetRestoreClick);
	$("#tracker_enhanced_preset_delete").on("click", onPresetDeleteClick);
	$("#tracker_enhanced_preset_export").on("click", onPresetExportClick);
	$("#tracker_enhanced_preset_import_button").on("click", onPresetImportButtonClick);
	$("#tracker_enhanced_preset_import").on("change", onPresetImportChange);

	// Settings fields
	$("#tracker_enhanced_enable").on("input", onSettingCheckboxInput("enabled", { trackPreset: false }));
	$("#tracker_enhanced_automation_target").on("change", onSettingSelectChange("automationTarget"));
	$("#tracker_enhanced_participant_target").on("change", onSettingSelectChange("participantTarget"));
	$("#tracker_enhanced_show_popup_for").on("change", onSettingSelectChange("showPopupFor"));
	$("#tracker_enhanced_format").on("change", onSettingSelectChange("trackerFormat"));
	$("#tracker_enhanced_language_override").on("change", onLanguageOverrideChange);
	$("#tracker_enhanced_toolbar_indicator").on("input", (event) => {
		const enabled = $(event.currentTarget).is(":checked");
		extensionSettings.toolbarIndicatorEnabled = enabled;
		handleSettingsMutation();
		if (typeof TrackerInterface.setIndicatorVisibility === "function") {
			TrackerInterface.setIndicatorVisibility(enabled);
		}
	});

	$("#tracker_enhanced_dev_tools").on("input", (event) => {
		const enabled = $(event.currentTarget).is(":checked");
		extensionSettings.devToolsEnabled = enabled;
		handleSettingsMutation();
		DevelopmentTestUI.setEnabled(enabled);
	});

	$("#tracker_enhanced_debug").on("input", onSettingCheckboxInput("debugMode"));

	$("#tracker_enhanced_context_prompt").on("input", onSettingInputareaInput("generateContextTemplate"));
	$("#tracker_enhanced_system_prompt").on("input", onSettingInputareaInput("generateSystemPrompt"));
	$("#tracker_enhanced_participant_guidance").on("input", onSettingInputareaInput("participantGuidanceTemplate"));
	$("#tracker_enhanced_request_prompt").on("input", onSettingInputareaInput("generateRequestPrompt"));
	$("#tracker_enhanced_roleplay_prompt").on("input", onSettingInputareaInput("roleplayPrompt"));
	$("#tracker_enhanced_recent_messages").on("input", onSettingInputareaInput("generateRecentMessagesTemplate"));
	$("#tracker_enhanced_recent_message_entry").on("input", onSettingInputareaInput("generateRecentMessageEntryTemplate"));
	$("#tracker_enhanced_character_description").on("input", onSettingInputareaInput("characterDescriptionTemplate"));
	$("#tracker_enhanced_recent_messages_include_trackers").on("input", (event) => {
		const enabled = $(event.currentTarget).is(":checked");
		extensionSettings.includeTrackersInRecentMessages = enabled;
		handleSettingsMutation();
	});
	$("#tracker_enhanced_mes_tracker_template").on("input", onSettingInputareaInput("mesTrackerTemplate"));
	$("#tracker_enhanced_mes_tracker_javascript").on("input", onSettingInputareaInput("mesTrackerJavascript"));
	$("#tracker_enhanced_number_of_messages").on("input", onSettingNumberInput("numberOfMessages"));
	$("#tracker_enhanced_generate_from_message").on("input", onSettingNumberInput("generateFromMessage"));
	$("#tracker_enhanced_minimum_depth").on("input", onSettingNumberInput("minimumDepth"));
	$("#tracker_enhanced_response_length").on("input", onSettingNumberInput("responseLength"));

	$("#tracker_enhanced_prompt_maker").on("click", onTrackerPromptMakerClick);
	$("#tracker_enhanced_generate_template").on("click", onGenerateTemplateClick);
	$("#tracker_enhanced_generate_javascript").on("click", onGenerateJavaScriptClick);
	$("#tracker_enhanced_reset_presets").on("click", onTrackerPromptResetClick);

	const {
		eventSource,
		event_types,
	} = getContext();

	eventSource.on(event_types.CONNECTION_PROFILE_LOADED, onMainSettingsConnectionProfileChange);
}
async function onLanguageOverrideChange(event) {
	const selectedLocale = String($(event.currentTarget).val() || "auto");
	debug("Language override changed", selectedLocale);
	extensionSettings.languageOverride = selectedLocale;
	saveSettingsDebounced();
	try {
		await setLocale(selectedLocale);
	} catch (err) {
		error("Failed to switch tracker locale", err);
	}
}


// #endregion

// #region Connection Profile Override

function getConnectionProfiles() {
	const ctx = getContext();
	const connectionProfileNames = ctx.extensionSettings.connectionManager.profiles.map(x => x.name);
	return connectionProfileNames;
}

function updateConnectionProfileDropdown() {
	const connectionProfileSelect = $("#tracker_enhanced_connection_profile");
	const connectionProfiles = getConnectionProfiles();
	debug("connections profiles found", connectionProfiles);
	connectionProfileSelect.empty();
	connectionProfileSelect.append($("<option>").val("current").text("Same as current"));
	for (const profileName of connectionProfiles) {
		const option = $("<option>").val(profileName).text(profileName);

		if (profileName === extensionSettings.selectedProfile) {
			option.attr("selected", "selected");
		}

		connectionProfileSelect.append(option);
	}
}

function initializeOverridesDropdowns() {
	try {
		const ctx = getContext();
		const connectionManager = ctx.extensionSettings.connectionManager;
		if(connectionManager.profiles.length === 0 && extensionSettings.enabled) {
			return;
		}
		updateConnectionProfileDropdown();
	
		let actualSelectedProfile;
		if(extensionSettings.selectedProfile === 'current') {
			actualSelectedProfile = connectionManager.profiles.find(x => x.id === connectionManager.selectedProfile);
			extensionSettings.selectedProfileApi = actualSelectedProfile.api;
			extensionSettings.selectedProfileMode = actualSelectedProfile.mode;
	
		} else {
			actualSelectedProfile = connectionManager.profiles.find(x => x.name === extensionSettings.selectedProfile);
			extensionSettings.selectedProfileApi = actualSelectedProfile.api;
			extensionSettings.selectedProfileMode = actualSelectedProfile.mode;
			}
		debug("Selected profile:", { actualSelectedProfile, extensionSettings });
		updateCompletionPresetsDropdown();
	} catch(e) {
		error(e)
		toastr.error(t("settings.overrides.error.init", "Failed to initialize overrides presets"));

	}
	saveSettingsDebounced();
}

function onConnectionProfileSelectChange() {
	const selectedProfile = $(this).val();
	extensionSettings.selectedProfile = selectedProfile;
	const ctx = getContext();
	const connectionManager = ctx.extensionSettings.connectionManager

	let actualSelectedProfile;

	if(selectedProfile === 'current') {
		actualSelectedProfile = connectionManager.profiles.find(x => x.id === connectionManager.selectedProfile);
		extensionSettings.selectedProfileApi = actualSelectedProfile.api;
		extensionSettings.selectedProfileMode = actualSelectedProfile.mode;
	} else {
		actualSelectedProfile = connectionManager.profiles.find(x => x.name === selectedProfile);
		extensionSettings.selectedProfileApi = actualSelectedProfile.api;
		extensionSettings.selectedProfileMode = actualSelectedProfile.mode;
	}

	extensionSettings.selectedCompletionPreset = "current";

	debug("Selected profile:", { selectedProfile, extensionSettings });
	updateCompletionPresetsDropdown();
	saveSettingsDebounced();
}

function onMainSettingsConnectionProfileChange() {
	if(extensionSettings.selectedProfile === "current") {
		debug("Connection profile changed. Updating presets drop down");
		extensionSettings.selectedCompletionPreset = "current";
		updateCompletionPresetsDropdown();
	}
}

// #endregion

// #region Completion Preset Override

function getPresetCompatibilityIndicator(compatibility) {
	switch(compatibility) {
		case 'compatible':
			return '✅';
		case 'questionable':
			return '⚠️';
		case 'incompatible':
			return '❌';
		default:
			return '';
	}
}

function formatPresetName(presetName, compatibility) {
	const indicator = getPresetCompatibilityIndicator(compatibility);
	const warnings = {
		'compatible': '',
		'questionable': ' (May have compatibility issues)',
		'incompatible': ' (Likely incompatible - different API)'
	};
	return `${indicator} ${presetName}${warnings[compatibility] || ''}`.trim();
}

function getCompletionPresets() {
	const ctx = getContext();
	let allPresets = { compatible: [], questionable: [], incompatible: [] };

	try {
		if(extensionSettings.selectedProfileMode === "cc") {
			const presetManager = ctx.getPresetManager('openai');
			const presets = presetManager.getPresetList().presets;
			const presetNames = presetManager.getPresetList().preset_names;

			let presetsDict = {};
			for(const x in presetNames) presetsDict[x] = presets[presetNames[x]];
			debug('available presetNames', presetNames);
			debug('extensionSettings.selectedProfileApi', extensionSettings.selectedProfileApi);
			debug('presetsDict', presetsDict);
			
			for(const x in presetsDict) {
				const preset = presetsDict[x];
				if (!preset) {
					allPresets.questionable.push(x);
					continue;
				}
				
				const presetSource = preset.chat_completion_source;
				const mappedSource = ctx.CONNECT_API_MAP[extensionSettings.selectedProfileApi]?.source;
				
				if(presetSource === extensionSettings.selectedProfileApi) {
					// Direct match - fully compatible
					allPresets.compatible.push(x);
				} else if (presetSource === mappedSource) {
					// Mapped source match - fully compatible
					allPresets.compatible.push(x);
				} else if (presetSource && extensionSettings.selectedProfileApi && presetSource !== extensionSettings.selectedProfileApi) {
					// Different sources - potentially incompatible
					allPresets.incompatible.push(x);
				} else {
					// Unknown compatibility - questionable
					allPresets.questionable.push(x);
				}
			}
			debug('categorized presets', allPresets);
		} else {
			// For non-Chat Completion modes, all presets are compatible
			const presetManager = ctx.getPresetManager('textgenerationwebui');
			const presetNames = presetManager.getPresetList().preset_names;

			let validPresetNames = presetNames;
			if (Array.isArray(presetNames)) validPresetNames = presetNames;
			else validPresetNames = Object.keys(validPresetNames);
			
			allPresets.compatible = validPresetNames;
		}
	} catch (error) {
		console.error('Error categorizing completion presets:', error);
		// Fallback: return all presets as questionable
		try {
			const ctx = getContext();
			const presetManager = extensionSettings.selectedProfileMode === "cc" 
				? ctx.getPresetManager('openai') 
				: ctx.getPresetManager('textgenerationwebui');
			const presetNames = presetManager.getPresetList().preset_names;
			const validPresetNames = Array.isArray(presetNames) ? presetNames : Object.keys(presetNames);
			allPresets.questionable = validPresetNames;
		} catch (fallbackError) {
			console.error('Fallback preset loading also failed:', fallbackError);
		}
	}

	return allPresets;
}

function updateCompletionPresetsDropdown() {
	const completionPresetsSelect = $("#tracker_enhanced_completion_preset");
	const categorizedPresets = getCompletionPresets();
	debug("categorized completion presets", categorizedPresets);
	completionPresetsSelect.empty();
	completionPresetsSelect.append($("<option>").val("current").text("Use connection profile default"));
	
	// Function to add presets with indicators
	const addPresetOptions = (presets, compatibility) => {
		for (const presetName of presets) {
			const formattedName = formatPresetName(presetName, compatibility);
			const option = $("<option>").val(presetName).text(formattedName);
			if (presetName === extensionSettings.selectedCompletionPreset) {
				option.attr("selected", "selected");
			}
			completionPresetsSelect.append(option);
		}
	};
	
	// Add presets in order of compatibility
	addPresetOptions(categorizedPresets.compatible, 'compatible');
	addPresetOptions(categorizedPresets.questionable, 'questionable');
	addPresetOptions(categorizedPresets.incompatible, 'incompatible');
}

function onCompletionPresetSelectChange() {
	const selectedCompletionPreset = $(this).val();
	extensionSettings.selectedCompletionPreset = selectedCompletionPreset;

	debug("Selected completion preset:", { selectedCompletionPreset, extensionSettings });

	setSettingsInitialValues();
	saveSettingsDebounced();
}

// #endregion

// #region Preset Management

/**
 * Updates the presets dropdown with the available presets.
 */
function updatePresetDropdown() {
	const presetSelect = $("#tracker_enhanced_preset_select");
	presetSelect.empty();
	const autoLabel = t("settings.presets.option.auto", "Auto (Follow SillyTavern Language)");
	const autoOption = $("<option>").val(AUTO_PRESET_OPTION).text(autoLabel);
	autoOption.attr("data-base-label", autoLabel);
	presetSelect.append(autoOption);

	const presetNames = Object.keys(extensionSettings.presets || {}).sort((a, b) =>
		a.localeCompare(b, undefined, { sensitivity: "base" })
	);

	for (const presetName of presetNames) {
		const option = $("<option>").val(presetName).text(presetName);
		option.attr("data-base-label", presetName);
		presetSelect.append(option);
	}

	let targetValue = extensionSettings.presetAutoMode ? AUTO_PRESET_OPTION : extensionSettings.selectedPreset;
	if (targetValue !== AUTO_PRESET_OPTION) {
		const hasPreset = targetValue && Object.prototype.hasOwnProperty.call(extensionSettings.presets || {}, targetValue);
		if (!hasPreset) {
			targetValue = presetNames[0] || AUTO_PRESET_OPTION;
		}
	}

	presetSelect.val(targetValue || AUTO_PRESET_OPTION);
	refreshPresetOptionLabels();
}

/**
 * Event handler for changing the selected preset.
 */
function onPresetSelectChange() {
	const selectedPreset = $(this).val();
	if (!selectedPreset) {
		return;
	}

	if (selectedPreset === AUTO_PRESET_OPTION) {
		extensionSettings.presetAutoMode = true;
		reapplyAutoPreset({ force: true });
		return;
	}

	extensionSettings.presetAutoMode = false;
	lastAutoResolvedPresetName = null;

	const legacySnapshot = getLegacyPresetSnapshot(selectedPreset);
	if (legacySnapshot) {
		const fallbackPreset =
			(lastAppliedPresetName && extensionSettings.presets[lastAppliedPresetName] && lastAppliedPresetName) ||
			(activePresetName && extensionSettings.presets[activePresetName] && activePresetName) ||
			(Object.prototype.hasOwnProperty.call(extensionSettings.presets, DEFAULT_PRESET_NAME) ? DEFAULT_PRESET_NAME : Object.keys(extensionSettings.presets)[0]);
		if (fallbackPreset) {
			$(this).val(fallbackPreset);
		}
		refreshPresetOptionLabels();
		if (typeof toastr !== "undefined") {
			const message = t(
				"settings.presets.toast.legacyReadOnly",
				"This preset uses an older schema. Previewing it in read-only mode instead."
			);
			const toastTitle = t("settings.presets.toast.legacy_view_title", "Legacy Tracker Preset");
			toastr.info(message, toastTitle);
		}
		if (legacySnapshot.preset) {
			legacyPresetViewer.show(selectedPreset, legacySnapshot.preset, legacySnapshot);
		} else {
			warn("Legacy preset missing payload", { preset: selectedPreset });
		}
		return;
	}

	applyPreset(selectedPreset);
}

function applyPreset(presetName) {
	const presetSettings = extensionSettings.presets[presetName];
	if (!presetSettings) {
		warn("Preset selection ignored because preset was not found", { presetName });
		return;
	}
	extensionSettings.selectedPreset = presetName;
	const presetClone = deepClone(presetSettings);
	Object.assign(extensionSettings, presetClone);
	debug("Selected preset:", { presetName, presetClone });
	setSettingsInitialValues();
	saveSettingsDebounced();
}

/**
 * Event handler for creating a new preset.
 */
function onPresetNewClick() {
	const promptMessage = t("settings.presets.prompt.new", "Enter a name for the new preset:");
	const rawName = prompt(promptMessage);
	const presetName = rawName ? rawName.trim() : "";
	if (!presetName) {
		return;
	}
	if (isBuiltInPresetName(presetName)) {
		if (typeof toastr !== "undefined") {
			toastr.error(
				t(
					"settings.presets.error.builtinReserved",
					"Built-in preset names are reserved. Choose a unique name for your custom preset."
				)
			);
		} else {
			alert(
				t(
					"settings.presets.error.builtinReserved",
					"Built-in preset names are reserved. Choose a unique name for your custom preset."
				)
			);
		}
		return;
	}
	if (!extensionSettings.presets[presetName]) {
		const newPreset = deepClone(getCurrentPresetSettings());
		extensionSettings.presets[presetName] = newPreset;
		extensionSettings.selectedPreset = presetName;
		extensionSettings.presetAutoMode = false;
		updatePresetDropdown();
		refreshPresetBaseline();
		updatePresetDirtyState();
		saveSettingsDebounced();
		const messageTemplate = t(
			"settings.presets.success.created",
			'Tracker Enhanced preset "{{name}}" created.'
		);
		toastr.success(messageTemplate.replace("{{name}}", presetName));
	} else if (extensionSettings.presets[presetName]) {
		alert(
			t(
				"settings.presets.error.duplicateName",
				"A preset with that name already exists."
			)
		);
	}
}

/**
 * Event handler for creating a new preset.
 */
function onPresetSaveClick() {
	const originalPresetName = extensionSettings.selectedPreset;
	const duplicated = ensureEditablePreset({ forceDuplicate: true });
	const presetName = extensionSettings.selectedPreset;
	const updatedPreset = getCurrentPresetSettings();
	extensionSettings.presets[presetName] = deepClone(updatedPreset);
	refreshPresetBaseline();
	updatePresetDirtyState();
	saveSettingsDebounced();
	if (duplicated && presetName !== originalPresetName) {
		const messageTemplate = t(
			"settings.presets.success.savedFromOriginal",
			'Tracker Enhanced preset "{{name}}" created from "{{original}}" and saved.'
		);
		toastr.success(
			messageTemplate.replace("{{name}}", presetName).replace("{{original}}", originalPresetName)
		);
	} else {
		const messageTemplate = t(
			"settings.presets.success.saved",
			'Tracker Enhanced preset "{{name}}" saved.'
		);
		toastr.success(messageTemplate.replace("{{name}}", presetName));
	}
}

/**
 * Event handler for renaming an existing preset.
 */
function onPresetRenameClick() {
	const oldName = $("#tracker_enhanced_preset_select").val();
	if (!oldName) {
		toastr.error(t("settings.presets.error.renameNoneSelected", "No preset selected for renaming."));
		return;
	}
	if (isBuiltInPresetName(oldName)) {
		toastr.error(t("settings.presets.error.renameBuiltIn", "Built-in presets cannot be renamed."));
		return;
	}
	
	const promptMessage = t("settings.presets.prompt.rename", "Enter the new name for the preset:");
	const newNameInput = prompt(promptMessage, oldName);
	const newName = newNameInput ? newNameInput.trim() : "";
	if (!newName || newName === oldName) {
		return;
	}
	if (isBuiltInPresetName(newName)) {
		toastr.error(
			t(
				"settings.presets.error.renameReserved",
				"Built-in preset names are reserved. Choose a different name."
			)
		);
		return;
	}
	if (!extensionSettings.presets[newName]) {
		extensionSettings.presets[newName] = extensionSettings.presets[oldName];
		delete extensionSettings.presets[oldName];
		if (extensionSettings.selectedPreset === oldName) {
			extensionSettings.selectedPreset = newName;
		}
		updatePresetDropdown();
		refreshPresetBaseline();
		updatePresetDirtyState();
		saveSettingsDebounced();
		const messageTemplate = t(
			"settings.presets.success.renamed",
			'Tracker Enhanced preset "{{oldName}}" renamed to "{{newName}}".'
		);
		toastr.success(
			messageTemplate.replace("{{oldName}}", oldName).replace("{{newName}}", newName)
		);
	} else if (extensionSettings.presets[newName]) {
		alert(
			t(
				"settings.presets.error.duplicateName",
				"A preset with that name already exists."
			)
		);
	}
}

/**
 * Event handler for renaming an existing preset.
 */
function onPresetRestoreClick() {
	const presetName = extensionSettings.selectedPreset;
	applyPreset(presetName);
	const messageTemplate = t(
		"settings.presets.success.restored",
		'Tracker Enhanced preset "{{name}}" restored.'
	);
	toastr.success(messageTemplate.replace("{{name}}", presetName));
}

/**
 * Event handler for deleting a preset.
 */
function onPresetDeleteClick() {
	const presetName = $("#tracker_enhanced_preset_select").val();
	if (!presetName) {
		toastr.error(t("settings.presets.error.deleteNoneSelected", "No preset selected for deletion."));
		return;
	}
	if (isBuiltInPresetName(presetName)) {
		toastr.error(t("settings.presets.error.deleteBuiltIn", "Built-in presets cannot be deleted."));
		return;
	}
	
	const confirmTemplate = t(
		"settings.presets.confirm.delete",
		'Are you sure you want to delete the preset "{{name}}"?'
	);
	const confirmMessage = confirmTemplate.replace("{{name}}", presetName);
	if (confirm(confirmMessage)) {
		delete extensionSettings.presets[presetName];
		
		// Select the first available preset or create a default one
		const remainingPresets = Object.keys(extensionSettings.presets);
		if (remainingPresets.length > 0) {
			extensionSettings.selectedPreset = remainingPresets[0];
		} else {
			// Create a default preset if none exist
			extensionSettings.presets["Default"] = getCurrentPresetSettings();
			extensionSettings.selectedPreset = "Default";
		}
		
		updatePresetDropdown();
		onPresetSelectChange.call($("#tracker_enhanced_preset_select"));
		const messageTemplate = t(
			"settings.presets.success.deleted",
			'Tracker Enhanced preset "{{name}}" deleted.'
		);
		toastr.success(messageTemplate.replace("{{name}}", presetName));
	}
}

/**
 * Event handler for exporting a preset.
 */
function exportPresetByName(presetName, options = {}) {
	const allowLegacy = options.allowLegacy !== false;
	const silent = options.silent === true;
	if (!presetName) {
		if (!silent && typeof toastr !== "undefined") {
			toastr.error(t("settings.presets.export.error.none", "No preset selected for export."));
		}
		return false;
	}

	const presetData = extensionSettings.presets[presetName];
	const legacySnapshot = !presetData && allowLegacy ? getLegacyPresetSnapshot(presetName) : null;
	let exportPresetName = presetName;
	let exportPayload = null;
	let exportKind = "valid";

	if (presetData) {
		exportPayload = deepClone(presetData);
		if (isBuiltInPresetName(presetName)) {
			const suffix = t("settings.presets.copySuffix", "copy");
			const baseName = `${presetName} (${suffix})`;
			exportPresetName = ensureUniquePresetName(baseName, extensionSettings.presets);
		}
	} else if (legacySnapshot && legacySnapshot.preset) {
		exportKind = "legacy";
		exportPayload = deepClone(legacySnapshot.preset);
		if (!exportPresetName.endsWith(LEGACY_EXPORT_SUFFIX)) {
			exportPresetName = `${exportPresetName}${LEGACY_EXPORT_SUFFIX}`;
		}
	} else {
		if (!silent && typeof toastr !== "undefined") {
			toastr.error(t("settings.presets.export.error.missing", `Preset "${presetName}" not found.`));
		}
		return false;
	}

	try {
		const dataStr = JSON.stringify({ [exportPresetName]: exportPayload }, null, 2);
		const blob = new Blob([dataStr], { type: "application/json" });
		const url = URL.createObjectURL(blob);

		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = `${exportPresetName}.json`;
		document.body.appendChild(anchor);
		anchor.click();
		document.body.removeChild(anchor);
		URL.revokeObjectURL(url);
		if (!silent && typeof toastr !== "undefined") {
			const toastTitle = t("settings.presets.export.toastTitle", "Tracker Enhanced Export");
			if (exportKind === "legacy") {
				toastr.info(
					t("settings.presets.export.success.legacy", `Legacy preset "{{name}}" exported as "{{exportName}}".`)
						.replace("{{name}}", presetName)
						.replace("{{exportName}}", exportPresetName),
					toastTitle
				);
			} else if (exportPresetName !== presetName) {
				toastr.success(
					t("settings.presets.export.success.renamed", `Preset "{{name}}" exported as "{{exportName}}".`)
						.replace("{{name}}", presetName)
						.replace("{{exportName}}", exportPresetName),
					toastTitle
				);
			} else {
				toastr.success(
					t("settings.presets.export.success.standard", `Preset "{{name}}" exported successfully.`).replace("{{name}}", presetName),
					toastTitle
				);
			}
		}
		debug("Preset export completed", { presetName, exportPresetName, exportKind });
		return true;
	} catch (err) {
		error("Failed to export preset", err);
		if (!silent && typeof toastr !== "undefined") {
			toastr.error(t("settings.presets.export.error.failed", "Failed to export preset. Check console for details."));
		}
		return false;
	}
}

function onPresetExportClick() {
	const presetName = $("#tracker_enhanced_preset_select").val();
	exportPresetByName(presetName);
}

/**
 * Event handler for clicking the import button.
 */
function onPresetImportButtonClick() {
	$("#tracker_enhanced_preset_import").click();
}

/**
 * Event handler for importing presets from a file.
 * @param {Event} event The change event from the file input.
 */
function onPresetImportChange(event) {
	const file = event.target.files[0];
	if (!file) return;

	const inputElement = event.target;
	const reader = new FileReader();
	reader.onload = function (e) {
		try {
			const importedPresets = JSON.parse(e.target.result);

			migrateIsDynamicToPresence(importedPresets);
			if (!importedPresets || typeof importedPresets !== "object" || Array.isArray(importedPresets)) {
				throw new Error(
					t("settings.presets.import.error.invalidPayload", "Preset file must contain an object map.")
				);
			}
			const timestamp = new Date();
			const canonicalOptions = { canonicalMap: getCanonicalTrackerMap() };
			const legacyStore = normalizeLegacyPresetStore(extensionSettings.legacyPresets);
			const legacyNameSet = new Set([
				...Object.keys(extensionSettings.presets || {}),
				...Object.keys(legacyStore),
			]);
			const isoTimestamp = timestamp.toISOString();
			const skippedBuiltIns = [];
			const importedPresetsList = [];
			let firstImportedPreset = null;
			const quarantinedPresets = [];

			for (const [presetName, presetValue] of Object.entries(importedPresets || {})) {
				if (isBuiltInPresetName(presetName)) {
					skippedBuiltIns.push(presetName);
					continue;
				}

				if (extensionSettings.presets[presetName]) {
					const overwriteMessage = t(
						"settings.presets.import.confirmOverwrite",
						`Preset "${presetName}" already exists. Overwrite?`
					).replace("{{name}}", presetName);
					if (!confirm(overwriteMessage)) {
						continue;
					}
				}

				const analysis = analyzePresetSnapshot(presetName, presetValue, canonicalOptions);
				if (analysis.isLegacy) {
					const legacyLabel = generateLegacyPresetName(presetName, legacyNameSet, { timestamp });
					legacyNameSet.add(legacyLabel);
					legacyStore[legacyLabel] = {
						originalName: presetName,
						quarantinedAt: isoTimestamp,
						reasons: analysis.reasons,
						preset: deepClone(presetValue),
					};
					quarantinedPresets.push({ originalName: presetName, legacyLabel });
					continue;
				}

				const normalizedSnapshot = analysis.normalizedSnapshot || deepClone(presetValue);
				extensionSettings.presets[presetName] = normalizedSnapshot;
				importedPresetsList.push(presetName);
				if (!firstImportedPreset) {
					firstImportedPreset = presetName;
				}
				legacyNameSet.add(presetName);
			}

			extensionSettings.legacyPresets = legacyStore;
			refreshLegacyPresetManager();

			let quarantineSummary = null;
			if (importedPresetsList.length || quarantinedPresets.length) {
				quarantineSummary = quarantineExtensionPresets({ timestamp });
				announcePresetQuarantine(quarantineSummary, { context: "import" });
			}

			let appliedPresetName = null;
			if (importedPresetsList.length) {
				const presetCandidate =
					importedPresetsList.find((name) => Object.prototype.hasOwnProperty.call(extensionSettings.presets, name)) ||
					(firstImportedPreset && Object.prototype.hasOwnProperty.call(extensionSettings.presets, firstImportedPreset)
						? firstImportedPreset
						: null);
				if (presetCandidate) {
					applyPreset(presetCandidate);
					appliedPresetName = presetCandidate;
				}
			}

			updatePresetDropdown();
			saveSettingsDebounced();

			debug("Preset import completed", {
				imported: importedPresetsList,
				quarantined: quarantinedPresets,
				skippedBuiltIns,
			});

			if (typeof toastr !== "undefined") {
				if (skippedBuiltIns.length > 0) {
					const toastTitle = t("settings.presets.import.toastTitle", "Tracker Enhanced Import");
					const messageTemplate = t(
						"settings.presets.import.toast.skippedBuiltIns",
						"Skipped built-in preset names: {{names}}."
					);
					toastr.warning(
						messageTemplate.replace("{{names}}", skippedBuiltIns.join(", ")),
						toastTitle
					);
				}
				if (importedPresetsList.length || quarantinedPresets.length) {
					const parts = [];
					if (importedPresetsList.length) {
						const importedTemplate = t(
							"settings.presets.import.toast.imported_count",
							"Imported {{count}} preset{{plural}}."
						);
						const count = importedPresetsList.length;
						const pluralSuffix = count === 1 ? "" : "s";
						parts.push(importedTemplate.replace("{{count}}", String(count)).replace("{{plural}}", pluralSuffix));
					}
					if (quarantinedPresets.length) {
						const quarantinedTemplate = t(
							"settings.presets.import.toast.quarantined_count",
							"Quarantined {{count}} legacy preset{{plural}}."
						);
						const count = quarantinedPresets.length;
						const pluralSuffix = count === 1 ? "" : "s";
						parts.push(
							quarantinedTemplate.replace("{{count}}", String(count)).replace("{{plural}}", pluralSuffix)
						);
					}
					if (appliedPresetName) {
						const appliedTemplate = t(
							"settings.presets.import.toast.applied",
							"Applied preset \"{{name}}\" immediately."
						);
						parts.push(appliedTemplate.replace("{{name}}", appliedPresetName));
					}
					let toastMessage = parts.join(" ");
					const toastTitle = t("settings.presets.import.toastTitle", "Tracker Enhanced Import");
					let toastOptions = { escapeHtml: false, closeButton: true };
					let toastInstance = null;
					let highlightLabel = null;
					if (quarantinedPresets.length) {
						const actionLabel = t("settings.presets.legacy.toastAction", "View legacy presets");
						toastMessage = `${toastMessage}<br><button type="button" class="tracker-legacy-toast-button" data-action="view-legacy">${actionLabel}</button>`;
						highlightLabel = quarantinedPresets[0]?.legacyLabel || null;
					}
					if (importedPresetsList.length) {
						toastInstance = toastr.success(toastMessage, toastTitle, toastOptions);
					} else {
						toastInstance = toastr.info(toastMessage, toastTitle, toastOptions);
					}
					if (toastInstance && highlightLabel) {
						attachLegacyToastAction(toastInstance, { highlightLabel });
					}
				} else if (skippedBuiltIns.length === 0) {
					const toastTitle = t("settings.presets.import.toastTitle", "Tracker Enhanced Import");
					toastr.info(
						t("settings.presets.import.toast.noneImported", "No presets were imported."),
						toastTitle
					);
				}
			}
		} catch (err) {
			error("Failed to import presets", err);
			const messageTemplate = t(
				"settings.presets.import.alert.failed",
				"Failed to import presets: {{error}}"
			);
			alert(messageTemplate.replace("{{error}}", err.message));
		}
	};
	reader.onloadend = function () {
		if (inputElement) {
			inputElement.value = "";
		}
	};
	reader.readAsText(file);
}

/**
 * Retrieves the current settings to save as a preset.
 * @returns {Object} The current preset settings.
 */
function getCurrentPresetSettings() {
	return {
		generateContextTemplate: extensionSettings.generateContextTemplate,
		generateSystemPrompt: extensionSettings.generateSystemPrompt,
		generateRequestPrompt: extensionSettings.generateRequestPrompt,
		participantGuidanceTemplate: extensionSettings.participantGuidanceTemplate,
		generateRecentMessagesTemplate: extensionSettings.generateRecentMessagesTemplate,
		generateRecentMessageEntryTemplate: extensionSettings.generateRecentMessageEntryTemplate,
		includeTrackersInRecentMessages: extensionSettings.includeTrackersInRecentMessages === true,
		roleplayPrompt: extensionSettings.roleplayPrompt,
		characterDescriptionTemplate: extensionSettings.characterDescriptionTemplate,
		mesTrackerTemplate: extensionSettings.mesTrackerTemplate,
		mesTrackerJavascript: extensionSettings.mesTrackerJavascript,
		automationTarget: extensionSettings.automationTarget,
		participantTarget: extensionSettings.participantTarget,
		showPopupFor: extensionSettings.showPopupFor,
		trackerFormat: extensionSettings.trackerFormat,
		numberOfMessages: extensionSettings.numberOfMessages,
		generateFromMessage: extensionSettings.generateFromMessage,
		minimumDepth: extensionSettings.minimumDepth,
		responseLength: extensionSettings.responseLength,
		devToolsEnabled: extensionSettings.devToolsEnabled,
		debugMode: extensionSettings.debugMode,
		trackerInjectionEnabled: extensionSettings.trackerInjectionEnabled,
		toolbarIndicatorEnabled: extensionSettings.toolbarIndicatorEnabled,
		trackerDef: extensionSettings.trackerDef,
	};
}

// #endregion

// #region Setting Change Handlers

/**
 * Returns a function to handle checkbox input changes for a given setting.
 * @param {string} settingName The name of the setting.
 * @returns {Function} The event handler function.
 */
function onSettingCheckboxInput(settingName, options = {}) {
	const trackPreset = options.trackPreset !== false;
	return function () {
		const value = Boolean($(this).prop("checked"));
		extensionSettings[settingName] = value;
		if (trackPreset) {
			handleSettingsMutation();
		} else {
			saveSettingsDebounced();
		}
	};
}

/**
 * Returns a function to handle select input changes for a given setting.
 * @param {string} settingName The name of the setting.
 * @returns {Function} The event handler function.
 */
function onSettingSelectChange(settingName) {
	return function () {
		const value = $(this).val();
		extensionSettings[settingName] = value;
		if (settingName === "automationTarget") {
			updatePopupDropdown();
		}
		handleSettingsMutation();
	};
}

/**

 * Returns a function to handle textarea input changes for a given setting.
 * @param {string} settingName The name of the setting.
 * @returns {Function} The event handler function.
 */
function onSettingInputareaInput(settingName) {
	return function () {
		const value = $(this).val();
		extensionSettings[settingName] = value;
		if (settingName === "mesTrackerJavascript") {
			processTrackerJavascript();
		}
		handleSettingsMutation();
	};
}

/**
 * Processes and validates the user-provided JavaScript for mesTrackerJavascript,
 * ensuring optional init and cleanup functions are handled correctly.
 */
function processTrackerJavascript() {
    try {
        const scriptContent = extensionSettings.mesTrackerJavascript;

        // Parse user input as a function and execute it
        const parsedFunction = new Function(`return (${scriptContent})`)();

        let parsedObject;
        if (typeof parsedFunction === "function") {
            parsedObject = parsedFunction(); // Call the function to get the object
        } else if (typeof parsedFunction === "object" && parsedFunction !== null) {
            parsedObject = parsedFunction;
        }

        // Ensure the final result is an object
        if (typeof parsedObject === "object" && parsedObject !== null) {
            // Call cleanup function of the existing tracker before replacing it
            if (SillyTavern.trackerEnhanced && typeof SillyTavern.trackerEnhanced.cleanup === "function") {
                try {
                    SillyTavern.trackerEnhanced.cleanup();
                    debug("Previous tracker enhanced cleaned up successfully.");
                } catch (cleanupError) {
                    error("Error during tracker enhanced cleanup:", cleanupError);
                }
            }

            // Assign the new tracker object
            SillyTavern.trackerEnhanced = parsedObject;

            // Call init function only if both init and cleanup exist
            if (
                typeof SillyTavern.trackerEnhanced.init === "function" &&
                typeof SillyTavern.trackerEnhanced.cleanup === "function"
            ) {
                try {
                    SillyTavern.trackerEnhanced.init();
                    debug("Tracker enhanced initialized successfully.");
                } catch (initError) {
                    error("Error initializing tracker enhanced:", initError);
                }
            }

            debug("Custom tracker enhanced functions updated:", SillyTavern.trackerEnhanced);
        }
    } catch (err) {
		debug("Error processing tracker JavaScript:", err);
        SillyTavern.trackerEnhanced = {};
    }
}


/**
 * Returns a function to handle number input changes for a given setting.
 * @param {string} settingName The name of the setting.
 * @returns {Function} The event handler function.
 */
function onSettingNumberInput(settingName) {
	return function () {
		let value = parseFloat($(this).val());
		if (isNaN(value)) {
			value = 0;
		}

		if(settingName == "numberOfMessages" && value < 1) {
			value = 1; 
			$(this).val(1);
		}
		extensionSettings[settingName] = value;
		handleSettingsMutation();
	};
}

/**
 * Event handler for clicking the Tracker Prompt Maker button.
 */
function onTrackerPromptMakerClick() {
	const modal = new TrackerPromptMakerModal();
	modal.show(extensionSettings.trackerDef, (updatedTracker) => {
		extensionSettings.trackerDef = updatedTracker;
		handleSettingsMutation();
	});
}

/**
 * Event handler for clicking the Generate Template button.
 */
function onGenerateTemplateClick() {
	try {
		if (typeof debug === 'function') {
			debug('Generate Template clicked. Current trackerDef:', extensionSettings.trackerDef);
		}
		
		// Check if trackerDef exists and has fields
		if (!extensionSettings.trackerDef || Object.keys(extensionSettings.trackerDef).length === 0) {
			const message = t(
				"settings.generation.error.noFields",
				"No tracker fields defined. Please use the Prompt Maker to define fields first."
			);
			const toastTitle = t("settings.generation.template.toastTitle", "Template Generation");
			toastr.warning(message, toastTitle);
			return;
		}

		// Generate the template
		const templateGenerator = new TrackerTemplateGenerator();
		const generatedTemplate = templateGenerator.generateTableTemplate(extensionSettings.trackerDef);
		
		if (typeof debug === 'function') {
			debug('Generated template result:', generatedTemplate);
		}
		
		// Update the textarea and extension settings
		$("#tracker_enhanced_mes_tracker_template").val(generatedTemplate);
		extensionSettings.mesTrackerTemplate = generatedTemplate;
		
		// Save settings
		handleSettingsMutation();
		
		// Show success message
		const successMessage = t(
			"settings.generation.template.success",
			"Template generated successfully from your Prompt Maker fields!"
		);
		const toastTitle = t("settings.generation.template.toastTitle", "Template Generation");
		toastr.success(successMessage, toastTitle);
		
		if (typeof debug === 'function') {
			debug('Template generation completed successfully');
		}
		
	} catch (error) {
		console.error('Failed to generate template:', error);
		const errorMessage = t(
			"settings.generation.template.error",
			"Failed to generate template. Check console for details."
		);
		const toastTitle = t("settings.generation.template.toastTitle", "Template Generation");
		toastr.error(errorMessage, toastTitle);
	}
}

/**
 * Event handler for clicking the Generate JavaScript button.
 */
function onGenerateJavaScriptClick() {
	try {
		if (typeof debug === 'function') {
			debug('Generate JavaScript clicked. Current trackerDef:', extensionSettings.trackerDef);
		}
		
		// Check if trackerDef exists and has fields
		if (!extensionSettings.trackerDef || Object.keys(extensionSettings.trackerDef).length === 0) {
			const message = t(
				"settings.generation.error.noFields",
				"No tracker fields defined. Please use the Prompt Maker to define fields first."
			);
			const toastTitle = t("settings.generation.javascript.toastTitle", "JavaScript Generation");
			toastr.warning(message, toastTitle);
			return;
		}

		// Generate the JavaScript
		const jsGenerator = new TrackerJavaScriptGenerator();
		const generatedJS = jsGenerator.generateJavaScript(extensionSettings.trackerDef);
		
		if (typeof debug === 'function') {
			debug('Generated JavaScript result:', generatedJS);
		}
		
		// Update the textarea and extension settings
		$("#tracker_enhanced_mes_tracker_javascript").val(generatedJS);
		extensionSettings.mesTrackerJavascript = generatedJS;
		
		// Save settings
		handleSettingsMutation();
		
		// Show success message
		const successMessage = t(
			"settings.generation.javascript.success",
			"JavaScript generated successfully with gender-specific field hiding!"
		);
		const toastTitle = t("settings.generation.javascript.toastTitle", "JavaScript Generation");
		toastr.success(successMessage, toastTitle);
		
		if (typeof debug === 'function') {
			debug('JavaScript generation completed successfully');
		}
		
	} catch (error) {
		console.error('Failed to generate JavaScript:', error);
		const errorMessage = t(
			"settings.generation.javascript.error",
			"Failed to generate JavaScript. Check console for details."
		);
		const toastTitle = t("settings.generation.javascript.toastTitle", "JavaScript Generation");
		toastr.error(errorMessage, toastTitle);
	}
}

/**
 * Event handler for resetting the tracker prompts to default.
 */
function onTrackerPromptResetClick() {
    let resetButton = $("#tracker_enhanced_reset_presets");
    let resetLabel = resetButton.parent().find("label");

    if (!resetLabel.length) {
        // If no label found, create one temporarily
        resetLabel = $("<label>").insertBefore(resetButton);
    }

    resetLabel.text(t("settings.reset.confirmationHint", "Click again to confirm"));

    // Remove the current click event to avoid duplicate bindings
    resetButton.off("click");

    // Set a timeout to restore the original behavior after 60 seconds
    let timeoutId = setTimeout(() => {
        resetLabel.text("");
        resetButton.off("click").on("click", onTrackerPromptResetClick);
    }, 60000);

    // Bind the second-click event to reset presets
	resetButton.one("click", async () => {
        clearTimeout(timeoutId); // Clear the timeout to prevent reverting behavior

		debug("Resetting Tracker Enhanced extension defaults while preserving connection and UI settings.");

		try {
			const defaultsClone = deepClone(defaultSettings);
			const preservedSettings = {
				enabled: extensionSettings.enabled,
				selectedProfile: extensionSettings.selectedProfile,
				selectedCompletionPreset: extensionSettings.selectedCompletionPreset,
				languageOverride: extensionSettings.languageOverride,
			};

			const existingPresets = extensionSettings.presets || {};
			const customPresets = {};
			for (const [name, preset] of Object.entries(existingPresets)) {
				if (!isBuiltInPresetName(name)) {
					customPresets[name] = deepClone(preset);
				}
			}
			const preservedLegacyPresets = extensionSettings.legacyPresets ? deepClone(extensionSettings.legacyPresets) : {};

			Object.assign(extensionSettings, defaultsClone);
			await ensureLocalePresetsRegistered({ force: true });
			Object.assign(extensionSettings, preservedSettings);
			extensionSettings.legacyPresets = preservedLegacyPresets;
			refreshLegacyPresetManager();
			extensionSettings.presets = {
				...extensionSettings.presets,
				...customPresets,
			};
			const quarantineSummary = quarantineExtensionPresets({ timestamp: new Date() });
			announcePresetQuarantine(quarantineSummary, { context: "reset" });
			let presetApplied = false;
			if (extensionSettings.presetAutoMode) {
				const resolved = reapplyAutoPreset({ force: true });
				presetApplied = Boolean(resolved);
			} else {
				let resolvedPreset = extensionSettings.selectedPreset;
				if (!resolvedPreset || !Object.prototype.hasOwnProperty.call(extensionSettings.presets, resolvedPreset)) {
					resolvedPreset = Object.prototype.hasOwnProperty.call(extensionSettings.presets, DEFAULT_PRESET_NAME)
						? DEFAULT_PRESET_NAME
						: Object.keys(extensionSettings.presets)[0] || null;
				}
				if (resolvedPreset) {
					applyPreset(resolvedPreset);
					presetApplied = true;
				}
			}

			if (!presetApplied) {
				setSettingsInitialValues();
			}
			processTrackerJavascript();
			
			// Save the reset settings
			saveSettingsDebounced();
			
			toastr.success(
				t("settings.reset.success", "Defaults restored. Custom presets and backups were preserved.")
			);
			
		} catch (error) {
			console.error("Failed to reset settings:", error);
			toastr.error(
				t("settings.reset.error", "Failed to reset settings. Check console for details.")
			);
		}

        // Restore the original behavior
		resetLabel.text("");
		resetButton.off("click").on("click", onTrackerPromptResetClick);
    });
}

// #endregion

// #region Field Visibility Management

/**
 * Updates the visibility of fields based on the selected generation mode.
 * @param {string} mode The current generation mode.
 */
// #endregion

// #region Popup Options Management

/**
 * Updates the popup for dropdown with the available values.
 */
function updatePopupDropdown() {
	const showPopupForSelect = $("#tracker_enhanced_show_popup_for");
	const availablePopupOptions = [];
	const automationTargetDefault = getDefaultPresetValue("automationTarget", automationTargets.BOTH);
	const automationTarget = extensionSettings.automationTarget ?? automationTargetDefault;
	switch (automationTarget) {
		case automationTargets.CHARACTER:
			availablePopupOptions.push(automationTargets.USER);
			availablePopupOptions.push(automationTargets.NONE);
			break;
		case automationTargets.USER:
			availablePopupOptions.push(automationTargets.CHARACTER);
			availablePopupOptions.push(automationTargets.NONE);
			break;
		case automationTargets.BOTH:
			availablePopupOptions.push(automationTargets.NONE);
			break;
		case automationTargets.NONE:
			availablePopupOptions.push(automationTargets.BOTH);
			availablePopupOptions.push(automationTargets.USER);
			availablePopupOptions.push(automationTargets.CHARACTER);
			availablePopupOptions.push(automationTargets.NONE);
			break;
	}

	if(!availablePopupOptions.includes(extensionSettings.showPopupFor)) {
		extensionSettings.showPopupFor = automationTargets.NONE;
		saveSettingsDebounced();
	}

	showPopupForSelect.empty();
	for (const popupOption of availablePopupOptions) {
		const text = t(targetOptionLabelKeys[popupOption] || popupOption, toTitleCase(popupOption));
		const option = $("<option>").val(popupOption).text(text);
		if (popupOption === extensionSettings.showPopupFor) {
			option.attr("selected", "selected");
		}
		showPopupForSelect.append(option);
	}
}

// #endregion
