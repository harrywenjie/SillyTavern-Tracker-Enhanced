import { generateRaw, chat, characters, this_chid, getCharacterCardFields, name1, baseChatReplace } from "../../../../../script.js";
import { getContext } from '../../../../../../scripts/extensions.js';

import { groups, selected_group } from "../../../../../scripts/group-chats.js";
import { log, warn, debug, error, unescapeJsonString, getLastMessageWithTracker } from "../lib/utils.js";
import { yamlToJSON, jsonToYAML } from "../lib/ymlParser.js";
import { buildParticipantGuidance, collectParticipantNames } from "../lib/participantGuidance.js";
import { getCurrentLocale, t } from "../lib/i18n.js";
import { extensionSettings } from "../index.js";
import { FIELD_INCLUDE_OPTIONS, getDefaultTracker, getFieldId, getTracker, getTrackerPrompt, OUTPUT_FORMATS, updateTracker } from "./trackerDataHandler.js";
import { trackerFormat, participantTargets } from "./settings/defaultSettings.js";
import { buildTimeAnalysis } from "../lib/timeManager.js";

const EXTRA_FIELD_LOG_LIMIT = 12;

const DEFAULT_RECENT_MESSAGE_ENTRY_TEMPLATE = `{{#if tracker}}Tracker: <tracker>\n{{tracker}}\n</tracker>\n{{/if}}{{char}}: {{message}}`;

// #region Utility Functions

/**
 * Gets the profile ID for a given profile name.
 * @param {string} profileName - The profile name.
 * @returns {string|null} The profile ID or null if not found.
 */
function getProfileIdByName(profileName) {
	const ctx = getContext();
	const connectionManager = ctx.extensionSettings.connectionManager;
	
	if (profileName === "current") {
		return connectionManager.selectedProfile;
	}
	
	const profile = connectionManager.profiles.find(p => p.name === profileName);
	return profile ? profile.id : null;
}
/**
 * Gets the connection profile object for a given profile ID.
 * @param {string} profileId - The profile ID.
 * @returns {import("../../../../../scripts/extensions/connection-manager/index.js").ConnectionProfile|null}
 */
function getProfileById(profileId) {
	if (!profileId) {
		return null;
	}

	const ctx = getContext();
	const connectionManager = ctx.extensionSettings.connectionManager;
	return connectionManager.profiles.find((p) => p.id === profileId) || null;
}

/**
 * Determines which completion preset should be applied for the current request.
 * @param {import("../../../../../scripts/extensions/connection-manager/index.js").ConnectionProfile|null} profile - Active connection profile.
 * @param {string} selectedPresetSetting - Preset selector from extension settings.
 * @returns {{ includePreset: boolean, presetName: string|null, source: string, preset: object|null, apiType: string|null }}
 */
function resolveCompletionPreset(profile, selectedPresetSetting) {
	if (!profile) {
		return { includePreset: false, presetName: null, source: "no-profile", preset: null, apiType: null };
	}

	const ctx = getContext();
	const desiredPreset = selectedPresetSetting || "current";
	let apiMap = null;

	try {
		apiMap = ctx.ConnectionManagerRequestService.validateProfile(profile);
	} catch (err) {
		warn("[Tracker Enhanced] Failed to validate profile for preset resolution:", err);
	}

	const apiType = apiMap?.selected ?? null;
	const presetManager = apiType ? ctx.getPresetManager?.(apiType) : null;

	const getProfilePreset = () => {
		if (!profile.preset || !presetManager) {
			return { presetName: profile.preset ?? null, preset: null };
		}

		const preset = presetManager.getCompletionPresetByName?.(profile.preset) ?? null;
		if (!preset) {
			warn(`[Tracker Enhanced] Profile preset "${profile.preset}" not found for API ${apiType}; tracker will run without preset overrides.`);
		}

		return { presetName: profile.preset, preset };
	};

	if (desiredPreset === "current") {
		const { presetName, preset } = getProfilePreset();
		return {
			includePreset: !!presetName,
			presetName: presetName || null,
			source: preset ? "profile" : "profile-missing",
			preset,
			apiType,
		};
	}

	if (!presetManager) {
		warn("[Tracker Enhanced] No preset manager available; falling back to profile preset.");
		const { presetName, preset } = getProfilePreset();
		return {
			includePreset: !!presetName,
			presetName: presetName || null,
			source: preset ? "profile" : "profile-missing",
			preset,
			apiType,
		};
	}

	const explicitPreset = presetManager.getCompletionPresetByName?.(desiredPreset) ?? null;
	if (explicitPreset) {
		return {
			includePreset: true,
			presetName: desiredPreset,
			source: "explicit",
			preset: explicitPreset,
			apiType,
		};
	}

	warn(`[Tracker Enhanced] Preset "${desiredPreset}" not found for API ${apiType}; falling back to profile preset.`);
	const { presetName, preset } = getProfilePreset();
	return {
		includePreset: !!presetName,
		presetName: presetName || null,
		source: preset ? "profile-fallback" : "profile-missing",
		preset,
		apiType,
	};
}

function pickPresetValue(preset, keys) {
	if (!preset || !Array.isArray(keys)) return undefined;
	for (const key of keys) {
		if (Object.prototype.hasOwnProperty.call(preset, key)) {
			const value = preset[key];
			if (value !== undefined && value !== null && value !== "") {
				return value;
			}
		}
	}
	return undefined;
}

function coerceNumber(value) {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}
	const number = Number(value);
	return Number.isFinite(number) ? number : undefined;
}

function sanitizeStopValue(value) {
	if (Array.isArray(value)) {
		return value
			.map((entry) => (typeof entry === "string" ? entry.trim() : entry))
			.filter((entry) => entry !== undefined && entry !== null && entry !== "");
	}
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (!trimmed) return undefined;
		const parts = trimmed.split(/\r?\n|\|\|/).map((entry) => entry.trim()).filter((entry) => entry);
		return parts.length ? parts : undefined;
	}
	return undefined;
}

function buildPresetOverridePayload(apiType, preset) {
	if (!preset || !apiType) {
		return {};
	}
	const overrides = {};
	const assignNumber = (targetKey, keys) => {
		const raw = pickPresetValue(preset, keys);
		const num = coerceNumber(raw);
		if (num !== undefined) {
			overrides[targetKey] = num;
		}
	};
	const assignValue = (targetKey, keys) => {
		const value = pickPresetValue(preset, keys);
		if (value !== undefined) {
			overrides[targetKey] = value;
		}
	};
	switch (apiType) {
		case "openai": {
			assignNumber("temperature", ["temperature", "temp", "temp_openai"]);
			assignNumber("top_p", ["top_p", "top_p_openai"]);
			assignNumber("top_k", ["top_k", "top_k_openai"]);
			assignNumber("top_a", ["top_a", "top_a_openai"]);
			assignNumber("min_p", ["min_p", "min_p_openai"]);
			assignNumber("presence_penalty", ["presence_penalty", "pres_pen_openai"]);
			assignNumber("frequency_penalty", ["frequency_penalty", "freq_pen_openai"]);
			assignNumber("repetition_penalty", ["repetition_penalty", "repetition_penalty_openai"]);
			assignNumber("seed", ["seed", "seed_openai"]);
			assignNumber("n", ["n"]);
			assignValue("logit_bias", ["logit_bias"]);
			const maxTokens = coerceNumber(pickPresetValue(preset, ["max_tokens", "openai_max_tokens", "max_response_tokens"]));
			if (maxTokens !== undefined) {
				overrides.max_tokens = maxTokens;
			}
			const stop = sanitizeStopValue(pickPresetValue(preset, ["stop", "stop_sequences", "custom_stop_sequences"]));
			if (stop) {
				overrides.stop = stop;
			}
			break;
		}
		case "textgenerationwebui": {
			assignNumber("temperature", ["temperature", "temp"]);
			assignNumber("top_p", ["top_p"]);
			assignNumber("top_k", ["top_k"]);
			assignNumber("top_a", ["top_a"]);
			assignNumber("typical_p", ["typical_p"]);
			assignNumber("tfs", ["tfs"]);
			assignNumber("epsilon_cutoff", ["epsilon_cutoff"]);
			assignNumber("eta_cutoff", ["eta_cutoff"]);
			assignNumber("min_p", ["min_p"]);
			assignNumber("penalty_alpha", ["penalty_alpha"]);
			assignNumber("repetition_penalty", ["repetition_penalty", "rep_pen"]);
			assignNumber("frequency_penalty", ["frequency_penalty", "freq_pen"]);
			assignNumber("presence_penalty", ["presence_penalty", "presence_pen"]);
			const maxTokens = coerceNumber(pickPresetValue(preset, ["max_tokens", "max_length", "max_new_tokens"]));
			if (maxTokens !== undefined) {
				overrides.max_tokens = maxTokens;
			}
			const stop = sanitizeStopValue(pickPresetValue(preset, ["stop", "stop_sequences", "stop_strings"]));
			if (stop) {
				overrides.stop = stop;
			}
			break;
		}
		default:
			break;
	}
	return overrides;
}

function getParticipantPolicy() {
	const locale = getCurrentLocale?.() ?? "en";
	const names = collectParticipantNames();
	const participantFocus = extensionSettings.participantTarget ?? participantTargets.BOTH;
	const template = extensionSettings.participantGuidanceTemplate;
	const policy = buildParticipantGuidance(participantFocus, names, locale, template);

	return {
		locale,
		names,
		guidance: policy.guidance,
		participants: policy.participants,
	};
}


/**
 * Replaces `{{key}}` placeholders in a template string with provided values.
 * @param {string} template - The template string containing placeholders.
 * @param {Object} vars - An object of key-value pairs to replace in the template.
 * @returns {string} The processed template with all placeholders replaced.
 */
function formatTemplate(template, vars) {
	let result = template;
	for (const [key, value] of Object.entries(vars)) {
		const regex = new RegExp(`{{${key}}}`, "g");
		result = result.replace(regex, value != null ? value : "");
	}
	return result;
}

/**
 * Handles conditional sections like `{{#if tracker}}...{{/if}}`.
 * If condition is true, keeps the content inside. Otherwise, removes it.
 * @param {string} template - The template with conditional blocks.
 * @param {string} sectionName - The name used after `#if`.
 * @param {boolean} condition - Whether to keep the content.
 * @param {string} content - The content to insert if condition is true.
 * @returns {string} The processed template.
 */
function conditionalSection(template, sectionName, condition) {
	const sectionRegex = new RegExp(`{{#if ${sectionName}}}([\\s\\S]*?){{\\/if}}`, "g");
	if (!condition) {
		return template.replace(sectionRegex, "");
	}
	return template.replace(sectionRegex, (_match, inner) => inner);
}

// #endregion

/**
 * Sends a generation request using an independent connection profile.
 * @param {string} prompt - The prompt to send.
 * @param {number|null} maxTokens - Maximum tokens to generate.
 * @returns {Promise<string>} The generated response.
 */
async function sendIndependentGenerationRequest(prompt, maxTokens = null) {
	try {
		log(`[Tracker Enhanced] 🚀 sendIndependentGenerationRequest called`);
		
		const ctx = getContext();
		const profileId = getProfileIdByName(extensionSettings.selectedProfile);
		const profile = getProfileById(profileId);
		
		log(`[Tracker Enhanced] Selected profile: ${extensionSettings.selectedProfile}`);
		log(`[Tracker Enhanced] Profile ID: ${profileId}`);
		
		if (!profileId || !profile) {
			error(`[Tracker Enhanced] ❌ Profile not found: ${extensionSettings.selectedProfile}`);
			throw new Error(`Profile not found: ${extensionSettings.selectedProfile}`);
		}
		
		const { includePreset, presetName, source: presetSource, preset: resolvedPreset, apiType } = resolveCompletionPreset(profile, extensionSettings.selectedCompletionPreset);
		const originalPreset = profile.preset;
		const shouldOverridePreset = includePreset && presetName && profile.preset !== presetName;
		if (shouldOverridePreset) {
			profile.preset = presetName;
		}
		const overridePayload = includePreset && resolvedPreset ? buildPresetOverridePayload(apiType, resolvedPreset) : {};
		
		debug(`[Tracker Enhanced] Completion preset resolution`, {
			desired: extensionSettings.selectedCompletionPreset,
			resolved: presetName,
			includePreset,
			presetSource,
			apiType,
		});
		if (Object.keys(overridePayload).length > 0) {
			debug("[Tracker Enhanced] Applying preset override payload", overridePayload);
		}
		
		// Always use independent connection - even for "current" profile
		log(`[Tracker Enhanced] 🔒 Using INDEPENDENT connection with profile: ${extensionSettings.selectedProfile} (ID: ${profileId})`);
		log(`[Tracker Enhanced] This request will NOT interfere with SillyTavern's main connection`);
		
		// Check if ConnectionManagerRequestService is available
		if (!ctx.ConnectionManagerRequestService) {
			if (shouldOverridePreset) {
				profile.preset = originalPreset;
			}
			error(`[Tracker Enhanced] ❌ ConnectionManagerRequestService not available in context`);
			error(`[Tracker Enhanced] Available context methods:`, Object.keys(ctx).filter(k => k.includes('Connection') || k.includes('generate')));
			throw new Error('ConnectionManagerRequestService not available');
		}
		
		log(`[Tracker Enhanced] ✅ ConnectionManagerRequestService is available`);
		log(`[Tracker Enhanced] 📤 About to call ctx.ConnectionManagerRequestService.sendRequest`);
		log(`[Tracker Enhanced] Parameters:`, { 
			profileId, 
			promptLength: prompt?.length || 0, 
			maxTokens,
			includePreset,
			includeInstruct: false,
			resolvedPreset: presetName,
			presetSource,
			apiType,
			overrideKeys: Object.keys(overridePayload),
		});
		
		let response;
		try {
			// Use ConnectionManagerRequestService from context
			response = await ctx.ConnectionManagerRequestService.sendRequest(
			profileId,
			[{ role: 'user', content: prompt }],
			maxTokens || 1000,
			{
				extractData: true,
				includePreset,
				includeInstruct: false,
			},
			overridePayload
		);
		} finally {
			if (shouldOverridePreset) {
				profile.preset = originalPreset;
			}
		}
		
		log(`[Tracker Enhanced] 📥 Raw response from ConnectionManagerRequestService:`, response);
		log(`[Tracker Enhanced] ✅ Independent connection request successful. Response length: ${response?.content?.length || 0} characters`);
		
		if (!response || !response.content) {
			error(`[Tracker Enhanced] ❌ Invalid response from ConnectionManagerRequestService:`, response);
			throw new Error('Invalid response from ConnectionManagerRequestService');
		}
		
		return response.content;
		
	} catch (err) {
		error(`[Tracker Enhanced] ❌ Failed to send independent generation request:`, err);
		error(`[Tracker Enhanced] ❌ Error details:`, err.message);
		error(`[Tracker Enhanced] ❌ Stack trace:`, err.stack);
		
		// Re-throw to be handled by calling function
		throw err;
	}
}

/**
 * Generates a new tracker for a given message number.
 * @param {number} mesNum - The message number.
 * @param {string} includedFields - Which fields to include in the tracker.
 * @returns {object|null} The new tracker object or null if failed.
 */
export async function generateTracker(mesNum, includedFields = FIELD_INCLUDE_OPTIONS.DYNAMIC) {
	if (mesNum == null || mesNum < 0 || chat[mesNum].extra?.isSmallSys) return null;

	log(`[Tracker Enhanced] 🚀 Starting tracker generation for message ${mesNum} using INDEPENDENT connection`);
	debug(`[Tracker Enhanced] Selected profile: ${extensionSettings.selectedProfile}, Selected preset: ${extensionSettings.selectedCompletionPreset}`);

	try {
		const tracker = await generateSingleStageTracker(mesNum, includedFields);

		if (!tracker) return null;

		const participantSeeds = getParticipantPolicy().participants;
		const lastMesWithTrackerIndex = getLastMessageWithTracker(mesNum);
		const lastMesWithTracker = chat[lastMesWithTrackerIndex];
		let lastTracker = lastMesWithTracker
			? lastMesWithTracker.tracker
			: getDefaultTracker(extensionSettings.trackerDef, FIELD_INCLUDE_OPTIONS.ALL, OUTPUT_FORMATS.JSON, participantSeeds);
		const internalOutput = {};
		const result = updateTracker(lastTracker, tracker, extensionSettings.trackerDef, FIELD_INCLUDE_OPTIONS.ALL, OUTPUT_FORMATS.JSON, true, internalOutput);
		debug("[Tracker Enhanced] Internal collector after updateTracker", { internalOutput });

		const previousInternal = lastMesWithTracker?.trackerInternal ?? {};
		const internalData = (internalOutput.data && typeof internalOutput.data === "object") ? internalOutput.data : {};
		const anchorValue = internalData.TimeAnchor ?? tracker?.TimeAnchor ?? previousInternal.TimeAnchor ?? null;
		if (anchorValue) {
			internalData.TimeAnchor = anchorValue;
			const timeAnalysis = buildTimeAnalysis(anchorValue, previousInternal.TimeAnalysis ?? null);
			if (timeAnalysis) {
				internalData.TimeAnalysis = timeAnalysis;
			}
		} else if (previousInternal.TimeAnalysis) {
			if (previousInternal.TimeAnchor) {
				internalData.TimeAnchor = previousInternal.TimeAnchor;
			}
			internalData.TimeAnalysis = previousInternal.TimeAnalysis;
		}

		if (Object.keys(internalData).length > 0) {
			internalOutput.data = internalData;
			debug("[Tracker Enhanced] Internal data prepared for trackerInternal", { internalData });
		}
		if (result && typeof result === "object") {
			delete result.TimeAnchor;
			delete result.TimeAnalysis;
		}
		
		log(`[Tracker Enhanced] ✅ Tracker generation completed successfully using independent connection`);
		debug("[Tracker Enhanced] Returning tracker generation result", { tracker: result, trackerInternal: internalOutput.data ?? null });
		return {
			tracker: result,
			trackerInternal: internalOutput.data ?? null,
		};
	} catch (e) {
		error(`[Tracker Enhanced] ❌ Failed to generate tracker using independent connection:`, e);
		toastr.error("Failed to generate tracker. Make sure your selected connection profile and completion preset are valid and working");
		return null;
	}
}

async function generateSingleStageTracker(mesNum, includedFields) {
	// Build system and request prompts
	const systemPrompt = getGenerateSystemPrompt(mesNum, includedFields);
	const requestPrompt = getRequestPrompt(extensionSettings.generateRequestPrompt, mesNum, includedFields);

	let responseLength = extensionSettings.responseLength > 0 ? extensionSettings.responseLength : null;

	// Generate tracker using the AI model
	log("Generating tracker with prompts:", { systemPrompt, requestPrompt, responseLength, mesNum });
	log(`[Tracker Enhanced] 🎯 SINGLE-STAGE: About to call sendGenerateTrackerRequest`);
	const tracker = await sendGenerateTrackerRequest(systemPrompt, requestPrompt, responseLength);
	log(`[Tracker Enhanced] 🎯 SINGLE-STAGE: sendGenerateTrackerRequest returned:`, tracker);

	return tracker;
}

/**
 * Sends the generation request to the AI model and parses the tracker response.
 * @param {string} systemPrompt
 * @param {string} requestPrompt
 * @param {number|null} responseLength
 */
async function sendGenerateTrackerRequest(systemPrompt, requestPrompt, responseLength) {
	log(`[Tracker Enhanced] 📤 Sending tracker generation request via independent connection`);
	log(`[Tracker Enhanced] 🔧 About to call sendIndependentGenerationRequest...`);
	
	try {
		let tracker = await sendIndependentGenerationRequest(systemPrompt + '\n\n' + requestPrompt, responseLength);
		log("Generated tracker:", { tracker });

		let newTracker;
		try {
			if(extensionSettings.trackerFormat == trackerFormat.JSON) tracker = unescapeJsonString(tracker);
			const trackerContent = tracker.match(/<(?:tracker|Tracker)>([\s\S]*?)<\/(?:tracker|Tracker)>/);
			let result = trackerContent ? trackerContent[1].trim() : null;
			if(extensionSettings.trackerFormat == trackerFormat.YAML) result = yamlToJSON(result);
			newTracker = JSON.parse(result);
			log(`[Tracker Enhanced] ✅ Successfully parsed tracker response from independent connection`);
		} catch (e) {
			error(`[Tracker Enhanced] ❌ Failed to parse tracker from independent connection:`, tracker, e);
			toastr.error("Failed to parse the generated tracker. Make sure your token count is not low or set the response length override.");
			return null;
		}

		log("Parsed tracker:", { newTracker });
		logUnexpectedFieldKeys(newTracker, extensionSettings.trackerDef);
		const normalizedTracker = getTracker(newTracker, extensionSettings.trackerDef, FIELD_INCLUDE_OPTIONS.ALL, true, OUTPUT_FORMATS.JSON);
		debug("Normalized tracker after parse:", { normalizedTracker });
		return normalizedTracker;
		
	} catch (err) {
		error(`[Tracker Enhanced] ❌ sendIndependentGenerationRequest failed, falling back to old method:`, err);
		
		// Fallback to the old generateRaw method if independent connection fails
		log(`[Tracker Enhanced] 🔄 Using fallback: generateRaw`);
		let tracker = await generateRaw(systemPrompt + '\n\n' + requestPrompt, null, false, false, '', responseLength);
		log("Generated tracker (fallback):", { tracker });

		let newTracker;
		try {
			if(extensionSettings.trackerFormat == trackerFormat.JSON) tracker = unescapeJsonString(tracker);
			const trackerContent = tracker.match(/<(?:tracker|Tracker)>([\s\S]*?)<\/(?:tracker|Tracker)>/);
			let result = trackerContent ? trackerContent[1].trim() : null;
			if(extensionSettings.trackerFormat == trackerFormat.YAML) result = yamlToJSON(result);
			newTracker = JSON.parse(result);
			log(`[Tracker Enhanced] ✅ Successfully parsed tracker response from fallback method`);
		} catch (e) {
			error(`[Tracker Enhanced] ❌ Failed to parse tracker from fallback method:`, tracker, e);
			toastr.error("Failed to parse the generated tracker. Make sure your token count is not low or set the response length override.");
			return null;
		}

		log("Parsed tracker (fallback):", { newTracker });
		logUnexpectedFieldKeys(newTracker, extensionSettings.trackerDef);
		const normalizedTracker = getTracker(newTracker, extensionSettings.trackerDef, FIELD_INCLUDE_OPTIONS.ALL, true, OUTPUT_FORMATS.JSON);
		debug("Normalized tracker after fallback parse:", { normalizedTracker });
		return normalizedTracker;
	}
}

// #region Tracker Prompt Functions

/**
 * Uses `extensionSettings.generateContextTemplate` and `extensionSettings.generateSystemPrompt`.
 * @param {number} mesNum
 * @param {string} includedFields
 * @returns {string} The system prompt.
 */
function getGenerateSystemPrompt(mesNum, includedFields = FIELD_INCLUDE_OPTIONS.DYNAMIC) {
	const participantPolicy = getParticipantPolicy();
	const trackerSystemPrompt = getSystemPrompt(extensionSettings.generateSystemPrompt, includedFields, participantPolicy);
	const characterDescriptions = getCharacterDescriptions();
	const recentMessages = getRecentMessages(extensionSettings.generateRecentMessagesTemplate, mesNum, includedFields);
	const currentTracker = getCurrentTracker(mesNum, includedFields, participantPolicy.participants);
	const trackerFormat = extensionSettings.trackerFormat;
	const trackerFieldPrompt = getTrackerPrompt(extensionSettings.trackerDef, includedFields);

	const vars = {
		trackerSystemPrompt,
		characterDescriptions,
		recentMessages,
		currentTracker,
		trackerFormat,
		trackerFieldPrompt,
		participantGuidance: participantPolicy.guidance || "",
	};

	debug("Generated Tracker Generation System Prompt:", vars);
	return formatTemplate(extensionSettings.generateContextTemplate, vars);
}

function getSystemPrompt(template, includedFields, participantPolicy = null) {
	const namesContext = participantPolicy?.names || collectParticipantNames();
	const charNames = [];

	const baseUserName = typeof namesContext.user === "string" ? namesContext.user : name1;
	if (typeof baseUserName === "string") {
		const trimmedUser = baseUserName.trim();
		if (trimmedUser) {
			charNames.push(trimmedUser);
		} else {
			charNames.push(baseUserName);
		}
	}

	const unique = new Set(charNames);
	const characterEntries = Array.isArray(namesContext.characters) ? namesContext.characters : [];
	for (const characterName of characterEntries) {
		if (typeof characterName === "string") {
			const trimmed = characterName.trim();
			if (trimmed && !unique.has(trimmed)) {
				unique.add(trimmed);
				charNames.push(trimmed);
			}
		}
	}

	if (charNames.length === 0 && typeof name1 === "string" && name1.trim()) {
		charNames.push(name1.trim());
	}

	let namesJoined;
	if (charNames.length === 1) namesJoined = charNames[0];
	else if (charNames.length === 2) namesJoined = charNames.join(" and ");
	else if (charNames.length > 2) namesJoined = `${charNames.slice(0, -1).join(", ")}, and ${charNames.slice(-1)}`;
	else namesJoined = "";

	const participantSeeds = Array.isArray(participantPolicy?.participants) ? participantPolicy.participants : [];
	const defaultTrackerJson = getDefaultTracker(
		extensionSettings.trackerDef,
		includedFields,
		OUTPUT_FORMATS.JSON,
		participantSeeds
	);

	let defaultTrackerVal;
	if (extensionSettings.trackerFormat === trackerFormat.JSON) {
		defaultTrackerVal = JSON.stringify(defaultTrackerJson, null, 2);
	} else {
		defaultTrackerVal = jsonToYAML(defaultTrackerJson).trim();
	}

	const vars = {
		charNames: namesJoined,
		defaultTracker: defaultTrackerVal,
		trackerFormat: extensionSettings.trackerFormat,
	};

	return formatTemplate(template, vars);
}

/**
 * Retrieves character descriptions. {{char}}, {{charDescription}}
 */
function getCharacterDescriptions() {
	const characterDescriptions = [];

	// Get main character's persona
	let { persona } = getCharacterCardFields();
	if (persona) {
		characterDescriptions.push({ name: name1, description: persona });
	}

	// Get group members' descriptions if in a group
	if (selected_group) {
		const group = groups.find((g) => g.id == selected_group);
		const active = group.members.filter((m) => !group.disabled_members.includes(m));
		active.forEach((m) => {
			const char = characters.find((c) => c.avatar == m);
			if (!char?.name) {
				return;
			}

			const resolvedDescription = baseChatReplace(char.description?.trim(), name1, char.name)?.trim();
			if (resolvedDescription) {
				characterDescriptions.push({ name: char.name, description: resolvedDescription });
			}
		});
	} else if (this_chid !== undefined && this_chid !== null) {
		const char = characters[this_chid];
		if (char?.name) {
			const resolvedDescription = baseChatReplace(char.description?.trim(), name1, char.name)?.trim();
			if (resolvedDescription) {
				characterDescriptions.push({ name: char.name, description: resolvedDescription });
			}
		}
	}

	let charDescriptionString = "";
	const template = extensionSettings.characterDescriptionTemplate;
	characterDescriptions.forEach((char) => {
		charDescriptionString +=
			formatTemplate(template, {
				char: char.name,
				charDescription: char.description,
			}) + "\n\n";
	});

	return charDescriptionString.trim();
}

/**
 * Retrieves recent messages up to a certain number and formats them. {{char}}, {{message}}, {{tracker}}, {{#if tracker}}...{{/if}}
 */
function getRecentMessages(template, mesNum, includedFields) {
	const messages = chat.filter((c, index) => !c.is_system && index <= mesNum).slice(-extensionSettings.numberOfMessages);
	if (messages.length === 0) return "";

	const includeTrackers = extensionSettings.includeTrackersInRecentMessages === true;
	const entryTemplateSource =
		typeof extensionSettings.generateRecentMessageEntryTemplate === "string" &&
		extensionSettings.generateRecentMessageEntryTemplate.trim()
			? extensionSettings.generateRecentMessageEntryTemplate
			: DEFAULT_RECENT_MESSAGE_ENTRY_TEMPLATE;

	const formattedMessages = messages.map((c) => {
		const name = c.name;
		const message = c.mes.replace(/<tracker>[\s\S]*?<\/tracker>/g, "").trim();

		let hasTracker = includeTrackers && c.tracker && Object.keys(c.tracker).length !== 0;
		let trackerContent = "";
		if (hasTracker) {
			try {
				trackerContent = getTracker(c.tracker, extensionSettings.trackerDef, includedFields, false, OUTPUT_FORMATS[extensionSettings.trackerFormat]);
				if (extensionSettings.trackerFormat == trackerFormat.JSON) {
					trackerContent = JSON.stringify(trackerContent, null, 2);
				}
			} catch (e) {
				warn(e);
				hasTracker = false;
				trackerContent = "";
			}
		}

		let entry = formatTemplate(entryTemplateSource, { char: name, message, tracker: trackerContent });
		entry = conditionalSection(entry, "tracker", hasTracker && !!trackerContent);
		return entry.trim();
	});

	if (formattedMessages.length === 0) return "";

	const precedingMessages = formattedMessages.slice(0, -1).join("\n").trim();
	const lastMessage = formattedMessages[formattedMessages.length - 1] || "";
	const recentMessages = formattedMessages.join("\n").trim();
	const vars = {
		precedingMessages,
		lastMessage,
		recentMessages,
	};

	const blockTemplate = typeof template === "string" ? template : "";
	if (!blockTemplate.trim()) {
		return recentMessages;
	}
	let rendered = formatTemplate(blockTemplate, vars);
	rendered = conditionalSection(rendered, "precedingMessages", Boolean(precedingMessages));
	rendered = conditionalSection(rendered, "lastMessage", Boolean(lastMessage));
	rendered = conditionalSection(rendered, "recentMessages", Boolean(recentMessages));

	return rendered.trim();
}

/**
 * Retrieves the current tracker.
 */
function getCurrentTracker(mesNum, includedFields, participantSeeds = null) {
	debug("Getting current tracker for message:", { mesNum });
	const message = chat[mesNum];
	const tracker = message.tracker;
	let returnTracker;
	if (tracker && Object.keys(tracker).length !== 0) {
		returnTracker = getTracker(tracker, extensionSettings.trackerDef, includedFields, false, OUTPUT_FORMATS[extensionSettings.trackerFormat]);
	} else {
		const lastMesWithTrackerIndex = getLastMessageWithTracker(mesNum);
		const lastMesWithTracker = chat[lastMesWithTrackerIndex];
		if (lastMesWithTracker) returnTracker = getTracker(lastMesWithTracker.tracker, extensionSettings.trackerDef, includedFields, false, OUTPUT_FORMATS[extensionSettings.trackerFormat]);
		else returnTracker = getDefaultTracker(
			extensionSettings.trackerDef,
			includedFields,
			OUTPUT_FORMATS[extensionSettings.trackerFormat],
			participantSeeds
		);
	}

	if (extensionSettings.trackerFormat == trackerFormat.JSON) {
		returnTracker = JSON.stringify(returnTracker, null, 2);
	}

	return returnTracker;
}

/**
 * @param {string} template - The request prompt template from extensionSettings.
 * @param {number|null} mesNum - The message number.
 * @param {string} includedFields
 */
export function getRequestPrompt(template, mesNum = null, includedFields) {
	let messageText = "";
	if (mesNum != null) {
		const message = chat[mesNum];
		messageText = message.mes;
	}

	const trackerFieldPromptVal = getTrackerPrompt(extensionSettings.trackerDef, includedFields);
	const vars = {
		message: messageText,
		trackerFieldPrompt: trackerFieldPromptVal,
		trackerFormat: extensionSettings.trackerFormat,
	};

	return formatTemplate(template, vars);
}
// #endregion

function logUnexpectedFieldKeys(tracker, backendObj) {
	if (!tracker || typeof tracker !== "object" || !backendObj || typeof backendObj !== "object") {
		return;
	}

	const knownIds = new Set();
	for (const field of Object.values(backendObj)) {
		const fieldId = getFieldId(field);
		if (fieldId) {
			knownIds.add(fieldId);
		}
	}

	const unexpectedKeys = Object.keys(tracker).filter((key) => key !== "_extraFields" && !knownIds.has(key));
	const hasExtraFields = Object.prototype.hasOwnProperty.call(tracker, "_extraFields");

	if (unexpectedKeys.length === 0 && !hasExtraFields) {
		return;
	}

	const payload = {};
	if (unexpectedKeys.length > 0) {
		payload.unexpectedKeys = unexpectedKeys;
	}
	if (hasExtraFields) {
		const extraFieldPaths = flattenExtraFieldPaths(tracker._extraFields);
		if (extraFieldPaths.length > 0) {
			const sortedPaths = [...extraFieldPaths].sort();
			payload.extraFieldPaths = sortedPaths.slice(0, EXTRA_FIELD_LOG_LIMIT);
			if (sortedPaths.length > EXTRA_FIELD_LOG_LIMIT) {
				payload.extraFieldPathsTruncated = true;
				payload.totalExtraFieldPaths = sortedPaths.length;
			}
		} else {
			payload.extraFieldPaths = [];
		}
	}

	warn(
		"[Tracker Enhanced] Parsed tracker includes unrecognized field keys; they will be stored in _extraFields. Reset extension defaults or rebuild the source preset to eliminate legacy data.",
		payload
	);
}

function flattenExtraFieldPaths(extraFields, prefix = []) {
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
			const nested = flattenExtraFieldPaths(value, nextPrefix);
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
