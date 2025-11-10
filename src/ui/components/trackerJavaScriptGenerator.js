import { debug } from "../../../lib/utils.js";

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

        // Look for the Characters field (FOR_EACH_OBJECT type)
        for (const [fieldKey, fieldData] of Object.entries(trackerDef)) {
            if (!fieldData || typeof fieldData !== 'object') continue;
            
            const fieldType = fieldData.type;
            const isCharactersField = fieldType === 'FOR_EACH_OBJECT' && fieldData.nestedFields;
            
            if (isCharactersField) {
                if (typeof debug === 'function') {
                    debug(`TrackerJavaScriptGenerator: Found Characters field: ${fieldKey}`);
                }
                
                // Process nested character fields
                for (const [nestedKey, nestedData] of Object.entries(fieldData.nestedFields)) {
                    if (!nestedData || typeof nestedData !== 'object') continue;
                    
                    const fieldName = nestedData.name || nestedKey;
                    const genderSpecific = nestedData.genderSpecific || 'all'; // Default to 'all'
                    
                    if (typeof debug === 'function') {
                        debug(`TrackerJavaScriptGenerator: Processing field ${fieldName} with genderSpecific: ${genderSpecific}`);
                    }
                    
                    if (genderFields[genderSpecific]) {
                        genderFields[genderSpecific].push(fieldName);
                    }
                }
                break; // Only process the first Characters field found
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
        
        // Generate field arrays for the JavaScript
        const generateFieldArray = (fields, suffix = ':') => {
            if (fields.length === 0) return '[]';
            return '[' + fields.map(field => `'${field}${suffix}'`).join(',') + ']';
        };

        const femaleOnlyArray = generateFieldArray(femaleOnlyFields);
        const maleOnlyArray = generateFieldArray(maleOnlyFields);
        const transOnlyArray = generateFieldArray(transOnlyFields);

        return `()=>{
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
const genderRow=Array.from(table.rows).find(row=>row.cells[0]&&row.cells[0].textContent.trim()==='Gender:');
if(genderRow&&genderRow.cells[1]){
const gender=genderRow.cells[1].textContent.trim().toLowerCase();
let fieldsToHide=[];
if(!gender.includes('female')){
fieldsToHide=fieldsToHide.concat(${femaleOnlyArray});
}
if(!gender.includes('male')&&!gender.includes('female')){
fieldsToHide=fieldsToHide.concat(${maleOnlyArray});
}
if(!gender.includes('trans')){
fieldsToHide=fieldsToHide.concat(${transOnlyArray});
}
Array.from(table.rows).forEach(row=>{
if(row.cells[0]&&fieldsToHide.includes(row.cells[0].textContent.trim())){
row.style.display='none';
}
});
}
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
