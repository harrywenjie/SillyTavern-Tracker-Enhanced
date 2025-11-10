import { debug } from "../../../lib/utils.js";

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
        const indent = ' '.repeat(indentLevel * this.indentSize);

        for (const [fieldKey, fieldData] of Object.entries(fields)) {
            if (!fieldData || typeof fieldData !== 'object') continue;

            const fieldName = fieldData.name || fieldKey;
            const fieldType = this.normalizeFieldType(fieldData.type);
            const isNested = fieldData.nestedFields && Object.keys(fieldData.nestedFields).length > 0;

            switch (fieldType) {
                case 'String':
                    items.push(this.generateStringField(fieldName, fieldKey, indent));
                    break;
                    
                case 'Array':
                case 'For Each Array':
                    items.push(this.generateArrayField(fieldName, fieldKey, indent));
                    break;
                    
                case 'Object':
                    if (isNested) {
                        items.push(this.generateObjectField(fieldName, fieldData.nestedFields, indentLevel));
                    } else {
                        items.push(this.generateStringField(fieldName, fieldKey, indent));
                    }
                    break;
                    
                case 'For Each Object':
                    items.push(this.generateForEachObjectField(fieldName, fieldKey, fieldData.nestedFields, indentLevel));
                    break;
                    
                case 'Array Object':
                    items.push(this.generateArrayObjectField(fieldName, fieldKey, fieldData.nestedFields, indentLevel));
                    break;
                    
                default:
                    items.push(this.generateStringField(fieldName, fieldKey, indent));
                    break;
            }
        }

        return items.join('\n');
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
    generateStringField(fieldName, fieldKey, indent) {
        return `${indent}<tr>\n${indent}    <td>${fieldName}:</td>\n${indent}    <td>{{${fieldName}}}</td>\n${indent}</tr>`;
    }

    /**
     * Generates HTML for an array field
     * @param {string} fieldName - Display name of the field
     * @param {string} fieldKey - Key name for template macro
     * @param {string} indent - Indentation string
     * @returns {string} - Generated HTML
     */
    generateArrayField(fieldName, fieldKey, indent) {
        return `${indent}<tr>\n${indent}    <td>${fieldName}:</td>\n${indent}    <td>{{#join "; " ${fieldName}}}</td>\n${indent}</tr>`;
    }

    /**
     * Generates HTML for an object field with nested content
     * @param {string} fieldName - Display name of the field
     * @param {Object} nestedFields - Nested field definitions
     * @param {number} indentLevel - Current indentation level
     * @returns {string} - Generated HTML
     */
    generateObjectField(fieldName, nestedFields, indentLevel) {
        const indent = ' '.repeat(indentLevel * this.indentSize);
        const innerIndent = ' '.repeat((indentLevel + 1) * this.indentSize);
        const nestedContent = this.generateFieldsContent(nestedFields, indentLevel + 2);
        
        return `${indent}<details>\n${indent}    <summary><span>${fieldName}</span></summary>\n${innerIndent}<table>\n${nestedContent}\n${innerIndent}</table>\n${indent}</details>`;
    }

    /**
     * Generates HTML for a "For Each Object" field
     * @param {string} fieldName - Display name of the field
     * @param {string} fieldKey - Key name for template macro
     * @param {Object} nestedFields - Nested field definitions
     * @param {number} indentLevel - Current indentation level
     * @returns {string} - Generated HTML
     */
    generateForEachObjectField(fieldName, fieldKey, nestedFields, indentLevel) {
        const indent = ' '.repeat(indentLevel * this.indentSize);
        const innerIndent = ' '.repeat((indentLevel + 1) * this.indentSize);
        
        if (!nestedFields || Object.keys(nestedFields).length === 0) {
            return `${indent}<tr>\n${indent}    <td>${fieldName}:</td>\n${indent}    <td>{{#join "; " ${fieldName}}}</td>\n${indent}</tr>`;
        }

        // Generate content for nested fields within the foreach
        const nestedItems = [];
        for (const [nestedKey, nestedData] of Object.entries(nestedFields)) {
            if (!nestedData || typeof nestedData !== 'object') continue;
            const nestedName = nestedData.name || nestedKey;
            nestedItems.push(`${innerIndent}        <tr><td>${nestedName}:</td><td>{{item.${nestedName}}}</td></tr>`);
        }

        return `${indent}<details>\n${indent}    <summary><span>${fieldName}</span></summary>\n${indent}    {{#foreach ${fieldName} item}}\n${innerIndent}    <table>\n${nestedItems.join('\n')}\n${innerIndent}    </table>\n${indent}    {{/foreach}}\n${indent}</details>`;
    }

    /**
     * Generates HTML for an "Array Object" field
     * @param {string} fieldName - Display name of the field
     * @param {string} fieldKey - Key name for template macro
     * @param {Object} nestedFields - Nested field definitions
     * @param {number} indentLevel - Current indentation level
     * @returns {string} - Generated HTML
     */
    generateArrayObjectField(fieldName, fieldKey, nestedFields, indentLevel) {
        const indent = ' '.repeat(indentLevel * this.indentSize);
        const innerIndent = ' '.repeat((indentLevel + 1) * this.indentSize);
        
        if (!nestedFields || Object.keys(nestedFields).length === 0) {
            return `${indent}<tr>\n${indent}    <td>${fieldName}:</td>\n${indent}    <td>{{#join "; " ${fieldName}}}</td>\n${indent}</tr>`;
        }

        // Generate content for nested fields within the array object
        const nestedItems = [];
        for (const [nestedKey, nestedData] of Object.entries(nestedFields)) {
            if (!nestedData || typeof nestedData !== 'object') continue;
            const nestedName = nestedData.name || nestedKey;
            nestedItems.push(`${innerIndent}        <tr><td>${nestedName}:</td><td>{{item.${nestedName}}}</td></tr>`);
        }

        return `${indent}<details>\n${indent}    <summary><span>${fieldName}</span></summary>\n${indent}    {{#foreach ${fieldName} item}}\n${innerIndent}    <table>\n${nestedItems.join('\n')}\n${innerIndent}    </table>\n${indent}    {{/foreach}}\n${indent}</details>`;
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
        template = template.replace(/(<\/table>)\n(<details>)/g, '$1\n\n$2');
        template = template.replace(/(<\/details>)\n(<tr>)/g, '$1\n\n$2');
        
        return template;
    }

    /**
     * Generates a template following the expected structure from the default
     * @param {Object} trackerDef - The tracker definition object
     * @returns {string} - Generated HTML template with expected structure
     */
    generateTableTemplate(trackerDef) {
        if (typeof debug === 'function') {
            debug('TrackerTemplateGenerator: Starting table template generation with trackerDef:', trackerDef);
        }
        
        if (!trackerDef || Object.keys(trackerDef).length === 0) {
            if (typeof debug === 'function') {
                debug('TrackerTemplateGenerator: No tracker fields defined for table template');
            }
            return '<div class="tracker_default_mes_template">\n    <p>No tracker fields defined</p>\n</div>';
        }

        const indent = '    ';
        const parts = [];
        
        // Classify fields into categories
        const topLevelFields = []; // Basic string fields that go in the first table
        const trackerSectionFields = []; // Array/Object fields that go in the tracker details section
        let charactersField = null; // Special handling for Characters field
        let charactersName = 'Characters'; // Default name for characters field
        
        for (const [fieldKey, fieldData] of Object.entries(trackerDef)) {
            if (!fieldData || typeof fieldData !== 'object') {
                continue;
            }
            
            const fieldName = fieldData.name || fieldKey;
            const fieldType = this.normalizeFieldType(fieldData.type);
            const isNested = fieldData.nestedFields && Object.keys(fieldData.nestedFields).length > 0;
            
            if (typeof debug === 'function') {
                debug(`TrackerTemplateGenerator: Processing field ${fieldKey}: name="${fieldName}", type="${fieldType}", nested=${isNested}`);
            }
            
            // Check if this is the Characters field (FOR_EACH_OBJECT type with nested fields)
            if (fieldType === 'For Each Object' && isNested) {
                charactersField = fieldData;
                charactersName = fieldName;
                if (typeof debug === 'function') {
                    debug(`TrackerTemplateGenerator: Found Characters field: ${fieldName}`);
                }
            }
            // Basic string fields go to top-level table
            else if (fieldType === 'String' && !isNested) {
                topLevelFields.push([fieldName, fieldKey]);
            }
            // Array fields and array objects go to tracker section
            else if (fieldType === 'Array' || fieldType === 'Array Object') {
                // Handle special case for Topics - if it's an array object, treat as join
                if (fieldName.toLowerCase().includes('topic') && fieldType === 'Array Object') {
                    trackerSectionFields.push([fieldName, fieldKey, 'join']);
                } else {
                    trackerSectionFields.push([fieldName, fieldKey, 'join']);
                }
            }
            // Other complex fields
            else {
                trackerSectionFields.push([fieldName, fieldKey, 'complex']);
            }
        }
        
        if (typeof debug === 'function') {
            debug('TrackerTemplateGenerator: Top-level fields:', topLevelFields);
            debug('TrackerTemplateGenerator: Tracker section fields:', trackerSectionFields);
            debug('TrackerTemplateGenerator: Characters field found:', !!charactersField);
        }
        
        // Generate top-level table for basic string fields
        if (topLevelFields.length > 0) {
            parts.push(`${indent}<table>`);
            for (const [fieldName, fieldKey] of topLevelFields) {
                parts.push(`${indent}    <tr>`);
                parts.push(`${indent}        <td>${fieldName}:</td>`);
                parts.push(`${indent}        <td>{{${fieldName}}}</td>`);
                parts.push(`${indent}    </tr>`);
            }
            parts.push(`${indent}</table>`);
        }
        
        // Generate tracker details section if we have tracker fields or characters
        if (trackerSectionFields.length > 0 || charactersField) {
            parts.push(`${indent}<details>`);
            parts.push(`${indent}    <summary><span>Tracker</span></summary>`);
            
            // Generate table for tracker section fields
            if (trackerSectionFields.length > 0) {
                parts.push(`${indent}    <table>`);
                for (const [fieldName, fieldKey, type] of trackerSectionFields) {
                    parts.push(`${indent}        <tr>`);
                    // Special handling for CharactersPresent -> "Present:"
                    const displayName = fieldName === 'CharactersPresent' ? 'Present' : 
                                       fieldName === 'Topics' ? 'Topics' : fieldName;
                    parts.push(`${indent}            <td>${displayName}:</td>`);
                    parts.push(`${indent}            <td>{{#join "; " ${fieldName}}}</td>`);
                    parts.push(`${indent}        </tr>`);
                }
                parts.push(`${indent}    </table>`);
            }
            
            // Generate characters section if we have a characters field
            if (charactersField) {
                parts.push(`${indent}    <div class="mes_tracker_characters">`);
                parts.push(`${indent}        {{#foreach ${charactersName} character}}`);
                parts.push(`${indent}        <hr>`);
                parts.push(`${indent}        <strong>{{character}}:</strong><br />`);
                parts.push(`${indent}        <table>`);
                
                // Generate character nested fields
                for (const [nestedKey, nestedData] of Object.entries(charactersField.nestedFields)) {
                    if (!nestedData || typeof nestedData !== 'object') continue;
                    const nestedName = nestedData.name || nestedKey;
                    
                    // Special display name handling
                    let displayName = nestedName;
                    if (nestedName === 'StateOfDress') {
                        displayName = 'State';
                    } else if (nestedName === 'PostureAndInteraction') {
                        displayName = 'Position';
                    }
                    
                    parts.push(`${indent}            <tr>`);
                    parts.push(`${indent}                <td>${displayName}:</td>`);
                    parts.push(`${indent}                <td>{{character.${nestedName}}}</td>`);
                    parts.push(`${indent}            </tr>`);
                }
                
                parts.push(`${indent}        </table>`);
                parts.push(`${indent}        {{/foreach}}`);
                parts.push(`${indent}    </div>`);
            }
            
            parts.push(`${indent}</details>`);
        }
        
        // Assemble final template
        const content = parts.join('\n');
        const template = `<div class="tracker_default_mes_template">\n${content}\n</div>\n<hr>`;
        
        if (typeof debug === 'function') {
            debug('TrackerTemplateGenerator: Generated template:', template);
        }
        
        return template;
    }
}
