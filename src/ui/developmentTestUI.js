/**
 * Development Test UI for SillyTavern Helper functions
 */

import { SillyTavernHelper } from '../sillyTavernHelper.js';
import { testTavernCardV2, testGroupData } from '../settings/defaultSettings.js';
import { extensionName } from '../../index.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../../popup.js';

// toastr is available globally in SillyTavern
const toastr = window.toastr;

export class DevelopmentTestUI {
    static init() {
        // Add collapsible section to settings panel
        // The settings container ID is 'tracker_enhanced_settings' not 'tracker-enhanced_settings'
        const settingsContainer = document.querySelector('#tracker_enhanced_settings .inline-drawer-content');
        if (!settingsContainer) {
            console.warn('[tracker-enhanced] Settings container not found for development test UI');
            return;
        }

        // Create development test section
        const devSection = this.createDevSection();
        settingsContainer.appendChild(devSection);
    }

    static createDevSection() {
        const section = document.createElement('div');
        section.className = 'tracker-enhanced-dev-section';
        section.innerHTML = `
            <details class="margin-bot-10px">
                <summary class="wide100p textarea_compact">
                    <span>Development Test</span>
                    <span class="fa-solid fa-flask"></span>
                </summary>
                <div class="tracker-enhanced-dev-content">
                    <div class="flex-container flexFlowColumn gap-5">
                        <!-- Character Management -->
                        <div class="tracker-dev-group">
                            <h4>Character Management</h4>
                            <div class="flex-container flexFlowRow flexGap5 flexWrap">
                                <button id="tracker_dev_create_char" class="menu_button menu_button_icon">
                                    <i class="fa-solid fa-user-plus"></i>
                                    <span>Create Test Character</span>
                                </button>
                                <button id="tracker_dev_read_char" class="menu_button menu_button_icon">
                                    <i class="fa-solid fa-user"></i>
                                    <span>Read Current Character</span>
                                </button>
                                <button id="tracker_dev_edit_char" class="menu_button menu_button_icon">
                                    <i class="fa-solid fa-user-pen"></i>
                                    <span>Edit Current Character</span>
                                </button>
                                <button id="tracker_dev_delete_char" class="menu_button menu_button_icon">
                                    <i class="fa-solid fa-user-minus"></i>
                                    <span>Delete Test Character</span>
                                </button>
                            </div>
                        </div>
                        
                        <!-- Group Management -->
                        <div class="tracker-dev-group">
                            <h4>Group Management</h4>
                            <div class="flex-container flexFlowRow flexGap5 flexWrap">
                                <button id="tracker_dev_create_group" class="menu_button menu_button_icon">
                                    <i class="fa-solid fa-users-rectangle"></i>
                                    <span>Create Test Group</span>
                                </button>
                                <button id="tracker_dev_add_member" class="menu_button menu_button_icon">
                                    <i class="fa-solid fa-user-plus"></i>
                                    <span>Add Member to Group</span>
                                </button>
                                <button id="tracker_dev_remove_member" class="menu_button menu_button_icon">
                                    <i class="fa-solid fa-user-minus"></i>
                                    <span>Remove Member from Group</span>
                                </button>
                                <button id="tracker_dev_convert_solo" class="menu_button menu_button_icon">
                                    <i class="fa-solid fa-people-group"></i>
                                    <span>Convert to Group Chat</span>
                                </button>
                                <button id="tracker_dev_create_and_join" class="menu_button menu_button_icon">
                                    <i class="fa-solid fa-user-group"></i>
                                    <span>Create & Join Group</span>
                                </button>
                            </div>
                        </div>
                        
                        <!-- Info Display -->
                        <div class="tracker-dev-group">
                            <h4>Current Status</h4>
                            <div class="flex-container flexFlowRow flexGap5 flexWrap">
                                <button id="tracker_dev_list_chars" class="menu_button menu_button_icon">
                                    <i class="fa-solid fa-list"></i>
                                    <span>List All Characters</span>
                                </button>
                                <button id="tracker_dev_list_groups" class="menu_button menu_button_icon">
                                    <i class="fa-solid fa-list"></i>
                                    <span>List All Groups</span>
                                </button>
                                <button id="tracker_dev_current_status" class="menu_button menu_button_icon">
                                    <i class="fa-solid fa-info-circle"></i>
                                    <span>Current Chat Status</span>
                                </button>
                            </div>
                        </div>
                        
                        <!-- Output Console -->
                        <div class="tracker-dev-group">
                            <h4>Output Console</h4>
                            <div id="tracker_dev_console" class="tracker-dev-console">
                                <pre style="margin: 0; padding: 10px; background: #1a1a1a; color: #0f0; min-height: 100px; max-height: 300px; overflow-y: auto; font-size: 12px;">Development console ready...</pre>
                            </div>
                            <button id="tracker_dev_clear_console" class="menu_button menu_button_icon margin-top-5px">
                                <i class="fa-solid fa-broom"></i>
                                <span>Clear Console</span>
                            </button>
                        </div>
                    </div>
                </div>
            </details>
            <style>
                .tracker-enhanced-dev-section details summary {
                    cursor: pointer;
                    padding: 10px;
                    background: var(--SmartThemeBlurTintColor);
                    border-radius: 5px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .tracker-enhanced-dev-content {
                    padding: 10px;
                    background: var(--SmartThemeBlurTintColor);
                    border-radius: 0 0 5px 5px;
                    margin-top: -5px;
                }
                .tracker-dev-group {
                    padding: 10px;
                    background: var(--SmartThemeBodyColor);
                    border-radius: 5px;
                }
                .tracker-dev-group h4 {
                    margin: 0 0 10px 0;
                    color: var(--SmartThemeEmColor);
                }
                .tracker-dev-console {
                    background: #1a1a1a;
                    border-radius: 5px;
                    border: 1px solid var(--SmartThemeBorderColor);
                }
            </style>
        `;

        // Attach event listeners
        setTimeout(() => this.attachEventListeners(), 100);

        return section;
    }

    static attachEventListeners() {
        // Character Management
        document.getElementById('tracker_dev_create_char')?.addEventListener('click', () => this.createTestCharacter());
        document.getElementById('tracker_dev_read_char')?.addEventListener('click', () => this.readCurrentCharacter());
        document.getElementById('tracker_dev_edit_char')?.addEventListener('click', () => this.editCurrentCharacter());
        document.getElementById('tracker_dev_delete_char')?.addEventListener('click', () => this.deleteTestCharacter());

        // Group Management
        document.getElementById('tracker_dev_create_group')?.addEventListener('click', () => this.createTestGroup());
        document.getElementById('tracker_dev_add_member')?.addEventListener('click', () => this.addMemberToGroup());
        document.getElementById('tracker_dev_remove_member')?.addEventListener('click', () => this.removeMemberFromGroup());
        document.getElementById('tracker_dev_convert_solo')?.addEventListener('click', () => this.convertToGroup());
        document.getElementById('tracker_dev_create_and_join')?.addEventListener('click', () => this.createAndJoinGroup());

        // Info Display
        document.getElementById('tracker_dev_list_chars')?.addEventListener('click', () => this.listAllCharacters());
        document.getElementById('tracker_dev_list_groups')?.addEventListener('click', () => this.listAllGroups());
        document.getElementById('tracker_dev_current_status')?.addEventListener('click', () => this.showCurrentStatus());

        // Console
        document.getElementById('tracker_dev_clear_console')?.addEventListener('click', () => this.clearConsole());
    }

    static log(message, data = null) {
        const console = document.getElementById('tracker_dev_console')?.querySelector('pre');
        if (!console) return;

        const timestamp = new Date().toLocaleTimeString();
        let logMessage = `[${timestamp}] ${message}`;
        
        if (data !== null) {
            logMessage += '\n' + JSON.stringify(data, null, 2);
        }

        console.textContent += '\n' + logMessage;
        console.scrollTop = console.scrollHeight;
    }

    static clearConsole() {
        const console = document.getElementById('tracker_dev_console')?.querySelector('pre');
        if (console) {
            console.textContent = 'Development console cleared...';
        }
    }

    // Character Management Functions
    static async createTestCharacter() {
        this.log('Creating test character...');
        const result = await SillyTavernHelper.createCharacter(testTavernCardV2);
        
        if (result.success) {
            this.log(`✅ Character created successfully: ${result.characterName}`);
            toastr?.success(`Test character "${testTavernCardV2.name}" created successfully!`) || alert(`Test character created successfully!`);
        } else {
            this.log(`❌ Failed to create character: ${result.error}`);
            toastr?.error(`Failed to create character: ${result.error}`) || alert(`Failed to create character: ${result.error}`);
        }
    }

    static readCurrentCharacter() {
        const character = SillyTavernHelper.getCurrentCharacter();
        if (character) {
            this.log('Current character:', {
                name: character.name,
                avatar: character.avatar,
                description: character.description?.substring(0, 100) + '...',
                tags: character.tags,
                fav: character.fav
            });
        } else {
            this.log('No character currently selected');
            toastr?.info('No character currently selected') || console.log('No character currently selected');
        }
    }

    static async editCurrentCharacter() {
        const character = SillyTavernHelper.getCurrentCharacter();
        if (!character) {
            this.log('No character selected to edit');
            toastr?.warning('Please select a character first') || alert('Please select a character first');
            return;
        }

        this.log(`Editing character: ${character.name}`);
        const updates = {
            data: {
                description: character.description + '\n\n[Edited by Tracker Enhanced Development Test]',
                extensions: {
                    ...character.data?.extensions,
                    tracker_enhanced: {
                        last_edited: new Date().toISOString(),
                        edit_count: (character.data?.extensions?.tracker_enhanced?.edit_count || 0) + 1
                    }
                }
            }
        };

        const result = await SillyTavernHelper.editCharacter(character.avatar, updates);
        if (result.success) {
            this.log('✅ Character edited successfully');
            toastr?.success('Character edited successfully!') || alert('Character edited successfully!');
        } else {
            this.log(`❌ Failed to edit character: ${result.error}`);
            toastr?.error(`Failed to edit character: ${result.error}`) || alert(`Failed to edit character: ${result.error}`);
        }
    }

    static async deleteTestCharacter() {
        // Find test character
        const testChar = SillyTavernHelper.getCharacters().find(c => c.name === 'Test Character');
        if (!testChar) {
            this.log('Test character not found');
            toastr?.warning('Test character not found') || alert('Test character not found');
            return;
        }

        const confirm = await callGenericPopup('Delete test character and all associated chats?', POPUP_TYPE.CONFIRM);
        if (!confirm) return;

        this.log(`Deleting test character: ${testChar.avatar}`);
        const result = await SillyTavernHelper.deleteCharacter(testChar.avatar, true);
        
        if (result.success) {
            this.log('✅ Test character deleted successfully');
            toastr?.success('Test character deleted successfully!') || alert('Test character deleted successfully!');
        } else {
            this.log(`❌ Failed to delete character: ${result.error}`);
            toastr?.error(`Failed to delete character: ${result.error}`) || alert(`Failed to delete character: ${result.error}`);
        }
    }

    // Group Management Functions
    static async createTestGroup() {
        this.log('Creating test group...');
        
        // Get first few characters to add as members
        const characters = SillyTavernHelper.getCharacters();
        const members = characters.slice(0, 3).map(c => c.avatar);
        
        const groupData = {
            ...testGroupData,
            members: members
        };

        const result = await SillyTavernHelper.createGroup(groupData);
        
        if (result.success) {
            this.log('✅ Group created successfully:', result.group);
            toastr?.success(`Test group "${groupData.name}" created successfully!`) || alert(`Test group created successfully!`);
        } else {
            this.log(`❌ Failed to create group: ${result.error}`);
            toastr?.error(`Failed to create group: ${result.error}`) || alert(`Failed to create group: ${result.error}`);
        }
    }

    static async addMemberToGroup() {
        const group = SillyTavernHelper.getCurrentGroup();
        if (!group) {
            this.log('No group currently selected');
            toastr?.warning('Please select a group first') || alert('Please select a group first');
            return;
        }

        // Find a character not in the group
        const characters = SillyTavernHelper.getCharacters();
        const nonMembers = characters.filter(c => !group.members.includes(c.avatar));
        
        if (nonMembers.length === 0) {
            this.log('All characters are already in the group');
            toastr?.info('All characters are already in the group') || console.log('All characters are already in the group');
            return;
        }

        const charToAdd = nonMembers[0];
        this.log(`Adding ${charToAdd.name} to group ${group.name}`);
        
        const result = await SillyTavernHelper.addGroupMember(group.id, charToAdd.avatar);
        
        if (result.success) {
            this.log('✅ Member added successfully');
            toastr?.success(`${charToAdd.name} added to group!`) || alert(`${charToAdd.name} added to group!`);
        } else {
            this.log(`❌ Failed to add member: ${result.error}`);
            toastr?.error(`Failed to add member: ${result.error}`) || alert(`Failed to add member: ${result.error}`);
        }
    }

    static async removeMemberFromGroup() {
        const group = SillyTavernHelper.getCurrentGroup();
        if (!group) {
            this.log('No group currently selected');
            toastr?.warning('Please select a group first') || alert('Please select a group first');
            return;
        }

        if (group.members.length === 0) {
            this.log('Group has no members');
            toastr?.info('Group has no members') || console.log('Group has no members');
            return;
        }

        const lastMember = group.members[group.members.length - 1];
        const character = SillyTavernHelper.readCharacter(lastMember);
        const charName = character?.name || lastMember;
        
        this.log(`Removing ${charName} from group ${group.name}`);
        
        const result = await SillyTavernHelper.removeGroupMember(group.id, lastMember);
        
        if (result.success) {
            this.log('✅ Member removed successfully');
            toastr?.success(`${charName} removed from group!`) || alert(`${charName} removed from group!`);
        } else {
            this.log(`❌ Failed to remove member: ${result.error}`);
            toastr?.error(`Failed to remove member: ${result.error}`) || alert(`Failed to remove member: ${result.error}`);
        }
    }

    static async convertToGroup() {
        this.log('Converting current chat to group...');
        
        const result = await SillyTavernHelper.convertSoloToGroup();
        
        if (result.success) {
            this.log('✅ Converted to group successfully:', result.group);
            toastr.success('Chat converted to group successfully!');
        } else {
            this.log(`❌ Failed to convert: ${result.error}`);
            toastr.error(`Failed to convert: ${result.error}`);
        }
    }

    // Info Display Functions
    static listAllCharacters() {
        const characters = SillyTavernHelper.getCharacters();
        this.log(`Total characters: ${characters.length}`);
        
        const charList = characters.slice(0, 10).map(c => ({
            name: c.name,
            avatar: c.avatar,
            fav: c.fav
        }));
        
        this.log('First 10 characters:', charList);
    }

    static listAllGroups() {
        const groups = SillyTavernHelper.getGroups();
        this.log(`Total groups: ${groups.length}`);
        
        const groupList = groups.map(g => ({
            id: g.id,
            name: g.name,
            members: g.members.length,
            fav: g.fav
        }));
        
        this.log('All groups:', groupList);
    }

    static showCurrentStatus() {
        const currentChar = SillyTavernHelper.getCurrentCharacter();
        const currentGroup = SillyTavernHelper.getCurrentGroup();
        
        const status = {
            mode: currentGroup ? 'GROUP' : (currentChar ? 'SOLO' : 'NONE'),
            character: currentChar ? {
                name: currentChar.name,
                avatar: currentChar.avatar
            } : null,
            group: currentGroup ? {
                id: currentGroup.id,
                name: currentGroup.name,
                members: currentGroup.members.length
            } : null
        };
        
        this.log('Current chat status:', status);
    }

    static async createAndJoinGroup() {
        this.log('Creating character and joining group...');
        
        const result = await SillyTavernHelper.createAndJoin(testTavernCardV2);
        
        if (result.success) {
            this.log(`✅ Create and join successful:`, {
                character: result.characterName,
                group: result.group ? result.group.name : 'existing group',
                switched: result.switched || false
            });
            
            const message = result.switched 
                ? `Character "${testTavernCardV2.name}" created, converted to group, and switched to group chat!`
                : `Character "${testTavernCardV2.name}" created and added to current group!`;
                
            toastr?.success(message) || alert(message);
        } else {
            this.log(`❌ Create and join failed: ${result.error}`);
            toastr?.error(`Create and join failed: ${result.error}`) || alert(`Create and join failed: ${result.error}`);
        }
    }
}