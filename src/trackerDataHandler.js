import { chat, saveChatDebounced } from "../../../../../script.js";
import { debug, warn } from "../lib/utils.js";
import { buildTimeAnalysis } from "../lib/timeManager.js";
import { runFertilityEngine } from "../lib/fertilityEngine.js";

import { jsonToYAML, yamlToJSON } from "../lib/ymlParser.js";
import {
	getExistingFieldKey,
	getFieldId,
	getFieldLabel,
	resolveTrackerValue,
	deleteFieldFromNode,
} from "../lib/fieldIdentity.js";
import { TrackerPreviewManager } from "./ui/trackerPreviewManager.js";

export { getFieldId, getFieldLabel } from "../lib/fieldIdentity.js";

export const FIELD_INCLUDE_OPTIONS = {
	DYNAMIC: "dynamic",
	STATIC: "static",
	ALL: "all",
};

export const OUTPUT_FORMATS = {
	JSON: "json",
	YAML: "yaml",
};

export const FIELD_PRESENCE_OPTIONS = {
	DYNAMIC: "DYNAMIC",
	STATIC: "STATIC",
};

const EXTRA_FIELD_WARNING_LIMIT = 12;
const extraFieldWarningCache = new Set();

// Handlers for different field types
const FIELD_TYPES_HANDLERS = {
	STRING: handleString,
	ARRAY: handleArray,
	OBJECT: handleObject,
	FOR_EACH_OBJECT: handleForEachObject,
	FOR_EACH_ARRAY: handleForEachArray,
	ARRAY_OBJECT: handleObject, // Treat ARRAY_OBJECT as OBJECT
};

/**
 * Saves the updated tracker data to the chat object.
 *
 * @param {Object} tracker - The new tracker data to be saved.
 * @param {Object} backendObj - The backend object used for retrieving and updating the tracker.
 * @param {string} mesId - The message ID used to locate the original tracker in the chat object.
 */
export function saveTracker(tracker, backendObj, mesId, useUpdatedExtraFieldsAsSource = false) {
	if (!Number.isInteger(mesId) || mesId < 0 || !chat[mesId]) {
		warn("saveTracker skipped due to invalid message reference", { mesId });
		return tracker;
	}

	const originalTracker = getTracker(chat[mesId].tracker, backendObj, FIELD_INCLUDE_OPTIONS.ALL, true, OUTPUT_FORMATS.JSON);
	const existingInternal = chat[mesId].trackerInternal ?? {};
	const previousAnalysis = existingInternal.TimeAnalysis ?? null;
	const internalOutput = {};
	let updatedTracker = updateTracker(
		originalTracker,
		tracker,
		backendObj,
		true,
		OUTPUT_FORMATS.JSON,
		useUpdatedExtraFieldsAsSource,
		internalOutput
	);

	let internalData = (internalOutput.data && typeof internalOutput.data === "object") ? internalOutput.data : {};
	debug("saveTracker internal collector before adjustments", { internalData, existingInternal });
	let anchorFromExisting = false;
	if (!internalData.TimeAnchor && existingInternal.TimeAnchor) {
		internalData.TimeAnchor = existingInternal.TimeAnchor;
		anchorFromExisting = true;
	}

	const anchorValue = internalData.TimeAnchor ?? existingInternal.TimeAnchor ?? updatedTracker?.TimeAnchor ?? null;
	let timeAnalysis = null;
	if (anchorValue) {
		if (anchorFromExisting && previousAnalysis) {
			timeAnalysis = previousAnalysis;
		} else {
			timeAnalysis = buildTimeAnalysis(anchorValue, previousAnalysis);
		}
	} else if (previousAnalysis) {
		timeAnalysis = previousAnalysis;
	}

	if (timeAnalysis) {
		internalData.TimeAnalysis = timeAnalysis;
	}

	const engineOutcome = runFertilityEngine({
		tracker: updatedTracker,
		previousTracker: originalTracker,
		currentInternal: internalData,
		previousInternal: existingInternal,
		timeAnalysis: internalData.TimeAnalysis ?? null,
		previousTimeAnalysis: existingInternal.TimeAnalysis ?? null,
		timeAnchor: internalData.TimeAnchor ?? anchorValue ?? null,
	});
	if (engineOutcome?.tracker) {
		updatedTracker = engineOutcome.tracker;
	}
	if (engineOutcome?.internalData && typeof engineOutcome.internalData === "object") {
		internalData = engineOutcome.internalData;
	}

	if (Object.keys(internalData).length > 0) {
		internalOutput.data = internalData;
		debug("saveTracker internal data prepared for storage", { internalData });
	} else {
		delete internalOutput.data;
	}

	if (updatedTracker && typeof updatedTracker === "object") {
		delete updatedTracker.TimeAnchor;
		delete updatedTracker.TimeAnalysis;
	}

	chat[mesId].tracker = updatedTracker;
	if (internalOutput.data && Object.keys(internalOutput.data).length > 0) {
		chat[mesId].trackerInternal = internalOutput.data;
		debug("saveTracker stored trackerInternal", { trackerInternal: chat[mesId].trackerInternal });
	} else {
		delete chat[mesId].trackerInternal;
	}

	saveChatDebounced();
	TrackerPreviewManager.updatePreview(mesId);

	return updatedTracker;
}

/**
 * Generates a default tracker using default values from the backendObject.
 * @param {Object} backendObject - The backend object defining the tracker structure.
 * @param {string} includeFields - Which fields to include ('dynamic', 'static', 'all').
 * @param {string} outputFormat - The desired output format ('json' or 'yaml').
 * @returns {Object|string} - The default tracker in the specified format.
 */
export function getDefaultTracker(backendObject, includeFields = FIELD_INCLUDE_OPTIONS.DYNAMIC, outputFormat = OUTPUT_FORMATS.JSON, participantSeeds = null) {
	const tracker = {};
	processFieldDefaults(backendObject, tracker, includeFields);
	const seededTracker = seedTrackerParticipants(tracker, backendObject, includeFields, participantSeeds);
	return formatOutput(seededTracker, outputFormat);
}

/**
 * Converts a tracker to match the backendObject structure, filling missing fields with defaults.
 * @param {Object|string} trackerInput - The tracker object or YAML string.
 * @param {Object} backendObject - The backend object defining the tracker structure.
 * @param {string} includeFields - Which fields to include ('dynamic', 'static', 'all').
 * @param {boolean} includeUnmatchedFields - Whether to include unmatched fields in '_extraFields'.
 * @param {string} outputFormat - The desired output format ('json' or 'yaml').
 * @returns {Object|string} - The reconciled tracker in the specified format.
 */
export function getTracker(trackerInput, backendObject, includeFields = FIELD_INCLUDE_OPTIONS.DYNAMIC, includeUnmatchedFields = true, outputFormat = OUTPUT_FORMATS.JSON) {
	debug("Getting tracker:", { trackerInput, backendObject, includeFields, includeUnmatchedFields, outputFormat });
	let tracker = typeof trackerInput === "string" ? yamlToJSON(trackerInput) : trackerInput;
	const reconciledTracker = {};
	let extraFields = {};

	reconcileTracker(tracker, backendObject, reconciledTracker, extraFields, includeFields);

	if (includeUnmatchedFields) {
		extraFields = cleanEmptyObjects(extraFields);
		const hasExtraObject = typeof extraFields === "object" && extraFields !== null && Object.keys(extraFields).length > 0;
		const hasExtraScalar = typeof extraFields === "string";
		if (hasExtraObject || hasExtraScalar) {
			emitExtraFieldWarning(extraFields, "getTracker");
			reconciledTracker._extraFields = extraFields;
		}
	}

	return formatOutput(reconciledTracker, outputFormat);
}

/**
 * Generates a tracker prompt string from the backendObject.
 * @param {Object} backendObject - The backend object defining the tracker structure.
 * @param {string} includeFields - Which fields to include ('dynamic', 'static', 'all').
 * @returns {string} - The tracker prompt string.
 */
export function getTrackerPrompt(backendObject, includeFields = FIELD_INCLUDE_OPTIONS.DYNAMIC) {
	const lines = [];
	buildPrompt(backendObject, includeFields, 0, lines);
	return lines.join("\n").trim();
}

/**
 * Updates an existing tracker with a new one, reconciling nested fields and '_extraFields'.
 * @param {Object|string} tracker - The existing tracker object or YAML string.
 * @param {Object|string} updatedTrackerInput - The updated tracker object or YAML string.
 * @param {Object} backendObject - The backend object defining the tracker structure.
 * @param {boolean} includeUnmatchedFields - Whether to include unmatched fields in '_extraFields'.
 * @param {string} outputFormat - The desired output format ('json' or 'yaml').
 * @returns {Object|string} - The updated tracker in the specified format.
 */
export function updateTracker(tracker, updatedTrackerInput, backendObject, includeUnmatchedFields = true, outputFormat = OUTPUT_FORMATS.JSON, useUpdatedExtraFieldsAsSource = false, internalOutput = null) {
	debug("Updating tracker:", { tracker, updatedTrackerInput, backendObject, includeUnmatchedFields, outputFormat });
	tracker = typeof tracker === "string" ? yamlToJSON(tracker) : tracker;
	const updatedTracker = typeof updatedTrackerInput === "string" ? yamlToJSON(updatedTrackerInput) : updatedTrackerInput;

	const finalTracker = {};
	let extraFields = {};

	reconcileUpdatedTracker(tracker, updatedTracker, backendObject, finalTracker, extraFields, "", includeUnmatchedFields, useUpdatedExtraFieldsAsSource);

	let finalExtraFields = null;

	if (includeUnmatchedFields && !useUpdatedExtraFieldsAsSource) {
		extraFields = cleanEmptyObjects(extraFields);
		const hasExtraObject = typeof extraFields === "object" && extraFields !== null && Object.keys(extraFields).length > 0;
		const hasExtraScalar = typeof extraFields === "string";
		if (hasExtraObject || hasExtraScalar) {
			finalExtraFields = extraFields;
		}
	} else if (useUpdatedExtraFieldsAsSource && updatedTracker._extraFields) {
		finalExtraFields = updatedTracker._extraFields; // Directly use `_extraFields` from updatedTracker
	}

	if (includeUnmatchedFields && !useUpdatedExtraFieldsAsSource) {
		extraFields = mergeExtraFields(extraFields, tracker._extraFields);
		extraFields = mergeExtraFields(extraFields, updatedTracker._extraFields);
		if (finalExtraFields !== null && typeof finalExtraFields !== "undefined") {
			finalExtraFields = extraFields;
		}
	}

	if (finalExtraFields !== null && typeof finalExtraFields !== "undefined") {
		emitExtraFieldWarning(finalExtraFields, "updateTracker");
		finalTracker._extraFields = finalExtraFields;
	}

	logInternalStoryEvents(finalTracker);

	const internalCollector = {};
	removeInternalOnlyFields(finalTracker, backendObject, internalCollector, updatedTracker);
	const cleanedInternal = cleanEmptyObjects(internalCollector);

	if (internalOutput && typeof internalOutput === "object") {
		if (cleanedInternal && Object.keys(cleanedInternal).length > 0) {
			internalOutput.data = cleanedInternal;
		} else {
			internalOutput.data = null;
		}
	}

	return formatOutput(finalTracker, outputFormat);
}

/**
 * Checks if the given tracker is non-empty and contains at least one field that differs from the default. Uses Lodash for deep equality checks.
 * @param {Object|string} trackerInput - The tracker object or YAML string.
 * @param {Object} backendObject - The backend object defining the tracker structure.
 * @param {string} includeFields - Which fields to include ('dynamic', 'static', 'all').
 * @returns {boolean} - `true` if the tracker has at least one non-default field, otherwise `false`.
 */
export function trackerExists(trackerInput, backendObject) {
	if(typeof trackerInput === "undefined" || trackerInput === null) return false;

	// Convert YAML string to JSON if necessary
	let tracker = typeof trackerInput === "string" ? yamlToJSON(trackerInput) : trackerInput;

	// Get the default tracker structure
	let defaultTracker = getDefaultTracker(backendObject, FIELD_INCLUDE_OPTIONS.ALL, OUTPUT_FORMATS.JSON);

	// Remove empty fields from both tracker and default to prevent false negatives
	tracker = _.omitBy(tracker, _.isEmpty);
	defaultTracker = _.omitBy(defaultTracker, _.isEmpty);

	// If tracker is empty after cleaning, it doesn't exist
	if (_.isEmpty(tracker)) return false;

	// If all fields in tracker match the defaults, return false (it’s effectively empty)
	if (_.isEqual(tracker, defaultTracker)) return false;

	return true;
}

/**
 * Cleans a tracker by removing fields that match the default values.
 * @param {Object|string} trackerInput - The tracker object or YAML string.
 * @param {Object} backendObject - The backend object defining the tracker structure.
 * @param {string} includeFields - Which fields to include ('dynamic', 'static', 'all').
 * @param {string} outputFormat - The desired output format ('json' or 'yaml').
 * @param {boolean} preserveStructure - If true, replaces default values with placeholders (object keys remain).
 * @returns {Object|string} - A cleaned tracker in the specified format.
 */
export function cleanTracker(trackerInput, backendObject, outputFormat = OUTPUT_FORMATS.JSON, preserveStructure = false) {
	// Convert YAML to JSON if needed
	const tracker = typeof trackerInput === "string" ? yamlToJSON(trackerInput) : trackerInput;

	// Get the default tracker in JSON form
	const defaultTracker = getDefaultTracker(backendObject, FIELD_INCLUDE_OPTIONS.ALL, OUTPUT_FORMATS.JSON);

	// 1) Recursively remove default values
	let cleaned = removeDefaults(tracker, defaultTracker, preserveStructure);

	// If the entire tracker was removed, return empty object or {} so we don't break usage
	if (typeof cleaned === "undefined"){
		if(outputFormat === OUTPUT_FORMATS.YAML){
			return "";
		} else if(outputFormat === OUTPUT_FORMATS.JSON){
			return {};
		}
	}

	// 2) Return in the specified output format
	return formatOutput(cleaned, outputFormat);
}

export function stripInternalOnlyFields(trackerInput, backendObj) {
	if (!backendObj || typeof backendObj !== "object") {
		return trackerInput;
	}

	const tracker = typeof trackerInput === "string" ? yamlToJSON(trackerInput) : trackerInput;
	if (!tracker || typeof tracker !== "object") {
		return trackerInput;
	}

	const clonedTracker = cloneTrackerData(tracker);
	removeInternalOnlyFields(clonedTracker, backendObj);
	return clonedTracker;
}

function processFieldDefaults(backendObj, trackerObj, includeFields) {
	for (const field of Object.values(backendObj)) {
		if (!shouldIncludeField(field, includeFields)) continue;

		const fieldId = getFieldId(field);
		if (!fieldId) continue;

		const handler = FIELD_TYPES_HANDLERS[field.type] || handleString;
		trackerObj[fieldId] = handler(field, includeFields, null, null, null, null, true);
	}
}

function seedTrackerParticipants(trackerObj, backendObj, includeFields, participantSeeds) {
	const participants = sanitizeParticipantSeeds(participantSeeds);
	if (participants.length === 0) {
		return trackerObj;
	}

	const charactersPresentField = findFieldById(backendObj, "CharactersPresent");
	if (charactersPresentField && shouldIncludeField(charactersPresentField, includeFields)) {
		const charactersPresentId = getFieldId(charactersPresentField);
		if (charactersPresentId) {
			trackerObj[charactersPresentId] = participants;
		}
	}

	const charactersField = findFieldById(backendObj, "Characters");
	if (charactersField && shouldIncludeField(charactersField, includeFields)) {
		const nestedFields = charactersField.nestedFields || {};
		const charactersFieldId = getFieldId(charactersField);
		if (!charactersFieldId) {
			return trackerObj;
		}
		const characterEntries = {};

		participants.forEach((participantName, index) => {
			const entry = {};
			for (const nestedField of Object.values(nestedFields)) {
				if (!shouldIncludeField(nestedField, includeFields)) continue;
				const nestedFieldId = getFieldId(nestedField);
				if (!nestedFieldId) continue;
				const handler = FIELD_TYPES_HANDLERS[nestedField.type] || handleString;
				entry[nestedFieldId] = handler(nestedField, includeFields, null, null, null, index, true);
			}
			characterEntries[participantName] = entry;
		});

		trackerObj[charactersFieldId] = characterEntries;
	}

	return trackerObj;
}

function sanitizeParticipantSeeds(participantSeeds) {
	if (!Array.isArray(participantSeeds)) {
		return [];
	}

	const normalized = [];
	const seen = new Set();
	for (const rawName of participantSeeds) {
		if (typeof rawName !== "string") continue;
		const trimmed = rawName.trim();
		if (!trimmed || seen.has(trimmed)) continue;
		seen.add(trimmed);
		normalized.push(trimmed);
	}
	return normalized;
}

function findFieldById(backendObj, targetId) {
	if (!backendObj || typeof backendObj !== "object") {
		return null;
	}

	for (const field of Object.values(backendObj)) {
		const currentId = getFieldId(field);
		if (currentId && currentId === targetId) {
			return field;
		}
	}
	return null;
}

function reconcileTracker(trackerInput, backendObj, reconciledObj, extraFields, includeFields) {
	const recognizedKeys = new Set();
	for (const field of Object.values(backendObj)) {
		if (!shouldIncludeField(field, includeFields)) continue;

		const fieldId = getFieldId(field);
		if (!fieldId) continue;
		recognizedKeys.add(fieldId);

		const trackerValue = resolveTrackerValue(trackerInput, field);
		const handler = FIELD_TYPES_HANDLERS[field.type] || handleString;
		reconciledObj[fieldId] = handler(field, includeFields, null, trackerValue, extraFields);
	}

	// Handle extra fields
	for (const key in trackerInput) {
		if (!recognizedKeys.has(key) && key !== "_extraFields") {
			extraFields[key] = trackerInput[key]; // Preserve original structure and data type
		}
	}

	// Reconcile _extraFields
	if (trackerInput._extraFields !== undefined) {
		extraFields = mergeExtraFields(extraFields, trackerInput._extraFields);
	}
}

function reconcileUpdatedTracker(tracker, updatedTracker, backendObj, finalTracker, extraFields, fieldPath = "", includeUnmatchedFields, useUpdatedExtraFieldsAsSource = false) {
	const recognizedKeys = new Set();
	for (const field of Object.values(backendObj)) {
		const fieldId = getFieldId(field);
		if (!fieldId) continue;
		recognizedKeys.add(fieldId);

		const handler = FIELD_TYPES_HANDLERS[field.type] || handleString;
		const trackerValue = resolveTrackerValue(tracker, field);
		const updatedValue = resolveTrackerValue(updatedTracker, field);

		debug("Reconciling field:", { fieldId, fieldPath, trackerValue, updatedValue });
		finalTracker[fieldId] = handler(field, FIELD_INCLUDE_OPTIONS.ALL, null, updatedValue !== undefined ? updatedValue : trackerValue, extraFields);
	}

	if (includeUnmatchedFields) {
		for (const key in updatedTracker) {
			if (!recognizedKeys.has(key) && key !== "_extraFields") {
				extraFields[key] = updatedTracker[key]; // Preserve original structure and data type
			}
		}

		if (!useUpdatedExtraFieldsAsSource) {
			// Handle extra fields from the original tracker
			for (const key in tracker) {
				if (!recognizedKeys.has(key) && !Object.prototype.hasOwnProperty.call(extraFields, key) && key !== "_extraFields") {
					extraFields[key] = tracker[key]; // Preserve original structure and data type
				}
			}
		}
	}

	if (useUpdatedExtraFieldsAsSource && updatedTracker._extraFields) {
		extraFields = updatedTracker._extraFields; // Override with updatedTracker's `_extraFields`
	} else if (!useUpdatedExtraFieldsAsSource) {
		extraFields = mergeExtraFields(extraFields, tracker._extraFields);
		extraFields = mergeExtraFields(extraFields, updatedTracker._extraFields);
	}
}

function getFieldPresence(field) {
	const rawPresence = typeof field?.presence === "string" ? field.presence.toUpperCase() : null;
	return rawPresence === FIELD_PRESENCE_OPTIONS.STATIC ? FIELD_PRESENCE_OPTIONS.STATIC : FIELD_PRESENCE_OPTIONS.DYNAMIC;
}

function shouldIncludeField(field, includeFields) {
	if (!field || typeof field !== "object") {
		return false;
	}

	const presence = getFieldPresence(field);
	if (includeFields === FIELD_INCLUDE_OPTIONS.ALL) {
		return true;
	}
	if (includeFields === FIELD_INCLUDE_OPTIONS.STATIC) {
		return presence === FIELD_PRESENCE_OPTIONS.STATIC;
	}
	// Default to dynamic fields
	return presence === FIELD_PRESENCE_OPTIONS.DYNAMIC;
}

function cloneTrackerData(value) {
	try {
		return JSON.parse(JSON.stringify(value));
	} catch (err) {
		return _.cloneDeep ? _.cloneDeep(value) : value;
	}
}

function removeInternalOnlyFields(trackerNode, backendNode, collector = null, sourceNode = null) {
	if (!trackerNode || typeof trackerNode !== "object" || !backendNode || typeof backendNode !== "object") {
		return;
	}

	for (const field of Object.values(backendNode)) {
		if (!field || typeof field !== "object") {
			continue;
		}

		const fieldId = getFieldId(field);
		if (!fieldId) {
			continue;
		}

		const trackerKey = getExistingFieldKey(trackerNode, field);
		if (!trackerKey) {
			continue;
		}

		const metadata = field.metadata || {};
		const trackerValue = trackerNode[trackerKey];
		const sourceValue = resolveTrackerValue(sourceNode, field);

		const isInternalOnly = metadata.internalOnly === true || (metadata.internal && metadata.external === false);
		if (isInternalOnly) {
			if (collector) {
				const valueToCollect = typeof sourceValue !== "undefined" ? sourceValue : trackerValue;
				if (typeof valueToCollect !== "undefined") {
					collector[fieldId] = cloneTrackerData(valueToCollect);
				}
			}
			deleteFieldFromNode(trackerNode, field);
			continue;
		}

		const nestedFields = field.nestedFields || {};
		if (Object.keys(nestedFields).length === 0) {
			continue;
		}

		if (!trackerValue || typeof trackerValue !== "object") {
			continue;
		}

		if (field.type === "OBJECT" || field.type === "ARRAY_OBJECT") {
			let nestedCollector = null;
			if (collector) {
				nestedCollector = collector[fieldId] || (collector[fieldId] = {});
			}
			const nextSource = sourceValue && typeof sourceValue === "object" ? sourceValue : undefined;
			removeInternalOnlyFields(trackerValue, nestedFields, nestedCollector, nextSource);
			if (collector && nestedCollector && Object.keys(nestedCollector).length === 0) {
				delete collector[fieldId];
			}
		} else if (field.type === "FOR_EACH_OBJECT") {
			const parentSource = sourceValue && typeof sourceValue === "object" ? sourceValue : undefined;
			for (const key of Object.keys(trackerValue)) {
				const item = trackerValue[key];
				if (!item || typeof item !== "object") {
					continue;
				}

				let itemCollector = null;
				if (collector) {
					const parentCollector = collector[fieldId] || (collector[fieldId] = {});
					itemCollector = parentCollector[key] || (parentCollector[key] = {});
				}

				const sourceItem = parentSource && typeof parentSource === "object" ? parentSource[key] : undefined;
				removeInternalOnlyFields(item, nestedFields, itemCollector, sourceItem);

				if (collector && itemCollector && Object.keys(itemCollector).length === 0) {
					delete collector[fieldId][key];
				}
			}

			if (collector && collector[fieldId] && Object.keys(collector[fieldId]).length === 0) {
				delete collector[fieldId];
			}
		} else if (field.type === "FOR_EACH_ARRAY") {
			const parentSource = sourceValue && typeof sourceValue === "object" ? sourceValue : undefined;
			for (const key of Object.keys(trackerValue)) {
				const arrayItems = trackerValue[key];
				if (!Array.isArray(arrayItems)) {
					continue;
				}

				let arrayCollector = null;
				if (collector) {
					const parentCollector = collector[fieldId] || (collector[fieldId] = {});
					arrayCollector = parentCollector[key] || (parentCollector[key] = []);
				}

				const sourceEntry = parentSource && typeof parentSource === "object" ? parentSource[key] : undefined;

				arrayItems.forEach((item, index) => {
					if (!item || typeof item !== "object") {
						return;
					}

					let itemCollector = null;
					if (collector) {
						arrayCollector[index] = arrayCollector[index] || {};
						itemCollector = arrayCollector[index];
					}

					const sourceItem = Array.isArray(sourceEntry) ? sourceEntry[index] : undefined;
					removeInternalOnlyFields(item, nestedFields, itemCollector, sourceItem);

					if (collector && itemCollector && Object.keys(itemCollector).length === 0) {
						delete arrayCollector[index];
					}
				});

				if (collector && Array.isArray(arrayCollector)) {
					const cleanedArray = arrayCollector.filter((entry) => entry && Object.keys(entry).length > 0);
					if (cleanedArray.length > 0) {
						collector[fieldId][key] = cleanedArray;
					} else {
						delete collector[fieldId][key];
					}
				}
			}

			if (collector && collector[fieldId] && Object.keys(collector[fieldId]).length === 0) {
				delete collector[fieldId];
			}
		}
	}
}

function logInternalStoryEvents(tracker) {
	if (!tracker || typeof tracker !== "object") {
		return;
	}

	const storyEvents = tracker.StoryEvents;
	if (!storyEvents || typeof storyEvents !== "object") {
		return;
	}

	const birthEvents = storyEvents.BirthEvents;
	if (birthEvents && typeof birthEvents === "object") {
		for (const [name, payload] of Object.entries(birthEvents)) {
			const normalizedName = typeof name === "string" ? name.trim() : "";
			if (!normalizedName || normalizedName.toLowerCase() === "none") {
				continue;
			}

			let description = "";
			if (payload && typeof payload === "object" && typeof payload.NewBornDescription === "string") {
				description = payload.NewBornDescription.trim();
			}

			debug("[Tracker Enhanced] Birth event detected", {
				name: normalizedName,
				description: description || undefined,
				raw: payload,
			});
		}
	}

	const growthEvents = storyEvents.GrowthEvents;
	if (growthEvents && typeof growthEvents === "object") {
		for (const [name, payload] of Object.entries(growthEvents)) {
			const normalizedName = typeof name === "string" ? name.trim() : "";
			if (!normalizedName || normalizedName.toLowerCase() === "none") {
				continue;
			}

			let description = "";
			if (payload && typeof payload === "object" && typeof payload.GrowthDescription === "string") {
				description = payload.GrowthDescription.trim();
			}

			debug("[Tracker Enhanced] Growth event detected", {
				name: normalizedName,
				description: description || undefined,
				raw: payload,
			});
		}
	}

	const deathEvents = storyEvents.DeathEvents;
	if (deathEvents && typeof deathEvents === "object") {
		for (const [name, payload] of Object.entries(deathEvents)) {
			const normalizedName = typeof name === "string" ? name.trim() : "";
			if (!normalizedName || normalizedName.toLowerCase() === "none") {
				continue;
			}

			let description = "";
			if (payload && typeof payload === "object" && typeof payload.DeathCauseDescription === "string") {
				description = payload.DeathCauseDescription.trim();
			}

			debug("[Tracker Enhanced] Death event detected", {
				name: normalizedName,
				description: description || undefined,
				raw: payload,
			});
		}
	}
}

function handleString(field, includeFields, index = null, trackerValue = null, extraFields = null, charIndex = null, useDefaults = false) {
	const fieldId = getFieldId(field);
	const hasValue = trackerValue !== null && typeof trackerValue !== "undefined";

	if (hasValue) {
		if (typeof trackerValue === "string") {
			return trackerValue;
		}

		if (typeof trackerValue === "number" || typeof trackerValue === "boolean" || typeof trackerValue === "bigint") {
			return String(trackerValue);
		}

		if (extraFields && typeof extraFields === "object") {
			if (fieldId) {
				extraFields[fieldId] = trackerValue;
			}
		}

		return useDefaults ? (field.defaultValue || "Updated if Changed") : "";
	}

	if (useDefaults) {
		// If we have exampleValues and index, try parsing
		if (index !== null && field.exampleValues && field.exampleValues[index]) {
			const val = field.exampleValues[index];
			try {
				const arr = JSON.parse(val);
				if (Array.isArray(arr)) {
					if (charIndex !== null && charIndex < arr.length) {
						return arr[charIndex];
					}
					return arr[0];
				}
				return val;
			} catch {
				return val;
			}
		}

		return field.defaultValue || "Updated if Changed";
	}

	return "";
}

function handleArray(field, includeFields, index = null, trackerValue = null, extraFields = null, charIndex = null, useDefaults = false) {
	const fieldId = getFieldId(field);
	if (trackerValue !== null && Array.isArray(trackerValue)) {
		return trackerValue;
	} else if (trackerValue !== null) {
		// Type mismatch detected
		if (extraFields && typeof extraFields === "object") {
			if (fieldId) {
				extraFields[fieldId] = trackerValue;
			}
		}
		return useDefaults ? buildArrayDefault(field, index, charIndex) : [];
	}

	return useDefaults ? buildArrayDefault(field, index, charIndex) : [];
}

function buildArrayDefault(field, index = null, charIndex = null) {
	let value;
	if (index !== null && field.exampleValues && field.exampleValues[index]) {
		try {
			const arr = JSON.parse(field.exampleValues[index]);
			if (Array.isArray(arr)) {
				if (charIndex !== null && charIndex < arr.length) {
					return arr[charIndex];
				}
				return arr;
			}
			value = arr;
		} catch {
			value = field.exampleValues[index];
		}
	} else {
		try {
			const parsedValue = JSON.parse(field.defaultValue);
			value = Array.isArray(parsedValue) ? parsedValue : [parsedValue];
		} catch {
			value = field.defaultValue ? [field.defaultValue] : [];
		}
	}
	return value;
}

function resolveForEachKeys(field, index = null) {
	if (index !== null && field.exampleValues && field.exampleValues[index]) {
		try {
			const parsed = JSON.parse(field.exampleValues[index]);
			if (Array.isArray(parsed)) {
				return parsed;
			}
			if (typeof parsed === "string") {
				return [parsed];
			}
		} catch {
			return [field.exampleValues[index]];
		}
	}

	return [field.defaultValue || "default"];
}

function handleObject(field, includeFields, index = null, trackerValue = null, extraFields = null, charIndex = null, useDefaults = false) {
	const fieldId = getFieldId(field);
	const obj = {};
	const nestedFields = field.nestedFields || {};

	if (trackerValue !== null && typeof trackerValue === "object" && !Array.isArray(trackerValue)) {
		// Process nested fields
		for (const nestedField of Object.values(nestedFields)) {
			if (!shouldIncludeField(nestedField, includeFields)) continue;
			const handler = FIELD_TYPES_HANDLERS[nestedField.type] || handleString;
			const nestedFieldId = getFieldId(nestedField);
			if (!nestedFieldId) continue;
			const nestedValue = resolveTrackerValue(trackerValue, nestedField);
			obj[nestedFieldId] = handler(nestedField, includeFields, null, nestedValue, extraFields && typeof extraFields === "object" ? extraFields : null, charIndex, useDefaults);
		}

		// Handle extra fields in the nested object
		for (const key in trackerValue) {
			if (!Object.prototype.hasOwnProperty.call(obj, key)) {
				if (extraFields && typeof extraFields === "object") {
					if (fieldId) {
						extraFields[fieldId] = extraFields[fieldId] || {};
						extraFields[fieldId][key] = trackerValue[key];
					}
				}
			}
		}
	} else {
	if (trackerValue !== null && extraFields && typeof extraFields === "object") {
			if (fieldId) {
				extraFields[fieldId] = trackerValue;
			}
		}
		if (!useDefaults) {
			return {};
		}
		// Use default values
		for (const nestedField of Object.values(nestedFields)) {
			if (!shouldIncludeField(nestedField, includeFields)) continue;
			const handler = FIELD_TYPES_HANDLERS[nestedField.type] || handleString;
			const nestedFieldId = getFieldId(nestedField);
			if (!nestedFieldId) continue;
			obj[nestedFieldId] = handler(nestedField, includeFields, index, null, extraFields, charIndex, useDefaults);
		}
	}

	return obj;
}

function handleForEachObject(field, includeFields, index = null, trackerValue = null, extraFields = null, charIndex = null, useDefaults = false) {
	const fieldId = getFieldId(field);
	const nestedFields = field.nestedFields || {};
	const nestedFieldList = Object.values(nestedFields);
	const recognizedNestedKeys = new Set();
	for (const nestedField of nestedFieldList) {
		const nestedId = getFieldId(nestedField);
		if (nestedId) {
			recognizedNestedKeys.add(nestedId);
		}
	}

	if (trackerValue !== null && typeof trackerValue === "object" && !Array.isArray(trackerValue)) {
		// Process existing trackerValue
		const result = {};
		for (const [key, value] of Object.entries(trackerValue)) {
			const obj = {};
			let extraNestedFields = null;

			const nestedSource = value && typeof value === "object" ? value : {};
			for (const nestedField of nestedFieldList) {
				if (!shouldIncludeField(nestedField, includeFields)) continue;
				const handler = FIELD_TYPES_HANDLERS[nestedField.type] || handleString;
				const nestedFieldId = getFieldId(nestedField);
				if (!nestedFieldId) continue;
				const nestedValue = resolveTrackerValue(nestedSource, nestedField);
				obj[nestedFieldId] = handler(nestedField, includeFields, null, nestedValue, extraNestedFields, null, useDefaults);
			}

			// Handle extra fields in the nested object
			for (const nestedKey in nestedSource) {
				if (!recognizedNestedKeys.has(nestedKey)) {
					if (extraFields && typeof extraFields === "object") {
						extraNestedFields = extraNestedFields || {};
						extraNestedFields[nestedKey] = nestedSource[nestedKey];
					}
				}
			}

			if (extraFields && extraNestedFields && fieldId) {
				extraFields[fieldId] = extraFields[fieldId] || {};
				extraFields[fieldId][key] = extraNestedFields;
			}

			result[key] = obj;
		}
		return result;
	}

	const hasValue = trackerValue !== null && typeof trackerValue !== "undefined";
	if (hasValue) {
		if (typeof trackerValue === "string") {
			const normalized = trackerValue.trim();
			if (!normalized || normalized.toLowerCase() === "none") {
				return {};
			}
		} else if (extraFields && typeof extraFields === "object") {
			if (fieldId) {
				extraFields[fieldId] = trackerValue;
			}
		}
	}

	if (!useDefaults) {
		return {};
	}

	const keys = resolveForEachKeys(field, index);
	const result = {};
	// For each key, build an object of nested fields
	for (let cIndex = 0; cIndex < keys.length; cIndex++) {
		const characterName = keys[cIndex];
		const obj = {};
		for (const nestedField of nestedFieldList) {
			if (!shouldIncludeField(nestedField, includeFields)) continue;
			const handler = FIELD_TYPES_HANDLERS[nestedField.type] || handleString;
			const nestedFieldId = getFieldId(nestedField);
			if (!nestedFieldId) continue;
			obj[nestedFieldId] = handler(nestedField, includeFields, index, null, extraFields, cIndex, useDefaults);
		}
		result[characterName] = obj;
	}
	return result;
}

function handleForEachArray(field, includeFields, index = null, trackerValue = null, extraFields = null, charIndex = null, useDefaults = false) {
	const fieldId = getFieldId(field);
	const nestedFields = field.nestedFields || {};

	const nestedFieldArray = Object.values(nestedFields);
	const singleStringField = nestedFieldArray.length === 1 && nestedFieldArray[0].type === "STRING";
	const recognizedNestedKeys = new Set();
	for (const nf of nestedFieldArray) {
		const nestedId = getFieldId(nf);
		if (nestedId) {
			recognizedNestedKeys.add(nestedId);
		}
	}

	if (trackerValue !== null && typeof trackerValue === "object" && !Array.isArray(trackerValue)) {
		const result = {};
		for (const [key, value] of Object.entries(trackerValue)) {
			if (!Array.isArray(value)) {
				if (extraFields && typeof extraFields === "object" && fieldId) {
					extraFields[fieldId] = extraFields[fieldId] || {};
					extraFields[fieldId][key] = value;
				}
				result[key] = singleStringField ? [] : [];
				continue;
			}

			if (singleStringField) {
				const filteredValues = [];
				for (const v of value) {
					if (typeof v === "string") {
						filteredValues.push(v);
					} else if (extraFields && typeof extraFields === "object" && fieldId) {
						extraFields[fieldId] = extraFields[fieldId] || {};
						extraFields[fieldId][key] = extraFields[fieldId][key] || [];
						extraFields[fieldId][key].push(v);
					}
				}
				result[key] = filteredValues;
			} else {
				const arrayOfObjects = [];
				for (const arrItem of value) {
					if (arrItem && typeof arrItem === "object" && !Array.isArray(arrItem)) {
						const obj = {};
						let extraNestedFields = null;
						for (const nf of nestedFieldArray) {
							if (!shouldIncludeField(nf, includeFields)) continue;
							const handler = FIELD_TYPES_HANDLERS[nf.type] || handleString;
							const nestedFieldId = getFieldId(nf);
							if (!nestedFieldId) continue;
							const arrItemVal = resolveTrackerValue(arrItem, nf);
							obj[nestedFieldId] = handler(nf, includeFields, null, arrItemVal, extraNestedFields, null, useDefaults);
						}

						for (const nestedKey in arrItem) {
							if (!recognizedNestedKeys.has(nestedKey)) {
								extraNestedFields = extraNestedFields || {};
								extraNestedFields[nestedKey] = arrItem[nestedKey];
							}
						}

						if (extraNestedFields && extraFields && typeof extraFields === "object" && fieldId) {
							extraFields[fieldId] = extraFields[fieldId] || {};
							extraFields[fieldId][key] = extraFields[fieldId][key] || [];
							extraFields[fieldId][key].push(extraNestedFields);
						}

						arrayOfObjects.push(obj);
					} else if (extraFields && typeof extraFields === "object" && fieldId) {
						extraFields[fieldId] = extraFields[fieldId] || {};
						extraFields[fieldId][key] = extraFields[fieldId][key] || [];
						extraFields[fieldId][key].push(arrItem);
					}
				}
				result[key] = arrayOfObjects;
			}
		}
		return result;
	}

	const hasValue = trackerValue !== null && typeof trackerValue !== "undefined";
	if (hasValue) {
		if (typeof trackerValue === "string") {
			const normalized = trackerValue.trim();
			if (!normalized || normalized.toLowerCase() === "none") {
				return {};
			}
		} else if (extraFields && typeof extraFields === "object" && fieldId) {
			extraFields[fieldId] = trackerValue;
		}
	}

	if (!useDefaults) {
		return {};
	}

	const keys = resolveForEachKeys(field, index);
	const result = {};
	for (let cIndex = 0; cIndex < keys.length; cIndex++) {
		const characterName = keys[cIndex];

		if (singleStringField) {
			const nf = nestedFieldArray[0];
			let defaultArray = [];
			if (index !== null && nf.exampleValues && nf.exampleValues[index]) {
				try {
					const val = nf.exampleValues[index];
					const parsed = JSON.parse(val);
					if (Array.isArray(parsed)) {
						defaultArray = parsed.map((item) => (typeof item === "string" ? item : String(item)));
					} else {
						defaultArray = [String(val)];
					}
				} catch {
					defaultArray = [nf.exampleValues[index]];
				}
			} else if (nf.defaultValue) {
				try {
					const parsed = JSON.parse(nf.defaultValue);
					if (Array.isArray(parsed)) {
						defaultArray = parsed.map((item) => (typeof item === "string" ? item : String(item)));
					} else {
						defaultArray = [String(nf.defaultValue)];
					}
				} catch {
					defaultArray = [nf.defaultValue];
				}
			} else {
				defaultArray = ["Updated if Changed"];
			}

			result[characterName] = defaultArray;
		} else {
			const arrItem = {};
			for (const nf of nestedFieldArray) {
				if (!shouldIncludeField(nf, includeFields)) continue;
				const handler = FIELD_TYPES_HANDLERS[nf.type] || handleString;
				const nestedFieldId = getFieldId(nf);
				if (!nestedFieldId) continue;
				arrItem[nestedFieldId] = handler(nf, includeFields, index, null, extraFields, cIndex, useDefaults);
			}
			result[characterName] = [arrItem];
		}
	}

	return result;
}

function buildPrompt(backendObj, includeFields, indentLevel, lines) {
	const indent = "  ".repeat(indentLevel);
	for (const field of Object.values(backendObj)) {
		if (!shouldIncludeField(field, includeFields)) continue;
		if (!field.prompt && !field.nestedFields && (!field.exampleValues || field.exampleValues.length === 0)) continue;

		const fieldId = getFieldId(field);
		const fieldLabel = getFieldLabel(field) || fieldId || "Unnamed Field";
		const idSuffix = fieldId ? ` (Field ID: ${fieldId})` : "";
		const promptSuffix = field.prompt ? ` — ${field.prompt}` : "";
		const heading = `**${fieldLabel}**${idSuffix}`;

		if (field.type === "FOR_EACH_OBJECT" || field.nestedFields) {
			lines.push(`${indent}- ${heading}${promptSuffix}`);
			appendExampleLines(field, indentLevel, lines);
			buildPrompt(field.nestedFields, includeFields, indentLevel + 1, lines);
		} else {
			lines.push(`${indent}- ${heading}${promptSuffix}`);
			appendExampleLines(field, indentLevel, lines);
		}
	}
}

function formatOutput(tracker, outputFormat) {
	if (outputFormat === OUTPUT_FORMATS.YAML) {
		return jsonToYAML(tracker);
	}
	return tracker;
}

function appendExampleLines(field, indentLevel, lines) {
	if (!field || !Array.isArray(field.exampleValues) || field.exampleValues.length === 0) return;

	const exampleIndent = "  ".repeat(indentLevel + 1);
	field.exampleValues.forEach((exampleValue, idx) => {
		const formatted = formatExampleValueForPrompt(exampleValue);
		if (!formatted) return;

		const hasMultiple = field.exampleValues.length > 1;
		const label = hasMultiple ? `Example ${idx + 1}` : "Example";
		lines.push(`${exampleIndent}- ${label}: ${formatted}`);
	});
}

function formatExampleValueForPrompt(exampleValue) {
	if (exampleValue === null || typeof exampleValue === "undefined") return "";

	let raw = exampleValue;
	if (typeof raw === "string") {
		const trimmed = raw.trim();
		if (!trimmed) return "";
		raw = trimmed;
		try {
			raw = JSON.parse(trimmed);
		} catch {
			// Keep as trimmed string when JSON.parse fails
			return trimmed.replace(/\s+/g, " ");
		}
	}

	const formatted = stringifyExampleValue(raw);
	return formatted.replace(/\s+/g, " ").trim();
}

function stringifyExampleValue(value) {
	if (value === null || typeof value === "undefined") return "";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (Array.isArray(value)) {
		return value.map((item) => stringifyExampleValue(item)).filter(Boolean).join("; ");
	}
	if (typeof value === "object") {
		return Object.entries(value)
			.map(([key, val]) => `${key}: ${stringifyExampleValue(val)}`)
			.filter(Boolean)
			.join("; ");
	}
	return String(value);
}

// Utility function to merge objects deeply or concatenate strings
function mergeExtraFields(extraFields, existingExtra) {
	if (existingExtra === undefined || existingExtra === null) {
		return extraFields;
	}

	if (typeof existingExtra === "object") {
		if (typeof extraFields === "object") {
			mergeDeep(extraFields, existingExtra);
			return extraFields;
		} else if (typeof extraFields === "string") {
			return extraFields + JSON.stringify(existingExtra);
		} else {
			return existingExtra;
		}
	} else if (typeof existingExtra === "string") {
		if (typeof extraFields === "object") {
			return JSON.stringify(extraFields) + existingExtra;
		} else if (typeof extraFields === "string") {
			return extraFields + existingExtra;
		} else {
			return existingExtra;
		}
	} else {
		return extraFields;
	}
}

function emitExtraFieldWarning(extraFields, context) {
	if (extraFields === undefined || extraFields === null) {
		return;
	}

	const paths = collectExtraFieldPaths(extraFields);
	if (paths.length === 0) {
		return;
	}

	const normalizedContext = typeof context === "string" && context ? context : "tracker";
	const sortedPaths = [...paths].sort();
	const signature = `${normalizedContext}:${sortedPaths.slice(0, EXTRA_FIELD_WARNING_LIMIT).join("|")}`;
	if (extraFieldWarningCache.has(signature)) {
		return;
	}

	extraFieldWarningCache.add(signature);

	const payload = {
		context: normalizedContext,
		extraFieldPaths: sortedPaths.slice(0, EXTRA_FIELD_WARNING_LIMIT),
		totalExtraFieldPaths: sortedPaths.length,
	};
	if (sortedPaths.length > EXTRA_FIELD_WARNING_LIMIT) {
		payload.truncated = true;
	}

	warn(
		"[Tracker Enhanced] Tracker data included unknown field keys; data was moved to _extraFields. Reset extension defaults or rebuild the originating preset to resolve legacy payloads.",
		payload
	);
}

function collectExtraFieldPaths(extraFields, prefix = []) {
	if (extraFields === null || typeof extraFields === "undefined") {
		return [];
	}

	if (typeof extraFields !== "object") {
		const path = prefix.length ? prefix.join(".") : "(root)";
		return [path];
	}

	const entries = Object.entries(extraFields);
	if (entries.length === 0) {
		return [];
	}

	const paths = [];
	for (const [key, value] of entries) {
		const nextPrefix = prefix.concat(key);
		if (value !== null && typeof value === "object") {
			const nested = collectExtraFieldPaths(value, nextPrefix);
			if (nested.length > 0) {
				paths.push(...nested);
			} else {
				paths.push(nextPrefix.join("."));
			}
		} else {
			paths.push(nextPrefix.join("."));
		}
	}

	return paths;
}

// Utility function to merge objects deeply
function mergeDeep(target, source) {
	for (const key in source) {
		if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
			if (!target[key] || typeof target[key] !== "object") {
				target[key] = {};
			}
			mergeDeep(target[key], source[key]);
		} else {
			target[key] = source[key];
		}
	}
}

// Utility function to remove empty objects from extraFields
function cleanEmptyObjects(obj) {
	if (typeof obj !== "object" || obj === null) return obj;

	for (const key in obj) {
		if (typeof obj[key] === "object") {
			obj[key] = cleanEmptyObjects(obj[key]);
			if (obj[key] !== null && typeof obj[key] === "object" && Object.keys(obj[key]).length === 0) {
				delete obj[key];
			}
		}
	}

	return obj;
}

function removeDefaults(currentValue, defaultValue, preserveStructure) {
	if (_.isArray(currentValue) && _.isArray(defaultValue)) {
		return cleanArray(currentValue, defaultValue, preserveStructure);
	}

	if (_.isPlainObject(currentValue) && _.isPlainObject(defaultValue)) {
		return cleanObject(currentValue, defaultValue, preserveStructure);
	}

	if (_.isEqual(currentValue, defaultValue)) {
		return preserveStructure ? getEmptyEquivalent(currentValue) : undefined;
	}

	return currentValue;
}

function cleanArray(arr, defaultArr, preserveStructure) {
	const cleanedItems = [];

	for (let item of arr) {
		const isDefaultItem = defaultArr.some((defItem) => _.isEqual(item, defItem));
		if (isDefaultItem) continue;

		cleanedItems.push(item);
	}

	if (cleanedItems.length === 0 && !preserveStructure) {
		return undefined;
	}

	return cleanedItems;
}

function cleanObject(obj, defaultObj, preserveStructure) {
	let hasRemainingKeys = false;
	const result = {};

	for (let key in obj) {
		if (!obj.hasOwnProperty(key)) continue;

		const defaultValForKey = defaultObj.hasOwnProperty(key) ? defaultObj[key] : getEmptyEquivalent(obj[key]);

		const cleanedValue = removeDefaults(obj[key], defaultValForKey, preserveStructure);

		if (typeof cleanedValue !== "undefined") {
			hasRemainingKeys = true;
			result[key] = cleanedValue;
		} else if (preserveStructure) {
			hasRemainingKeys = true;
			result[key] = getEmptyEquivalent(obj[key]);
		}
	}

	if (!hasRemainingKeys && !preserveStructure) {
		return undefined;
	}

	return result;
}

function getEmptyEquivalent(value) {
	if (_.isString(value)) return "";
	if (_.isArray(value)) return [];
	if (_.isObject(value)) return {};
	return null;
}
