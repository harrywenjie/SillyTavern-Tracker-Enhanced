let debug = () => {};
let warn = () => {};

if (typeof window !== "undefined") {
	void (async () => {
		try {
			const utilsModule = await import("./utils.js");
			if (typeof utilsModule?.debug === "function") {
				debug = utilsModule.debug;
			}
			if (typeof utilsModule?.warn === "function") {
				warn = utilsModule.warn;
			}
		} catch (err) {
			// Silently fall back to no-op loggers when utilities are unavailable (e.g. CLI scripts).
		}
	})();
}

/**
 * Field identity helpers centralize how tracker schemas reference fields.
 * Runtime code now requires canonical identifiers and labels; any missing ids
 * are treated as configuration bugs so we log once and return an empty string.
 */
const missingFieldIdLogged = new WeakSet();
const missingFieldLabelLogged = new WeakSet();

/**
 * Resolves the canonical field identifier. Missing ids trigger a warning once.
 * @param {object} field - Field schema node.
 * @returns {string} Canonical field id.
 */
export function getFieldId(field) {
	if (!field || typeof field !== "object") {
		return "";
	}

	const rawId = typeof field.id === "string" ? field.id.trim() : "";
	if (rawId) {
		return rawId;
	}

	if (!missingFieldIdLogged.has(field)) {
		missingFieldIdLogged.add(field);
		warn("[Tracker Enhanced] Field is missing a canonical id; tracker data may be unreliable.", { field });
	}

	return "";
}

/**
 * Resolves the display label for a field, preferring `label` then `id`.
 * @param {object} field - Field schema node.
 * @returns {string} Human-readable label.
 */
export function getFieldLabel(field) {
	if (!field || typeof field !== "object") {
		return "";
	}

	const rawLabel = typeof field.label === "string" ? field.label.trim() : "";
	if (rawLabel) {
		return rawLabel;
	}

	const fallbackId = getFieldId(field);
	if (fallbackId) {
		if (!missingFieldLabelLogged.has(field)) {
			missingFieldLabelLogged.add(field);
			debug("getFieldLabel fallback to field id due to missing label", { fieldId: fallbackId });
		}
		return fallbackId;
	}

	return "";
}

/**
 * Determines which key inside a tracker node currently holds the field value.
 * @param {object} node - Tracker data object.
 * @param {object} field - Field schema node.
 * @returns {string|null} Matching key or null if none found.
 */
export function getExistingFieldKey(node, field) {
	if (!node || typeof node !== "object") {
		return null;
	}

	const fieldId = getFieldId(field);
	if (fieldId && Object.prototype.hasOwnProperty.call(node, fieldId)) {
		return fieldId;
	}

	return null;
}

/**
 * Reads the tracker value for a field using the canonical id.
 * @param {object} node - Tracker data object.
 * @param {object} field - Field schema node.
 * @returns {*} Field value or undefined.
 */
export function resolveTrackerValue(node, field) {
	if (!node || typeof node !== "object") {
		return undefined;
	}

	const key = getExistingFieldKey(node, field);
	if (key === null) {
		return undefined;
	}

	return node[key];
}

/**
 * Assigns a tracker value using the canonical id.
 * @param {object} node - Tracker data object.
 * @param {object} field - Field schema node.
 * @param {*} value - Value to assign.
 */
export function assignTrackerValue(node, field, value) {
	if (!node || typeof node !== "object") {
		return;
	}

	const fieldId = getFieldId(field);
	if (!fieldId) {
		return;
	}

	node[fieldId] = value;
}

/**
 * Removes a field from the tracker node using the canonical id.
 * @param {object} node - Tracker data object.
 * @param {object} field - Field schema node.
 */
export function deleteFieldFromNode(node, field) {
	if (!node || typeof node !== "object") {
		return;
	}

	const fieldId = getFieldId(field);
	if (fieldId && Object.prototype.hasOwnProperty.call(node, fieldId)) {
		delete node[fieldId];
	}
}
