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
 * Generates JavaScript code for tracker gender-specific field hiding
 */
export class TrackerJavaScriptGenerator {
    constructor() {
        // Gender mapping for field visibility
        this.genderMapping = {
            'female': ['female'],
            'male': ['male'],  
            'trans': ['trans'],
            'all': ['female', 'male', 'trans', 'unknown'] // Show for all genders
        };
    }

    /**
     * Generates JavaScript code for hiding gender-specific fields
     * @param {Object} trackerDef - The tracker definition object
     * @returns {string} - Generated JavaScript code
     */
    generateJavaScript(trackerDef) {
        if (typeof debug === 'function') {
            debug('TrackerJavaScriptGenerator: Starting JavaScript generation with trackerDef:', trackerDef);
        }
        
        if (!trackerDef || Object.keys(trackerDef).length === 0) {
            if (typeof debug === 'function') {
                debug('TrackerJavaScriptGenerator: No tracker fields defined, returning basic JavaScript');
            }
            return this.generateBasicJavaScript();
        }

        // Find character fields with gender restrictions
        const genderSpecificFields = this.extractGenderSpecificFields(trackerDef);
        
        if (typeof debug === 'function') {
            debug('TrackerJavaScriptGenerator: Found gender-specific fields:', genderSpecificFields);
        }
        
        return this.generateJavaScriptWithFields(genderSpecificFields);
    }

    /**
     * Extracts fields that have gender-specific restrictions from Characters nested fields
     * @param {Object} trackerDef - The tracker definition object
     * @returns {Object} - Object mapping gender restrictions to field names
     */
    extractGenderSpecificFields(trackerDef) {
        const genderFields = {
            'female': [],
            'male': [],
            'trans': [],
            'all': []
        };

		const normalizeDisplayName = (fieldId, fallbackLabel) => {
			const base = fallbackLabel || fieldId || "";
			switch (fieldId) {
				case "StateOfDress":
					return "State";
				case "PostureAndInteraction":
					return "Position";
				default:
					return base;
			}
		};

		for (const [fieldKey, fieldData] of Object.entries(trackerDef || {})) {
			if (!fieldData || typeof fieldData !== "object") {
				continue;
			}

			const fieldType = fieldData.type;
			const hasNestedFields = fieldData.nestedFields && Object.keys(fieldData.nestedFields).length > 0;
			const fieldId = getFieldId(fieldData) || fieldKey;
			const isCharactersField = fieldType === "FOR_EACH_OBJECT" && hasNestedFields;

			if (isCharactersField) {
				if (typeof debug === "function") {
					debug(`TrackerJavaScriptGenerator: Found Characters field: ${fieldId}`);
				}

				for (const [nestedKey, nestedData] of Object.entries(fieldData.nestedFields || {})) {
					if (!nestedData || typeof nestedData !== "object") {
						continue;
					}

					const nestedId = getFieldId(nestedData) || nestedKey;
					const nestedLabel = getFieldLabel(nestedData) || nestedId;
					const displayName = normalizeDisplayName(nestedId, nestedLabel);
					const genderSpecific = nestedData.genderSpecific || "all";
					const metadata = nestedData.metadata || {};
					const internalKeyId = metadata.internalKeyId || null;

					if (typeof debug === "function") {
						debug(`TrackerJavaScriptGenerator: Processing field ${nestedId} with genderSpecific: ${genderSpecific}`);
					}

					if (genderFields[genderSpecific]) {
						genderFields[genderSpecific].push({
							fieldId: nestedId,
							internalKeyId,
							label: `${displayName}:`,
						});
					}
				}
				break;
			}
		}

        return genderFields;
    }

    /**
     * Generates JavaScript code with field-specific hiding logic
     * @param {Object} genderFields - Object mapping gender restrictions to field names
     * @returns {string} - Generated JavaScript code
     */
    generateJavaScriptWithFields(genderFields) {
        // Build arrays for each gender restriction
        const femaleOnlyFields = genderFields.female || [];
        const maleOnlyFields = genderFields.male || [];  
        const transOnlyFields = genderFields.trans || [];

        const escapeString = (value) => {
            if (typeof value !== "string") return "";
            return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
        };

        const serializeFieldArray = (fields) => {
            if (!Array.isArray(fields) || fields.length === 0) {
                return "[]";
            }
            const serialized = fields.map((field) => {
                const label = field.label ? `'${escapeString(field.label)}'` : "null";
                const internalKeyId = field.internalKeyId ? `'${escapeString(field.internalKeyId)}'` : "null";
                const fieldId = field.fieldId ? `'${escapeString(field.fieldId)}'` : "null";
                return `{label:${label},key:${internalKeyId},fieldId:${fieldId}}`;
            });
            return `[${serialized.join(",")}]`;
        };

        const femaleOnlyArray = serializeFieldArray(femaleOnlyFields);
        const maleOnlyArray = serializeFieldArray(maleOnlyFields);
        const transOnlyArray = serializeFieldArray(transOnlyFields);

        return `()=>{
const GENDER_FIELD_KEY="characterGender";
const GENDER_SYMBOLS={
male:["\u2642","\u2642\uFE0F"],
female:["\u2640","\u2640\uFE0F"],
trans:["\u26A7","\u26A7\uFE0F"]
};
const hideFields=(mesId,element)=>{
const sections=element.querySelectorAll('.mes_tracker_characters strong');
const addStyle=()=>{
if(document.querySelector('style[data-tracker-alignment]'))return;
const style=document.createElement('style');
style.textContent='.mes_tracker_characters{display:flex;flex-direction:column;}.mes_tracker_characters table{table-layout:fixed!important;width:100%!important;border-spacing:0!important;}.mes_tracker_characters table td:first-child{width:120px!important;min-width:120px!important;max-width:120px!important;text-align:left!important;vertical-align:top!important;padding:2px 5px!important;}.mes_tracker_characters table td:last-child{width:calc(100% - 125px)!important;text-align:left!important;vertical-align:top!important;padding:2px 5px!important;word-wrap:break-word!important;}';
style.setAttribute('data-tracker-alignment','true');
document.head.appendChild(style);
};
addStyle();
sections.forEach((header,index)=>{
const name=header.textContent.replace(':','').trim();
let next=header.nextElementSibling;
let table=null;
while(next){
if(next.tagName==='TABLE'){
table=next;break;
}
next=next.nextElementSibling;
}
if(table){
const rows=Array.from(table.rows);
const genderRow=rows.find(row=>{
const dataKey=row.dataset&&row.dataset.internalKeyId;
if(dataKey===GENDER_FIELD_KEY)return true;
const firstCell=row.cells[0];
if(!dataKey&&firstCell){
return firstCell.textContent.trim()==='Gender:';
}
return false;
});
if(!genderRow||!genderRow.cells[1])return;
const genderText=genderRow.cells[1].textContent.trim();
const containsSymbol=(text,symbols)=>symbols.some(symbol=>text.includes(symbol));
const isFemale=containsSymbol(genderText,GENDER_SYMBOLS.female);
const isMale=containsSymbol(genderText,GENDER_SYMBOLS.male);
const isTrans=containsSymbol(genderText,GENDER_SYMBOLS.trans);
const fieldsToHide=[];
if(!isFemale){
fieldsToHide.push(...${femaleOnlyArray});
}
if(!isMale){
fieldsToHide.push(...${maleOnlyArray});
}
if(!isTrans){
fieldsToHide.push(...${transOnlyArray});
}
if(fieldsToHide.length===0)return;
rows.forEach(row=>{
if(!row.cells[0])return;
const label=row.cells[0].textContent.trim();
const dataKey=row.dataset?row.dataset.internalKeyId:null;
const fieldId=row.dataset?row.dataset.fieldId:null;
const matches=fieldsToHide.some(spec=>{
if(spec.key&&dataKey===spec.key)return true;
if(spec.fieldId&&fieldId===spec.fieldId)return true;
if(spec.label&&label===spec.label)return true;
return false;
});
if(matches){
row.style.display='none';
}
});
}
});
};
const init=()=>{
try{
const ctx=SillyTavern.getContext();
if(ctx&&ctx.eventSource){
ctx.eventSource.on("TRACKER_ENHANCED_PREVIEW_ADDED",hideFields);
ctx.eventSource.on("TRACKER_ENHANCED_PREVIEW_UPDATED",hideFields);
}
}catch(e){
console.warn('[tracker-enhanced] Init failed, SillyTavern context not available:',e.message);
}
};
const cleanup=()=>{
try{
const ctx=SillyTavern.getContext();
if(ctx&&ctx.eventSource&&typeof ctx.eventSource.off==='function'){
ctx.eventSource.off("TRACKER_ENHANCED_PREVIEW_ADDED",hideFields);
ctx.eventSource.off("TRACKER_ENHANCED_PREVIEW_UPDATED",hideFields);
}
const style=document.querySelector('style[data-tracker-alignment]');
if(style)style.remove();
}catch(e){
console.warn('[tracker-enhanced] Cleanup failed, SillyTavern context not available:',e.message);
const style=document.querySelector('style[data-tracker-alignment]');
if(style)style.remove();
}
};
return{init,cleanup,hideGenderSpecificFields:hideFields};
}`;
    }

    /**
     * Generates basic JavaScript without field-specific logic (fallback)
     * @returns {string} - Basic JavaScript code
     */
    generateBasicJavaScript() {
        return `()=>{
const hideFields=(mesId,element)=>{
const sections=element.querySelectorAll('.mes_tracker_characters strong');
const addStyle=()=>{
if(document.querySelector('style[data-tracker-alignment]'))return;
const style=document.createElement('style');
style.textContent='.mes_tracker_characters table{table-layout:fixed!important;width:100%!important}.mes_tracker_characters table td:first-child{width:120px!important;min-width:120px!important;max-width:120px!important}.mes_tracker_characters table td:last-child{width:auto!important}';
style.setAttribute('data-tracker-alignment','true');
document.head.appendChild(style);
};
addStyle();
};
const init=()=>{
try{
const ctx=SillyTavern.getContext();
if(ctx&&ctx.eventSource){
ctx.eventSource.on("TRACKER_ENHANCED_PREVIEW_ADDED",hideFields);
ctx.eventSource.on("TRACKER_ENHANCED_PREVIEW_UPDATED",hideFields);
}
}catch(e){
console.warn('[tracker-enhanced] Init failed, SillyTavern context not available:',e.message);
}
};
const cleanup=()=>{
try{
const ctx=SillyTavern.getContext();
if(ctx&&ctx.eventSource&&typeof ctx.eventSource.off==='function'){
ctx.eventSource.off("TRACKER_ENHANCED_PREVIEW_ADDED",hideFields);
ctx.eventSource.off("TRACKER_ENHANCED_PREVIEW_UPDATED",hideFields);
}
const style=document.querySelector('style[data-tracker-alignment]');
if(style)style.remove();
}catch(e){
console.warn('[tracker-enhanced] Cleanup failed, SillyTavern context not available:',e.message);
const style=document.querySelector('style[data-tracker-alignment]');
if(style)style.remove();
}
};
return{init,cleanup,hideGenderSpecificFields:hideFields};
}`;
    }
}
