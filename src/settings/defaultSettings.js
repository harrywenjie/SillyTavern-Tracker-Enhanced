export const DEFAULT_PRESET_NAME = "Locale Default (English)";

const TARGET_VALUES = {
	BOTH: "both",
	USER: "user",
	CHARACTER: "character",
	NONE: "none",
};

export const automationTargets = Object.freeze({ ...TARGET_VALUES });
export const participantTargets = Object.freeze({ ...TARGET_VALUES });

export const trackerFormat = Object.freeze({
	JSON: "JSON",
	YAML: "YAML",
});

export const defaultSettings = {
	enabled: true,
	languageOverride: "auto",
	selectedProfile: "current",
	selectedCompletionPreset: "current",
	presetAutoMode: true,
	selectedPreset: DEFAULT_PRESET_NAME,
	presets: {},
	collapseStates: {},
};

export const testTavernCardV2 = {
	spec: "chara_card_v2",
	spec_version: "2.0",
	name: "Test Character",
	avatar: "test_character.png",
	data: {
		name: "Test Character",
		description:
			"A mysterious figure with piercing blue eyes and silver hair. They wear a long dark cloak that seems to shimmer with an otherworldly energy. Their presence commands attention, yet they move with an almost supernatural grace.",
		personality:
			"Enigmatic, intelligent, and curious. Speaks with measured words and often poses philosophical questions. Has a dry sense of humor and appreciates intellectual discourse. Can be both warm and distant, depending on their mood.",
		scenario:
			"You encounter this mysterious figure in an ancient library, surrounded by towering shelves of forgotten tomes. The air is thick with the scent of old parchment and magic.",
		first_mes:
			'*A figure emerges from between the towering bookshelves, their footsteps silent on the dusty floor. They regard you with curious eyes that seem to hold centuries of knowledge.*\n\n"Ah, a visitor. How refreshing." *They close the ancient tome in their hands with a soft thud.* "Tell me, what brings you to this repository of forgotten knowledge? Surely not mere chance..."',
		mes_example:
			'<START>\n{{user}}: Who are you?\n{{char}}: *A slight smile plays at the corners of their lips.* "Who am I? Such a simple question with such a complex answer. I am a keeper of knowledge, a seeker of truth, a wanderer between worlds. But you may call me {{char}}, if names are what you require."\n<START>\n{{user}}: What is this place?\n{{char}}: *They gesture broadly at the endless rows of books.* "This? This is where stories go to rest, where knowledge waits to be rediscovered. Every book here contains a universe, every page a possibility. Beautiful, is it not?"',
		creator_notes:
			"This character is designed for philosophical and mystical roleplay scenarios. They work best in fantasy or supernatural settings.",
		system_prompt:
			"You are a mysterious, knowledgeable entity who speaks in riddles and metaphors. You have vast knowledge but reveal it slowly and cryptically.",
		post_history_instructions:
			"Remember to maintain an air of mystery. Never fully reveal all knowledge at once.",
		alternate_greetings: [
			'*The figure looks up from their book, silver hair catching the dim light.* "Interesting. The threads of fate have brought us together once more."',
			'*You find them standing by a window, gazing at the stars.* "The cosmos whispers secrets tonight. Can you hear them?"',
		],
		tags: ["fantasy", "mysterious", "philosophical", "magic"],
		creator: "TrackerEnhanced",
		character_version: "1.0",
		extensions: {
			talkativeness: 0.7,
			fav: false,
			world: "",
			depth_prompt: {
				prompt: "{{char}} is an ancient being with vast knowledge who speaks cryptically.",
				depth: 4,
				role: "system",
			},
			tracker_enhanced: {
				default_tracked: true,
				custom_fields: {},
			},
		},
	},
};

export const testGroupData = {
	name: "Test Adventure Party",
	members: [],
	avatar_url: "",
	allow_self_responses: false,
	activation_strategy: 0,
	generation_mode: 0,
	disabled_members: [],
	chat_metadata: {
		scenario: "The party gathers at the tavern to plan their next adventure.",
	},
	fav: false,
	auto_mode_delay: 5,
	generation_mode_join_prefix: "### {{char}}:\n",
	generation_mode_join_suffix: "\n\n",
	tracker_enhanced_metadata: {
		party_name: "The Silver Wanderers",
		party_level: 5,
		current_quest: "Investigate the mysterious disappearances in the northern villages",
		party_gold: 1500,
		party_reputation: "Respected",
	},
};
