import { saveSettingsDebounced } from "../../../../../../script.js";
import { getContext } from '../../../../../../scripts/extensions.js';

import { extensionFolderPath, extensionSettings } from "../../index.js";
import { error, debug, toTitleCase } from "../../lib/utils.js";
import { defaultSettings, generationTargets } from "./defaultSettings.js";
import { generationCaptured } from "../../lib/interconnection.js";
import { TrackerPromptMakerModal } from "../ui/trackerPromptMakerModal.js";
import { TrackerTemplateGenerator } from "../ui/components/trackerTemplateGenerator.js";
import { TrackerJavaScriptGenerator } from "../ui/components/trackerJavaScriptGenerator.js";
import { TrackerInterface } from "../ui/trackerInterface.js";
import { DevelopmentTestUI } from "../ui/developmentTestUI.js";

export { generationModes, generationTargets, trackerFormat } from "./defaultSettings.js";

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

	if (!currentSettings.trackerDef) {
		const allowedKeys = ["enabled", "generateContextTemplate", "generateSystemPrompt", "generateRequestPrompt", "roleplayPrompt", "characterDescriptionTemplate", "mesTrackerTemplate", "numberOfMessages", "responseLength", "debugMode"];

		const newSettings = {
			...defaultSettings,
			...Object.fromEntries(allowedKeys.map((key) => [key, currentSettings[key] || defaultSettings[key]])),
			oldSettings: currentSettings,
		};

		for (const key in extensionSettings) {
			if (!(key in newSettings)) {
				delete extensionSettings[key];
			}
		}

		Object.assign(extensionSettings, newSettings);
	} else {
		migrateIsDynamicToPresence(extensionSettings);

		Object.assign(extensionSettings, defaultSettings, currentSettings);
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

		setSettingsInitialValues();
		registerSettingsListeners();
		
		// Initialize Development Test UI
		DevelopmentTestUI.init();
		
		debug("Settings UI initialization completed");
	} catch (error) {
		error("Failed to load settings UI:", error);
		console.error("Tracker Enhanced: Failed to load settings UI:", error);
	}
}

/**
 * Sets the initial values for the settings UI elements based on current settings.
 */
function setSettingsInitialValues() {
	// Populate presets dropdown
	updatePresetDropdown();
	initializeOverridesDropdowns();
	updatePopupDropdown();

	$("#tracker_enhanced_enable").prop("checked", extensionSettings.enabled);
	$("#tracker_enhanced_generation_target").val(extensionSettings.generationTarget);
	$("#tracker_enhanced_show_popup_for").val(extensionSettings.showPopupFor);
	$("#tracker_enhanced_format").val(extensionSettings.trackerFormat);
	$("#tracker_enhanced_toolbar_indicator").prop("checked", extensionSettings.toolbarIndicatorEnabled !== false);
	$("#tracker_enhanced_debug").prop("checked", extensionSettings.debugMode);

	// Set other settings fields
	$("#tracker_enhanced_context_prompt").val(extensionSettings.generateContextTemplate);
	$("#tracker_enhanced_system_prompt").val(extensionSettings.generateSystemPrompt);
	$("#tracker_enhanced_request_prompt").val(extensionSettings.generateRequestPrompt);
	$("#tracker_enhanced_roleplay_prompt").val(extensionSettings.roleplayPrompt);
	$("#tracker_enhanced_recent_messages").val(extensionSettings.generateRecentMessagesTemplate);
	$("#tracker_enhanced_character_description").val(extensionSettings.characterDescriptionTemplate);
	$("#tracker_enhanced_mes_tracker_template").val(extensionSettings.mesTrackerTemplate);
	$("#tracker_enhanced_mes_tracker_javascript").val(extensionSettings.mesTrackerJavascript);
	$("#tracker_enhanced_number_of_messages").val(extensionSettings.numberOfMessages);
	$("#tracker_enhanced_generate_from_message").val(extensionSettings.generateFromMessage);
	$("#tracker_enhanced_minimum_depth").val(extensionSettings.minimumDepth);
	$("#tracker_enhanced_response_length").val(extensionSettings.responseLength);

	// Process the tracker javascript
	processTrackerJavascript();
}

// #endregion

// #region Event Listeners

/**
 * Registers event listeners for settings UI elements.
 */
function registerSettingsListeners() {
	// Preset management
	$("#tracker_enhanced_preset_select").on("change", onPresetSelectChange);
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
	$("#tracker_enhanced_enable").on("input", onSettingCheckboxInput("enabled"));
	$("#tracker_enhanced_generation_target").on("change", onSettingSelectChange("generationTarget"));
	$("#tracker_enhanced_show_popup_for").on("change", onSettingSelectChange("showPopupFor"));
	$("#tracker_enhanced_format").on("change", onSettingSelectChange("trackerFormat"));
	$("#tracker_enhanced_toolbar_indicator").on("input", (event) => {
		const enabled = $(event.currentTarget).is(":checked");
		extensionSettings.toolbarIndicatorEnabled = enabled;
		saveSettingsDebounced();
		if (typeof TrackerInterface.setIndicatorVisibility === "function") {
			TrackerInterface.setIndicatorVisibility(enabled);
		}
	});

	$("#tracker_enhanced_debug").on("input", onSettingCheckboxInput("debugMode"));

	$("#tracker_enhanced_context_prompt").on("input", onSettingInputareaInput("generateContextTemplate"));
	$("#tracker_enhanced_system_prompt").on("input", onSettingInputareaInput("generateSystemPrompt"));
	$("#tracker_enhanced_request_prompt").on("input", onSettingInputareaInput("generateRequestPrompt"));
	$("#tracker_enhanced_roleplay_prompt").on("input", onSettingInputareaInput("roleplayPrompt"));
	$("#tracker_enhanced_recent_messages").on("input", onSettingInputareaInput("generateRecentMessagesTemplate"));
	$("#tracker_enhanced_character_description").on("input", onSettingInputareaInput("characterDescriptionTemplate"));
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
		toastr.error('Failed to initialize overrides presets');

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
	for (const presetName in extensionSettings.presets) {
		const option = $("<option>").val(presetName).text(presetName);
		if (presetName === extensionSettings.selectedPreset) {
			option.attr("selected", "selected");
		}
		presetSelect.append(option);
	}
}

/**
 * Event handler for changing the selected preset.
 */
function onPresetSelectChange() {
	const selectedPreset = $(this).val();
	extensionSettings.selectedPreset = selectedPreset;
	const presetSettings = extensionSettings.presets[selectedPreset];

	// Update settings with preset settings
	Object.assign(extensionSettings, presetSettings);
	debug("Selected preset:", { selectedPreset, presetSettings, extensionSettings });

	setSettingsInitialValues();
	saveSettingsDebounced();
}

/**
 * Event handler for creating a new preset.
 */
function onPresetNewClick() {
	const presetName = prompt("Enter a name for the new preset:");
	if (presetName && !extensionSettings.presets[presetName]) {
		const newPreset = getCurrentPresetSettings();
		extensionSettings.presets[presetName] = newPreset;
		extensionSettings.selectedPreset = presetName;
		updatePresetDropdown();
		saveSettingsDebounced();
		toastr.success(`Tracker Enhanced preset ${presetName} created.`);
	} else if (extensionSettings.presets[presetName]) {
		alert("A preset with that name already exists.");
	}
}

/**
 * Event handler for creating a new preset.
 */
function onPresetSaveClick() {
	const presetName = extensionSettings.selectedPreset;

	const updatedPreset = getCurrentPresetSettings();
	extensionSettings.presets[presetName] = updatedPreset;
	saveSettingsDebounced();
	toastr.success(`Tracker Enhanced preset ${presetName} saved.`);
}

/**
 * Event handler for renaming an existing preset.
 */
function onPresetRenameClick() {
	const oldName = $("#tracker_enhanced_preset_select").val();
	if (!oldName) {
		toastr.error("No preset selected for renaming.");
		return;
	}
	
	const newName = prompt("Enter the new name for the preset:", oldName);
	if (newName && newName !== oldName && !extensionSettings.presets[newName]) {
		extensionSettings.presets[newName] = extensionSettings.presets[oldName];
		delete extensionSettings.presets[oldName];
		if (extensionSettings.selectedPreset === oldName) {
			extensionSettings.selectedPreset = newName;
		}
		updatePresetDropdown();
		saveSettingsDebounced();
		toastr.success(`Tracker Enhanced preset "${oldName}" renamed to "${newName}".`);
	} else if (extensionSettings.presets[newName]) {
		alert("A preset with that name already exists.");
	} else if (newName === oldName) {
		// User didn't change the name, no action needed
	}
}

/**
 * Event handler for renaming an existing preset.
 */
function onPresetRestoreClick() {
	const presetSettings = extensionSettings.presets[extensionSettings.selectedPreset];

	// Restore settings with preset settings
	Object.assign(extensionSettings, presetSettings);

	setSettingsInitialValues();
	saveSettingsDebounced();
	toastr.success(`Tracker Enhanced preset ${extensionSettings.selectedPreset} restored.`);
}

/**
 * Event handler for deleting a preset.
 */
function onPresetDeleteClick() {
	const presetName = $("#tracker_enhanced_preset_select").val();
	if (!presetName) {
		toastr.error("No preset selected for deletion.");
		return;
	}
	
	if (confirm(`Are you sure you want to delete the preset "${presetName}"?`)) {
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
		saveSettingsDebounced();
		toastr.success(`Tracker Enhanced preset "${presetName}" deleted.`);
	}
}

/**
 * Event handler for exporting a preset.
 */
function onPresetExportClick() {
	const presetName = $("#tracker_enhanced_preset_select").val();
	if (!presetName) {
		toastr.error("No preset selected for export.");
		return;
	}
	
	const presetData = extensionSettings.presets[presetName];
	if (!presetData) {
		toastr.error(`Preset "${presetName}" not found.`);
		return;
	}
	
	const dataStr = JSON.stringify({ [presetName]: presetData }, null, 2);
	const blob = new Blob([dataStr], { type: "application/json" });
	const url = URL.createObjectURL(blob);

	const a = $("<a>").attr("href", url).attr("download", `${presetName}.json`);
	$("body").append(a);
	a[0].click();
	a.remove();
	URL.revokeObjectURL(url);
	toastr.success(`Preset "${presetName}" exported successfully.`);
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

	const reader = new FileReader();
	reader.onload = function (e) {
		try {
			const importedPresets = JSON.parse(e.target.result);

			migrateIsDynamicToPresence(importedPresets);
			
			for (const presetName in importedPresets) {
				if (!extensionSettings.presets[presetName] || confirm(`Preset "${presetName}" already exists. Overwrite?`)) {
					extensionSettings.presets[presetName] = importedPresets[presetName];
				}
			}
			updatePresetDropdown();
			saveSettingsDebounced();
			toastr.success("Presets imported successfully.");
		} catch (err) {
			alert("Failed to import presets: " + err.message);
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
		generationMode: extensionSettings.generationMode,

		generateContextTemplate: extensionSettings.generateContextTemplate,
		generateSystemPrompt: extensionSettings.generateSystemPrompt,
		generateRequestPrompt: extensionSettings.generateRequestPrompt,
		generateRecentMessagesTemplate: extensionSettings.generateRecentMessagesTemplate,
		roleplayPrompt: extensionSettings.roleplayPrompt,
		

		
		characterDescriptionTemplate: extensionSettings.characterDescriptionTemplate,

		mesTrackerTemplate: extensionSettings.mesTrackerTemplate,
		mesTrackerJavascript: extensionSettings.mesTrackerJavascript,
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
function onSettingCheckboxInput(settingName) {
	return function () {
		const value = Boolean($(this).prop("checked"));
		extensionSettings[settingName] = value;
		saveSettingsDebounced();
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
		saveSettingsDebounced();
		if (settingName === "generationTarget") {
			updatePopupDropdown();
		}
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
		saveSettingsDebounced();
		if(settingName === "mesTrackerJavascript") {
			processTrackerJavascript();
		}
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
		saveSettingsDebounced();
	};
}

/**
 * Event handler for clicking the Tracker Prompt Maker button.
 */
function onTrackerPromptMakerClick() {
	const modal = new TrackerPromptMakerModal();
	modal.show(extensionSettings.trackerDef, (updatedTracker) => {
		extensionSettings.trackerDef = updatedTracker;
		saveSettingsDebounced();
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
			toastr.warning('No tracker fields defined. Please use the Prompt Maker to define fields first.', 'Template Generation');
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
		saveSettingsDebounced();
		
		// Show success message
		toastr.success('Template generated successfully from your Prompt Maker fields!', 'Template Generation');
		
		if (typeof debug === 'function') {
			debug('Template generation completed successfully');
		}
		
	} catch (error) {
		console.error('Failed to generate template:', error);
		toastr.error('Failed to generate template. Check console for details.', 'Template Generation');
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
			toastr.warning('No tracker fields defined. Please use the Prompt Maker to define fields first.', 'JavaScript Generation');
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
		saveSettingsDebounced();
		
		// Show success message
		toastr.success('JavaScript generated successfully with gender-specific field hiding!', 'JavaScript Generation');
		
		if (typeof debug === 'function') {
			debug('JavaScript generation completed successfully');
		}
		
	} catch (error) {
		console.error('Failed to generate JavaScript:', error);
		toastr.error('Failed to generate JavaScript. Check console for details.', 'JavaScript Generation');
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

    resetLabel.text("Click again to confirm");

    // Remove the current click event to avoid duplicate bindings
    resetButton.off("click");

    // Set a timeout to restore the original behavior after 60 seconds
    let timeoutId = setTimeout(() => {
        resetLabel.text("");
        resetButton.off("click").on("click", onTrackerPromptResetClick);
    }, 60000);

    // Bind the second-click event to reset presets
    resetButton.one("click", function () {
        clearTimeout(timeoutId); // Clear the timeout to prevent reverting behavior

		debug("Resetting tracker enhanced presets to default values while preserving connection and UI settings.");

        try {
            // Reset preset-related settings to default values while preserving connection and UI settings
            
            // Store settings that should NOT be reset
            const preservedSettings = {
                enabled: extensionSettings.enabled,
                selectedProfile: extensionSettings.selectedProfile,
                selectedCompletionPreset: extensionSettings.selectedCompletionPreset,
                generationTarget: extensionSettings.generationTarget,
                showPopupFor: extensionSettings.showPopupFor,
                trackerFormat: extensionSettings.trackerFormat
            };
            
            // Clear existing settings
            for (const key in extensionSettings) {
                delete extensionSettings[key];
            }
            
            // Apply all default settings
            Object.assign(extensionSettings, JSON.parse(JSON.stringify(defaultSettings)));
            
            // Restore the preserved settings
            Object.assign(extensionSettings, preservedSettings);
            
            // Ensure we have the first preset selected
            if (extensionSettings.presets && Object.keys(extensionSettings.presets).length > 0) {
                extensionSettings.selectedPreset = Object.keys(extensionSettings.presets)[0];
            }
            
            // Update UI components
            updatePresetDropdown();
            setSettingsInitialValues();
            processTrackerJavascript();
            
            // Save the reset settings
            saveSettingsDebounced();
            
            toastr.success("Presets and tracker definitions restored to default values. Connection and UI settings preserved.");
            
        } catch (error) {
            console.error("Failed to reset settings:", error);
            toastr.error("Failed to reset settings. Check console for details.");
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
	switch (extensionSettings.generationTarget) {
		case generationTargets.CHARACTER:
			availablePopupOptions.push(generationTargets.USER);
			availablePopupOptions.push(generationTargets.NONE);
			break;
		case generationTargets.USER:
			availablePopupOptions.push(generationTargets.CHARACTER);
			availablePopupOptions.push(generationTargets.NONE);
			break;
		case generationTargets.BOTH:
			availablePopupOptions.push(generationTargets.NONE);
			break;
		case generationTargets.NONE:
			availablePopupOptions.push(generationTargets.BOTH);
			availablePopupOptions.push(generationTargets.USER);
			availablePopupOptions.push(generationTargets.CHARACTER);
			availablePopupOptions.push(generationTargets.NONE);
			break;
	}

	if(!availablePopupOptions.includes(extensionSettings.showPopupFor)) {
		extensionSettings.showPopupFor = generationTargets.NONE;
		saveSettingsDebounced();
	}

	showPopupForSelect.empty();
	for (const popupOption of availablePopupOptions) {
		const text = toTitleCase(popupOption);
		const option = $("<option>").val(popupOption).text(text);
		if (popupOption === extensionSettings.showPopupFor) {
			option.attr("selected", "selected");
		}
		showPopupForSelect.append(option);
	}
}

// #endregion
