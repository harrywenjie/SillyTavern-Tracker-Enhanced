import { getFieldId, getFieldLabel } from "../../../lib/fieldIdentity.js";

let debug = () => {};

if (typeof window !== "undefined") {
	void (async () => {
		try {
			const utilsModule = await import("../../../lib/utils.js");
			if (typeof utilsModule?.debug === "function") {
				debug = utilsModule.debug;
			}
		} catch (err) {
			// Silently fall back to a no-op logger when SillyTavern utilities are unavailable (e.g. CLI scripts).
		}
	})();
}

/**
 * Generates HTML templates for tracker data based on field definitions
 */
export class TrackerTemplateGenerator {
    constructor() {
        this.indentSize = 4; // Number of spaces for indentation
    }

    /**
     * Generates an HTML template from tracker definition
     * @param {Object} trackerDef - The tracker definition object
     * @returns {string} - Generated HTML template
     */
    generateTemplate(trackerDef) {
        if (typeof debug === 'function') {
            debug('TrackerTemplateGenerator: Starting template generation with trackerDef:', trackerDef);
        }
        
        if (!trackerDef || Object.keys(trackerDef).length === 0) {
            if (typeof debug === 'function') {
                debug('TrackerTemplateGenerator: No tracker fields defined, returning empty template');
            }
            return '<div class="tracker_default_mes_template">\n    <p>No tracker fields defined</p>\n</div>';
        }

        const content = this.generateFieldsContent(trackerDef, 1);
        if (typeof debug === 'function') {
            debug('TrackerTemplateGenerator: Generated content:', content);
        }
        
        const template = `<div class="tracker_default_mes_template">\n${content}</div>`;
        if (typeof debug === 'function') {
            debug('TrackerTemplateGenerator: Final template:', template);
        }
        
        return template;
    }

    /**
     * Generates content for all fields at a given level
     * @param {Object} fields - Fields object to process
     * @param {number} indentLevel - Current indentation level
     * @returns {string} - Generated HTML content
     */
	generateFieldsContent(fields, indentLevel = 0) {
		const items = [];
		const indent = " ".repeat(indentLevel * this.indentSize);

		for (const [fieldKey, fieldData] of Object.entries(fields || {})) {
			if (!fieldData || typeof fieldData !== "object") {
				continue;
			}

			if (this.isInternalOnlyField(fieldData)) {
				continue;
			}

			const fieldId = getFieldId(fieldData);
			const fieldLabel = getFieldLabel(fieldData) || fieldId || fieldKey;
			const metadata = fieldData.metadata || {};
			const fieldType = this.normalizeFieldType(fieldData.type);
			const isNested = fieldData.nestedFields && Object.keys(fieldData.nestedFields).length > 0;

			switch (fieldType) {
				case "String":
					items.push(this.generateStringField(fieldLabel, fieldId, indent, metadata));
					break;

				case "Array":
				case "For Each Array":
					items.push(this.generateArrayField(fieldLabel, fieldId, indent, metadata));
					break;

				case "Object":
					if (isNested) {
						items.push(this.generateObjectField(fieldLabel, fieldId, fieldData.nestedFields, indentLevel, metadata));
					} else {
						items.push(this.generateStringField(fieldLabel, fieldId, indent, metadata));
					}
					break;

				case "For Each Object":
					items.push(this.generateForEachObjectField(fieldLabel, fieldId, fieldData.nestedFields, indentLevel, metadata));
					break;

				case "Array Object":
					items.push(this.generateArrayObjectField(fieldLabel, fieldId, fieldData.nestedFields, indentLevel, metadata));
					break;

				default:
					items.push(this.generateStringField(fieldLabel, fieldId, indent, metadata));
					break;
			}
		}

		return items.join("\n");
	}

	isInternalOnlyField(fieldData) {
		if (!fieldData || typeof fieldData !== 'object') {
			return false;
		}
		const metadata = fieldData.metadata || {};
        if (metadata.internalOnly === true) {
            return true;
        }
        if (metadata.internal === true && metadata.external === false) {
            return true;
        }
		return false;
	}

	buildDataAttributes(fieldId, metadata = {}) {
		const attributes = [];
		if (fieldId) {
			attributes.push(`data-field-id="${fieldId}"`);
		}
		if (metadata && metadata.internalKeyId) {
			attributes.push(`data-internal-key-id="${metadata.internalKeyId}"`);
		}
		return attributes.length > 0 ? ` ${attributes.join(' ')}` : '';
	}

    /**
     * Normalizes field type from constants to user-friendly names
     * @param {string} fieldType - The field type (could be constant or user-friendly name)
     * @returns {string} - Normalized field type
     */
    normalizeFieldType(fieldType) {
        const typeMapping = {
            'STRING': 'String',
            'ARRAY': 'Array',
            'OBJECT': 'Object',
            'FOR_EACH_OBJECT': 'For Each Object',
            'FOR_EACH_ARRAY': 'For Each Array',
            'ARRAY_OBJECT': 'Array Object'
        };

        // Return mapped value if it exists, otherwise return the original (in case it's already normalized)
        return typeMapping[fieldType] || fieldType;
    }

    /**
     * Generates HTML for a simple string field
     * @param {string} fieldName - Display name of the field
     * @param {string} fieldKey - Key name for template macro
     * @param {string} indent - Indentation string
     * @returns {string} - Generated HTML
     */
	generateStringField(fieldLabel, fieldId, indent, metadata = {}) {
		const rowAttributes = this.buildDataAttributes(fieldId, metadata);
		const placeholder = fieldId || fieldLabel.replace(/\s+/g, "");
		return `${indent}<tr${rowAttributes}>\n${indent}    <td>${fieldLabel}:</td>\n${indent}    <td>{{${placeholder}}}</td>\n${indent}</tr>`;
	}

    /**
     * Generates HTML for an array field
     * @param {string} fieldName - Display name of the field
     * @param {string} fieldKey - Key name for template macro
     * @param {string} indent - Indentation string
     * @returns {string} - Generated HTML
     */
	generateArrayField(fieldLabel, fieldId, indent, metadata = {}) {
		const rowAttributes = this.buildDataAttributes(fieldId, metadata);
		const placeholder = fieldId || fieldLabel.replace(/\s+/g, "");
		return `${indent}<tr${rowAttributes}>\n${indent}    <td>${fieldLabel}:</td>\n${indent}    <td>{{#join "; " ${placeholder}}}</td>\n${indent}</tr>`;
	}

    /**
     * Generates HTML for an object field with nested content
     * @param {string} fieldName - Display name of the field
     * @param {Object} nestedFields - Nested field definitions
     * @param {number} indentLevel - Current indentation level
     * @returns {string} - Generated HTML
     */
	generateObjectField(fieldLabel, fieldId, nestedFields, indentLevel, metadata = {}) {
		const indent = " ".repeat(indentLevel * this.indentSize);
		const innerIndent = " ".repeat((indentLevel + 1) * this.indentSize);
		const detailsAttributes = this.buildDataAttributes(fieldId, metadata);
		const nestedContent = this.generateFieldsContent(nestedFields, indentLevel + 2);

		return `${indent}<details${detailsAttributes}>\n${indent}    <summary><span>${fieldLabel}</span></summary>\n${innerIndent}<table>\n${nestedContent}\n${innerIndent}</table>\n${indent}</details>`;
	}

    /**
     * Generates HTML for a "For Each Object" field
     * @param {string} fieldName - Display name of the field
     * @param {string} fieldKey - Key name for template macro
     * @param {Object} nestedFields - Nested field definitions
     * @param {number} indentLevel - Current indentation level
     * @returns {string} - Generated HTML
     */
	generateForEachObjectField(fieldLabel, fieldId, nestedFields, indentLevel, metadata = {}) {
		const indent = " ".repeat(indentLevel * this.indentSize);
		const innerIndent = " ".repeat((indentLevel + 1) * this.indentSize);
		const detailsAttributes = this.buildDataAttributes(fieldId, metadata);
		const placeholder = fieldId || fieldLabel.replace(/\s+/g, "");

		if (!nestedFields || Object.keys(nestedFields).length === 0) {
			return `${indent}<tr${detailsAttributes}>\n${indent}    <td>${fieldLabel}:</td>\n${indent}    <td>{{#join "; " ${placeholder}}}</td>\n${indent}</tr>`;
		}

		const nestedItems = [];
		for (const [nestedKey, nestedData] of Object.entries(nestedFields || {})) {
			if (!nestedData || typeof nestedData !== "object") {
				continue;
			}
			if (this.isInternalOnlyField(nestedData)) {
				continue;
			}
			const nestedId = getFieldId(nestedData) || nestedKey;
			const nestedLabel = getFieldLabel(nestedData) || nestedId;
			const nestedMetadata = nestedData.metadata || {};
			let displayLabel = nestedLabel;
			if (nestedId === "StateOfDress") {
				displayLabel = "State";
			} else if (nestedId === "PostureAndInteraction") {
				displayLabel = "Position";
			}
			const rowAttributes = this.buildDataAttributes(nestedId, nestedMetadata);
			nestedItems.push(`${innerIndent}        <tr${rowAttributes}><td>${displayLabel}:</td><td>{{item.${nestedId}}}</td></tr>`);
		}

		return `${indent}<details${detailsAttributes}>\n${indent}    <summary><span>${fieldLabel}</span></summary>\n${indent}    {{#foreach ${placeholder} item}}\n${innerIndent}    <table>\n${nestedItems.join("\n")}\n${innerIndent}    </table>\n${indent}    {{/foreach}}\n${indent}</details>`;
	}

    /**
     * Generates HTML for an "Array Object" field
     * @param {string} fieldName - Display name of the field
     * @param {string} fieldKey - Key name for template macro
     * @param {Object} nestedFields - Nested field definitions
     * @param {number} indentLevel - Current indentation level
     * @returns {string} - Generated HTML
     */
	generateArrayObjectField(fieldLabel, fieldId, nestedFields, indentLevel, metadata = {}) {
		const indent = " ".repeat(indentLevel * this.indentSize);
		const innerIndent = " ".repeat((indentLevel + 1) * this.indentSize);
		const detailsAttributes = this.buildDataAttributes(fieldId, metadata);
		const placeholder = fieldId || fieldLabel.replace(/\s+/g, "");

		if (!nestedFields || Object.keys(nestedFields).length === 0) {
			return `${indent}<tr${detailsAttributes}>\n${indent}    <td>${fieldLabel}:</td>\n${indent}    <td>{{#join "; " ${placeholder}}}</td>\n${indent}</tr>`;
		}

		const nestedItems = [];
		for (const [nestedKey, nestedData] of Object.entries(nestedFields || {})) {
			if (!nestedData || typeof nestedData !== "object") {
				continue;
			}
			if (this.isInternalOnlyField(nestedData)) {
				continue;
			}
			const nestedId = getFieldId(nestedData) || nestedKey;
			const nestedLabel = getFieldLabel(nestedData) || nestedId;
			const nestedMetadata = nestedData.metadata || {};
			const rowAttributes = this.buildDataAttributes(nestedId, nestedMetadata);
			nestedItems.push(`${innerIndent}        <tr${rowAttributes}><td>${nestedLabel}:</td><td>{{item.${nestedId}}}</td></tr>`);
		}

		return `${indent}<details${detailsAttributes}>\n${indent}    <summary><span>${fieldLabel}</span></summary>\n${indent}    {{#foreach ${placeholder} item}}\n${innerIndent}    <table>\n${nestedItems.join("\n")}\n${innerIndent}    </table>\n${indent}    {{/foreach}}\n${indent}</details>`;
	}

    /**
     * Validates and optimizes the generated template
     * @param {string} template - Generated template string
     * @returns {string} - Optimized template
     */
    optimizeTemplate(template) {
        // Remove excessive empty lines
        template = template.replace(/\n\s*\n\s*\n/g, '\n\n');
        
        // Ensure proper spacing around major blocks
        template = template.replace(/(<\/table>)\n(<details\b[^>]*>)/g, '$1\n\n$2');
        template = template.replace(/(<\/details>)\n(<tr\b)/g, '$1\n\n$2');
        
        return template;
    }

    /**
     * Generates a template following the expected structure from the default
     * @param {Object} trackerDef - The tracker definition object
     * @returns {string} - Generated HTML template with expected structure
     */
	generateTableTemplate(trackerDef) {
		if (typeof debug === "function") {
			debug("TrackerTemplateGenerator: Starting table template generation with trackerDef:", trackerDef);
		}

		if (!trackerDef || Object.keys(trackerDef).length === 0) {
			if (typeof debug === "function") {
				debug("TrackerTemplateGenerator: No tracker fields defined for table template");
			}
			return '<div class="tracker_default_mes_template">\n    <p>No tracker fields defined</p>\n</div>';
		}

		const indent = "    ";
		const parts = [];

		const topLevelFields = [];
		const trackerSectionFields = [];
		let charactersField = null;
		let charactersFieldId = "";
		let charactersFieldLabel = "Characters";

		for (const [fieldKey, fieldData] of Object.entries(trackerDef || {})) {
			if (!fieldData || typeof fieldData !== "object") {
				continue;
			}

			if (this.isInternalOnlyField(fieldData)) {
				if (typeof debug === "function") {
					debug(`TrackerTemplateGenerator: Skipping internal-only field ${fieldKey}`);
				}
				continue;
			}

			const fieldId = getFieldId(fieldData) || fieldKey;
			const fieldLabel = getFieldLabel(fieldData) || fieldId;
			const fieldType = this.normalizeFieldType(fieldData.type);
			const isNested = fieldData.nestedFields && Object.keys(fieldData.nestedFields).length > 0;

			if (typeof debug === "function") {
				debug(
					`TrackerTemplateGenerator: Processing field ${fieldKey}: id="${fieldId}", label="${fieldLabel}", type="${fieldType}", nested=${isNested}`
				);
			}

			if (fieldType === "For Each Object" && isNested) {
				charactersField = fieldData;
				charactersFieldId = fieldId;
				charactersFieldLabel = fieldLabel;
				if (typeof debug === "function") {
					debug(`TrackerTemplateGenerator: Found Characters field: ${fieldLabel}`);
				}
			} else if (fieldType === "String" && !isNested) {
				topLevelFields.push([fieldLabel, fieldId, fieldData]);
			} else {
				trackerSectionFields.push([fieldLabel, fieldId, fieldData]);
			}
		}

		if (typeof debug === "function") {
			debug("TrackerTemplateGenerator: Top-level fields:", topLevelFields);
			debug("TrackerTemplateGenerator: Tracker section fields:", trackerSectionFields);
			debug("TrackerTemplateGenerator: Characters field found:", !!charactersField);
		}

		if (topLevelFields.length > 0) {
			parts.push(`${indent}<table>`);
			for (const [fieldLabel, fieldId, fieldData] of topLevelFields) {
				const metadata = (fieldData && fieldData.metadata) || {};
				const rowAttributes = this.buildDataAttributes(fieldId, metadata);
				const placeholder = fieldId || fieldLabel.replace(/\s+/g, "");
				parts.push(`${indent}    <tr${rowAttributes}>`);
				parts.push(`${indent}        <td>${fieldLabel}:</td>`);
				parts.push(`${indent}        <td>{{${placeholder}}}</td>`);
				parts.push(`${indent}    </tr>`);
			}
			parts.push(`${indent}</table>`);
		}

		if (trackerSectionFields.length > 0 || charactersField) {
			parts.push(`${indent}<details>`);
			parts.push(`${indent}    <summary><span>Tracker</span></summary>`);

			if (trackerSectionFields.length > 0) {
				parts.push(`${indent}    <table>`);
				for (const [fieldLabel, fieldId, fieldData] of trackerSectionFields) {
					const metadata = (fieldData && fieldData.metadata) || {};
					const rowAttributes = this.buildDataAttributes(fieldId, metadata);
					const placeholder = fieldId || fieldLabel.replace(/\s+/g, "");
					let displayName = fieldLabel;
					if (fieldId === "CharactersPresent") {
						displayName = "Present";
					} else if (fieldId === "Topics") {
						displayName = "Topics";
					}
					parts.push(`${indent}        <tr${rowAttributes}>`);
					parts.push(`${indent}            <td>${displayName}:</td>`);
					parts.push(`${indent}            <td>{{#join "; " ${placeholder}}}</td>`);
					parts.push(`${indent}        </tr>`);
				}
				parts.push(`${indent}    </table>`);
			}

			if (charactersField) {
				const charactersAttributes = this.buildDataAttributes(charactersFieldId, charactersField.metadata || {});
				const placeholder = charactersFieldId || charactersFieldLabel.replace(/\s+/g, "");
				parts.push(`${indent}    <div class="mes_tracker_characters"${charactersAttributes}>`);
				parts.push(`${indent}        {{#foreach ${placeholder} character}}`);
				parts.push(`${indent}        <hr>`);
				parts.push(`${indent}        <strong>{{character}}:</strong><br />`);
				parts.push(`${indent}        <table>`);

				for (const [nestedKey, nestedData] of Object.entries(charactersField.nestedFields || {})) {
					if (!nestedData || typeof nestedData !== "object") {
						continue;
					}
					if (this.isInternalOnlyField(nestedData)) {
						continue;
					}
					const nestedId = getFieldId(nestedData) || nestedKey;
					const nestedLabel = getFieldLabel(nestedData) || nestedId;
					const nestedMetadata = nestedData.metadata || {};
					let displayName = nestedLabel;
					if (nestedId === "StateOfDress") {
						displayName = "State";
					} else if (nestedId === "PostureAndInteraction") {
						displayName = "Position";
					}
					const rowAttributes = this.buildDataAttributes(nestedId, nestedMetadata);
					parts.push(`${indent}            <tr${rowAttributes}>`);
					parts.push(`${indent}                <td>${displayName}:</td>`);
					parts.push(`${indent}                <td>{{character.${nestedId}}}</td>`);
					parts.push(`${indent}            </tr>`);
				}

				parts.push(`${indent}        </table>`);
				parts.push(`${indent}        {{/foreach}}`);
				parts.push(`${indent}    </div>`);
			}

			parts.push(`${indent}</details>`);
		}

		const content = parts.join("\n");
		const template = `<div class="tracker_default_mes_template">\n${content}\n</div>\n<hr>`;

		if (typeof debug === "function") {
			debug("TrackerTemplateGenerator: Generated template:", template);
		}

		return template;
	}
}
