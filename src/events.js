import { chat } from "../../../../../script.js";
import { selected_group, is_group_generating } from "../../../../../scripts/group-chats.js";
import { debug, getLastMessageWithTracker, getLastNonSystemMessageIndex, log } from "../lib/utils.js";
import { isEnabled } from "./settings/settings.js";
import { prepareMessageGeneration, addTrackerToMessage, clearInjects } from "./tracker.js";
import { releaseGeneration } from "../lib/interconnection.js";
import { FIELD_INCLUDE_OPTIONS, getTracker, OUTPUT_FORMATS, saveTracker } from "./trackerDataHandler.js";
import { TrackerInterface } from "./ui/trackerInterface.js";
import { extensionSettings } from "../index.js";
import { TrackerPreviewManager } from "./ui/trackerPreviewManager.js";

/**
 * Event handler for when the chat changes.
 * @param {object} args - The event arguments.
 */
async function onChatChanged(args) { 
	await clearInjects();
	if (!await isEnabled()) return;
	log("Chat changed:", args);
	updateTrackerInterface();
	//TrackerPreviewManager.init();
	releaseGeneration();
}

/**
 * Event handler for after generation commands.
 * @param {string} type - The type of generation.
 * @param {object} options - Generation options.
 * @param {boolean} dryRun - Whether it's a dry run.
 */
async function onGenerateAfterCommands(type, options, dryRun) {
	if(!extensionSettings.enabled) await clearInjects();
	const enabled = await isEnabled();
	const allowedTypes = ["normal", "continue", "swipe", "regenerate", "impersonate", "group_chat"];

	if (dryRun) {
		log("GENERATION_AFTER_COMMANDS dry run skip", { type, dryRun, options });
		releaseGeneration();
		return;
	}

	if (!enabled || chat.length == 0 || (selected_group && !is_group_generating) || (typeof type != "undefined" && !allowedTypes.includes(type))) {
		debug("GENERATION_AFTER_COMMANDS Tracker skipped", { extenstionEnabled: extensionSettings.enabled, freeToRun: enabled, selected_group, is_group_generating, type });
		releaseGeneration();
		return;
	}

	if(type == "normal") type = undefined;
	log("GENERATION_AFTER_COMMANDS ", [type, options, dryRun]);
	try {
		await prepareMessageGeneration(type, options, dryRun);
	} finally {
		releaseGeneration();
	}
}

/**
 * Event handler for when a message is received.
 * @param {number} mesId - The message ID.
 */
async function onMessageReceived(mesId) {
	if (!await isEnabled() || !chat[mesId] || (chat[mesId].tracker && Object.keys(chat[mesId].tracker).length !== 0)) return;
	log("MESSAGE_RECEIVED", mesId);
	await addTrackerToMessage(mesId);
	releaseGeneration();
}

/**
 * Event handler for when a message is sent.
 * @param {number} mesId - The message ID.
 */
async function onMessageSent(mesId) {
	if (!await isEnabled() || !chat[mesId] || (chat[mesId].tracker && Object.keys(chat[mesId].tracker).length !== 0)) return;
	log("MESSAGE_SENT", mesId);
	await addTrackerToMessage(mesId);
	releaseGeneration();
}

/**
 * Event handler for when a character's message is rendered.
 */
async function onCharacterMessageRendered(mesId) {
	if (!await isEnabled() || !chat[mesId] || (chat[mesId].tracker && Object.keys(chat[mesId].tracker).length !== 0)) return;
	log("CHARACTER_MESSAGE_RENDERED");
	await addTrackerToMessage(mesId);
	releaseGeneration();
	updateTrackerInterface();
}

/**
 * Event handler for when a user's message is rendered.
 */
async function onUserMessageRendered(mesId) {
	if (!await isEnabled() || !chat[mesId] || (chat[mesId].tracker && Object.keys(chat[mesId].tracker).length !== 0)) return;
	log("USER_MESSAGE_RENDERED");
	await addTrackerToMessage(mesId);
	releaseGeneration();
	updateTrackerInterface();
}

async function generateAfterCombinePrompts(prompt) {
	debug("GENERATE_AFTER_COMBINE_PROMPTS", {prompt});
}

export const eventHandlers = {
	onChatChanged,
	onGenerateAfterCommands,
	onMessageReceived,
	onMessageSent,
	onCharacterMessageRendered,
	onUserMessageRendered,
	generateAfterCombinePrompts
};

function updateTrackerInterface() {
	const lastMesWithTrackerId = getLastMessageWithTracker();
	const tracker = chat[lastMesWithTrackerId]?.tracker ?? {};
	if(Object.keys(tracker).length === 0) return;
	const trackerData = getTracker(tracker, extensionSettings.trackerDef, FIELD_INCLUDE_OPTIONS.ALL, false, OUTPUT_FORMATS.JSON); // Get tracker data for the last message
	const onSave = (updatedTracker) => {
		saveTracker(updatedTracker, extensionSettings.trackerDef, lastMesWithTrackerId);
	};
	const trackerInterface = new TrackerInterface();
	trackerInterface.init(trackerData, lastMesWithTrackerId, onSave);
}
