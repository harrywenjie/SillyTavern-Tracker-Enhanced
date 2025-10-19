import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import { TrackerTemplateGenerator } from "../src/ui/components/trackerTemplateGenerator.js";
import { TrackerJavaScriptGenerator } from "../src/ui/components/trackerJavaScriptGenerator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const presetsDir = path.join(rootDir, "presets");

async function regenerateTemplates() {
	const templateGenerator = new TrackerTemplateGenerator();
	const jsGenerator = new TrackerJavaScriptGenerator();
	const entries = await fs.readdir(presetsDir, { withFileTypes: true });
	let updates = 0;

	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith(".json")) {
			continue;
		}

		const presetPath = path.join(presetsDir, entry.name);
		const original = await fs.readFile(presetPath, "utf8");
		let preset;

		try {
			preset = JSON.parse(original);
		} catch (err) {
			throw new Error(`Failed to parse ${entry.name}: ${err.message}`);
		}

		const trackerDef = preset?.values?.trackerDef;
		if (!trackerDef || typeof trackerDef !== "object") {
			throw new Error(`Preset ${entry.name} is missing a trackerDef object.`);
		}

		const template = templateGenerator.generateTableTemplate(trackerDef);
		const optimizedTemplate = templateGenerator.optimizeTemplate(template);
		const scriptBody = jsGenerator.generateJavaScript(trackerDef);

		if (!preset.values || typeof preset.values !== "object") {
			preset.values = {};
		}

		preset.values.mesTrackerTemplate = optimizedTemplate;
		preset.values.mesTrackerJavascript = scriptBody;

		const updated = JSON.stringify(preset, null, 2) + "\n";
		if (updated !== original) {
			await fs.writeFile(presetPath, updated, "utf8");
			console.log(`Updated ${path.relative(rootDir, presetPath)}`);
			updates += 1;
		} else {
			console.log(`No changes needed for ${path.relative(rootDir, presetPath)}`);
		}
	}

	if (updates === 0) {
		console.log("Templates already up to date.");
	} else {
		console.log(`Regenerated ${updates} preset file(s).`);
	}
}

regenerateTemplates().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
