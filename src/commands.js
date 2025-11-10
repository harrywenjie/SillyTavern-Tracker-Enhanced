import { debug, getLastNonSystemMessageIndex, getPreviousNonSystemMessageIndex } from "../lib/utils.js";
import { saveChatConditional, chat, chat_metadata, saveSettingsDebounced } from "../../../../../script.js";
import { generateTracker } from "./generation.js";
import { injectTracker } from "./tracker.js";
import { FIELD_INCLUDE_OPTIONS, getTracker, OUTPUT_FORMATS } from "./trackerDataHandler.js";
import { TrackerPreviewManager } from "./ui/trackerPreviewManager.js";
import { TrackerInterface } from "./ui/trackerInterface.js";
import { extensionSettings } from "../index.js";
import { isEnabled, toggleExtension } from "./settings/settings.js";

export async function generateTrackerCommand(args, value){
    let mesId = args?.message;
    if (!mesId) {
        mesId = getLastNonSystemMessageIndex();
    }

    if (!mesId) {
        throw new Error(`No valid message found to generate a tracker.`);
    }

    let include = args?.include ? args.include.toUpperCase() : null;
    if(!include || !Object.keys(FIELD_INCLUDE_OPTIONS).includes(include)) include = 'DYNAMIC';

    const previousMesId = getPreviousNonSystemMessageIndex(mesId);
    if (previousMesId !== -1) {
        debug("Generating tracker for message " + mesId + " from command");
        const tracker = await generateTracker(previousMesId, FIELD_INCLUDE_OPTIONS[include]);
        
        if (tracker) {
            return JSON.stringify(tracker);
        } else {
            throw new Error(`Invalid response from tracker generation.`);
        }
    } else {
        throw new Error(`No valid message found before message ${mesId} to generate a tracker.`);
    }
}

export async function trackerOverrideCommand(args, value){
    const trackerString = args?.tracker;

    if (!trackerString) return;

    const tracker = JSON.parse(trackerString);

    if (!tracker) {
        throw new Error(`Invalid tracker object provided.`);
    }

    if(!chat_metadata.tracker) chat_metadata.tracker = {};
    chat_metadata.tracker.cmdTrackerOverride = tracker;
    await saveChatConditional();

    return JSON.stringify(tracker);
}

export async function saveTrackerToMessageCommand(args, value){
    const mesId = args?.message ?? getLastNonSystemMessageIndex();
    const trackerString = args?.tracker;

    if (!mesId || !trackerString) {
        throw new Error(`Invalid message or tracker provided.`);
    }

    const tracker = JSON.parse(trackerString);

    if (!tracker) {
        throw new Error(`Invalid tracker object provided.`);
    }

    chat[mesId].tracker = tracker;
    await saveChatConditional();
    TrackerPreviewManager.updatePreview(mesId);

    return JSON.stringify(tracker);
}

export async function getTrackerCommand(args, value){
    const mesId = args?.message ?? getLastNonSystemMessageIndex();

    if (!mesId) {
        throw new Error(`No valid message found to generate a tracker.`);
    }

    const trackerRaw = chat[mesId]?.tracker;

    if (!trackerRaw) {
        throw new Error(`No tracker found for message ${mesId}.`);
    }

    const tracker = getTracker(trackerRaw, extensionSettings.trackerDef, FIELD_INCLUDE_OPTIONS.ALL, true, OUTPUT_FORMATS.JSON);

    return JSON.stringify(tracker);
}

export async function stateTrackerCommand(args, value){
    const enabledString = args?.enabled;

    var enabled = isEnabled();

    if (enabledString) {
        var enabled = enabledString.toLowerCase() === 'true';
        await toggleExtension(enabled);
    }

    return enabled ? "true" : "false";
}

export async function toggleTrackerInjectionCommand(args, value) {
    let desired = args?.enabled;
    if (desired === undefined && typeof value === 'string' && value.trim().length > 0) {
        desired = value.trim();
    }

    let normalized;
    if (typeof desired === 'boolean') {
        normalized = desired;
    } else if (typeof desired === 'string') {
        const lowered = desired.trim().toLowerCase();
        if (['true', 'on', 'enable', 'enabled', '1', 'yes'].includes(lowered)) {
            normalized = true;
        } else if (['false', 'off', 'disable', 'disabled', '0', 'no'].includes(lowered)) {
            normalized = false;
        }
    }

    if (normalized === undefined) {
        normalized = !(extensionSettings.trackerInjectionEnabled !== false);
    }

    extensionSettings.trackerInjectionEnabled = normalized;
    saveSettingsDebounced();

    if (!normalized) {
        try {
            await injectTracker("", 0);
        } catch (err) {
            console.error('[tracker-enhanced] Failed to clear tracker injection via slash command', err);
        }
    }

    if (typeof TrackerInterface.syncInjectionToggle === 'function') {
        TrackerInterface.syncInjectionToggle(normalized);
    }

    return normalized ? 'true' : 'false';
}
