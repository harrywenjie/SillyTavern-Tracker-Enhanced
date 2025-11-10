/**
 * Helper class for interacting with SillyTavern's character and group management
 */

import { 
    characters, 
    getCharacters,
    this_chid,
    getRequestHeaders,
    chat,
    chat_metadata,
    getThumbnailUrl,
    default_avatar,
    system_message_types
} from '../../../../../script.js';

import { humanizedDateTime } from '../../../../RossAscends-mods.js';

import {
    groups,
    selected_group,
    getGroupMembers,
    editGroup,
    saveGroupChat,
    group_activation_strategy,
    group_generation_mode,
    DEFAULT_AUTO_MODE_DELAY,
    getGroups,
    openGroupById
} from '../../../../group-chats.js';

import { createTagMapFromList } from '../../../../tags.js';

export class SillyTavernHelper {
    /**
     * Character Management Functions
     */

    /**
     * Create a new character using TavernCard V2 structure
     * @param {Object} characterData - TavernCard V2 formatted data
     * @returns {Promise<{success: boolean, characterName?: string, error?: string}>}
     */
    static async createCharacter(characterData) {
        try {
            const response = await fetch('/api/characters/create', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({
                    ch_name: characterData.name,
                    description: characterData.data?.description || '',
                    personality: characterData.data?.personality || '',
                    scenario: characterData.data?.scenario || '',
                    first_mes: characterData.data?.first_mes || '',
                    mes_example: characterData.data?.mes_example || '',
                    creator_notes: characterData.data?.creator_notes || '',
                    system_prompt: characterData.data?.system_prompt || '',
                    post_history_instructions: characterData.data?.post_history_instructions || '',
                    alternate_greetings: characterData.data?.alternate_greetings || [],
                    tags: characterData.data?.tags || [],
                    creator: characterData.data?.creator || '',
                    character_version: characterData.data?.character_version || '',
                    extensions: JSON.stringify(characterData.data?.extensions || {}),
                    talkativeness: characterData.data?.extensions?.talkativeness || 0.5,
                    fav: characterData.data?.extensions?.fav || false,
                    depth_prompt_prompt: characterData.data?.extensions?.depth_prompt?.prompt || '',
                    depth_prompt_depth: characterData.data?.extensions?.depth_prompt?.depth || 4,
                    depth_prompt_role: characterData.data?.extensions?.depth_prompt?.role || 'system'
                })
            });

            if (response.ok) {
                const avatarName = await response.text();
                await getCharacters(); // Refresh character list
                return { success: true, characterName: avatarName };
            } else {
                return { success: false, error: `Failed to create character: ${response.statusText}` };
            }
        } catch (error) {
            console.error('Error creating character:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Read character data by avatar name or index
     * @param {string|number} identifier - Character avatar name or index
     * @returns {Object|null} Character data or null if not found
     */
    static readCharacter(identifier) {
        if (typeof identifier === 'number') {
            return characters[identifier] || null;
        } else if (typeof identifier === 'string') {
            return characters.find(c => c.avatar === identifier || c.name === identifier) || null;
        }
        return null;
    }

    /**
     * Edit an existing character
     * @param {string} avatarName - Character avatar filename
     * @param {Object} updates - Fields to update
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    static async editCharacter(avatarName, updates) {
        try {
            const character = this.readCharacter(avatarName);
            if (!character) {
                return { success: false, error: 'Character not found' };
            }

            const response = await fetch('/api/characters/merge-attributes', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({
                    avatar: avatarName,
                    ...updates
                })
            });

            if (response.ok) {
                await getCharacters(); // Refresh character list
                return { success: true };
            } else {
                return { success: false, error: `Failed to edit character: ${response.statusText}` };
            }
        } catch (error) {
            console.error('Error editing character:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Delete a character
     * @param {string} avatarName - Character avatar filename
     * @param {boolean} deleteChats - Whether to delete associated chats
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    static async deleteCharacter(avatarName, deleteChats = false) {
        try {
            const response = await fetch('/api/characters/delete', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({
                    avatar_url: avatarName,
                    delete_chats: deleteChats
                })
            });

            if (response.ok) {
                await getCharacters(); // Refresh character list
                return { success: true };
            } else {
                return { success: false, error: `Failed to delete character: ${response.statusText}` };
            }
        } catch (error) {
            console.error('Error deleting character:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Group Management Functions
     */

    /**
     * Create a new group
     * @param {Object} groupData - Group configuration data
     * @returns {Promise<{success: boolean, group?: Object, error?: string}>}
     */
    static async createGroup(groupData) {
        try {
            const response = await fetch('/api/groups/create', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({
                    name: groupData.name || 'New Group',
                    members: groupData.members || [],
                    avatar_url: groupData.avatar_url || default_avatar,
                    allow_self_responses: groupData.allow_self_responses || false,
                    activation_strategy: groupData.activation_strategy ?? group_activation_strategy.NATURAL,
                    generation_mode: groupData.generation_mode ?? group_generation_mode.SWAP,
                    disabled_members: groupData.disabled_members || [],
                    chat_metadata: groupData.chat_metadata || {},
                    fav: groupData.fav || false,
                    chat_id: groupData.chat_id || String(Date.now()),
                    chats: groupData.chats || [String(Date.now())],
                    auto_mode_delay: groupData.auto_mode_delay || DEFAULT_AUTO_MODE_DELAY,
                    generation_mode_join_prefix: groupData.generation_mode_join_prefix || '',
                    generation_mode_join_suffix: groupData.generation_mode_join_suffix || ''
                })
            });

            if (response.ok) {
                const group = await response.json();
                await getCharacters(); // This also refreshes groups
                await getGroups(); // Explicitly refresh groups
                return { success: true, group };
            } else {
                return { success: false, error: `Failed to create group: ${response.statusText}` };
            }
        } catch (error) {
            console.error('Error creating group:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Add a member to an existing group
     * @param {string} groupId - Group ID
     * @param {string} characterAvatar - Character avatar filename to add
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    static async addGroupMember(groupId, characterAvatar) {
        try {
            const group = groups.find(g => g.id === groupId);
            if (!group) {
                return { success: false, error: 'Group not found' };
            }

            const character = characters.find(c => c.avatar === characterAvatar);
            if (!character) {
                return { success: false, error: 'Character not found' };
            }

            if (group.members.includes(characterAvatar)) {
                return { success: false, error: 'Character already in group' };
            }

            group.members.push(characterAvatar);
            await editGroup(groupId, true, false);
            await getGroups();
            
            return { success: true };
        } catch (error) {
            console.error('Error adding group member:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Remove a member from a group
     * @param {string} groupId - Group ID
     * @param {string} characterAvatar - Character avatar filename to remove
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    static async removeGroupMember(groupId, characterAvatar) {
        try {
            const group = groups.find(g => g.id === groupId);
            if (!group) {
                return { success: false, error: 'Group not found' };
            }

            const memberIndex = group.members.indexOf(characterAvatar);
            if (memberIndex === -1) {
                return { success: false, error: 'Character not in group' };
            }

            group.members.splice(memberIndex, 1);
            
            // Also remove from disabled members if present
            const disabledIndex = group.disabled_members.indexOf(characterAvatar);
            if (disabledIndex !== -1) {
                group.disabled_members.splice(disabledIndex, 1);
            }

            await editGroup(groupId, true, false);
            await getGroups();
            
            return { success: true };
        } catch (error) {
            console.error('Error removing group member:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Convert current solo chat to a group chat
     * @returns {Promise<{success: boolean, group?: Object, error?: string}>}
     */
    static async convertSoloToGroup() {
        try {
            if (selected_group) {
                return { success: false, error: 'Already in a group chat' };
            }

            if (this_chid === undefined) {
                return { success: false, error: 'No character selected' };
            }

            const character = characters[this_chid];
            if (!character) {
                return { success: false, error: 'Character not found' };
            }

            // Create group name
            const name = `Group: ${character.name}`;
            const avatar = getThumbnailUrl('avatar', character.avatar);
            const chatName = humanizedDateTime();
            const metadata = Object.assign({}, chat_metadata);
            delete metadata.main_chat;

            // Create the group
            const createGroupResponse = await fetch('/api/groups/create', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({
                    name: name,
                    members: [character.avatar],
                    avatar_url: avatar,
                    allow_self_responses: false,
                    activation_strategy: group_activation_strategy.NATURAL,
                    generation_mode: group_generation_mode.SWAP,
                    disabled_members: [],
                    chat_metadata: metadata,
                    fav: character.fav || false,
                    chat_id: chatName,
                    chats: [chatName],
                    auto_mode_delay: DEFAULT_AUTO_MODE_DELAY
                })
            });

            if (!createGroupResponse.ok) {
                return { success: false, error: 'Failed to create group' };
            }

            const group = await createGroupResponse.json();

            // Convert chat to group format
            const groupChat = chat.slice();
            const genIdFirst = Date.now();

            for (let index = 0; index < groupChat.length; index++) {
                const message = groupChat[index];

                // Save group-chat marker
                if (index == 0) {
                    message.is_group = true;
                }

                // Skip messages we don't care about
                if (message.is_user || message.is_system || message.extra?.type === system_message_types.NARRATOR || message.force_avatar !== undefined) {
                    continue;
                }

                // Set force fields for solo character
                message.name = character.name;
                message.original_avatar = character.avatar;
                message.force_avatar = getThumbnailUrl('avatar', character.avatar);

                // Allow regens of a single message in group
                if (typeof message.extra !== 'object') {
                    message.extra = { gen_id: genIdFirst + index };
                }
            }

            // Save group chat
            const saveChatResponse = await fetch('/api/chats/group/save', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({ id: chatName, chat: groupChat })
            });

            if (!saveChatResponse.ok) {
                return { success: false, error: 'Failed to save group chat' };
            }

            await getCharacters();
            await getGroups();

            return { success: true, group };
        } catch (error) {
            console.error('Error converting to group:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get all groups
     * @returns {Array} Array of group objects
     */
    static getGroups() {
        return groups;
    }

    /**
     * Get all characters
     * @returns {Array} Array of character objects
     */
    static getCharacters() {
        return characters;
    }

    /**
     * Get current group (if any)
     * @returns {Object|null} Current group or null
     */
    static getCurrentGroup() {
        if (!selected_group) return null;
        return groups.find(g => g.id === selected_group) || null;
    }

    /**
     * Get current character (if any)
     * @returns {Object|null} Current character or null
     */
    static getCurrentCharacter() {
        if (this_chid === undefined) return null;
        return characters[this_chid] || null;
    }

    /**
     * Create a character and join current/new group
     * If in solo chat, converts to group and switches to it
     * If in group chat, just adds the new character to current group
     * @param {Object} characterData - TavernCard V2 formatted data
     * @returns {Promise<{success: boolean, characterName?: string, group?: Object, switched?: boolean, error?: string}>}
     */
    static async createAndJoin(characterData) {
        try {
            // First create the character
            const createResult = await this.createCharacter(characterData);
            if (!createResult.success) {
                return createResult;
            }

            const characterAvatar = createResult.characterName;
            let group = null;
            let switched = false;

            if (selected_group) {
                // Already in a group, just add the character
                const addResult = await this.addGroupMember(selected_group, characterAvatar);
                if (!addResult.success) {
                    return { 
                        success: false, 
                        error: `Character created but failed to add to group: ${addResult.error}`,
                        characterName: characterAvatar 
                    };
                }
                
                group = groups.find(g => g.id === selected_group);
            } else {
                // In solo chat, convert to group first
                const convertResult = await this.convertSoloToGroup();
                if (!convertResult.success) {
                    return { 
                        success: false, 
                        error: `Character created but failed to convert to group: ${convertResult.error}`,
                        characterName: characterAvatar 
                    };
                }

                group = convertResult.group;

                // Switch to the new group
                const switchResult = await openGroupById(group.id);
                if (switchResult !== false) {
                    switched = true;
                }

                // Add the new character to the group
                const addResult = await this.addGroupMember(group.id, characterAvatar);
                if (!addResult.success) {
                    return { 
                        success: false, 
                        error: `Character created and group converted but failed to add character: ${addResult.error}`,
                        characterName: characterAvatar,
                        group: group,
                        switched: switched
                    };
                }
            }

            return { 
                success: true, 
                characterName: characterAvatar,
                group: group,
                switched: switched
            };

        } catch (error) {
            console.error('Error in createAndJoin:', error);
            return { success: false, error: error.message };
        }
    }
}