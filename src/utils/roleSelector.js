// src/utils/roleSelector.js
import { StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder, ComponentType, ButtonBuilder, ButtonStyle } from 'discord.js';
import { log } from './debug.js';

/**
 * Fetch faculty roles from guild
 * @param {Guild} guild - Discord guild
 * @returns {Array} Array of faculty role objects
 */
export async function getFacultyRoles(guild) {
    try {
        const roles = await guild.roles.fetch();

        // Faculty role patterns based on uploaded images
        const facultyPatterns = [
            'computer', 'electrical', 'civil', 'electronics',
            'mechanical', 'architecture', 'aerospace', 'chemical',
            'industrial', 'geomatics', 'agriculture'
        ];

        const facultyRoles = roles.filter(role => {
            const nameLower = role.name.toLowerCase();
            return facultyPatterns.some(pattern => nameLower.includes(pattern));
        });

        return Array.from(facultyRoles.values()).map(role => ({
            id: role.id,
            name: role.name,
            color: role.hexColor
        }));
    } catch (error) {
        log('Error fetching faculty roles', 'role', null, error, 'error');
        return [];
    }
}

/**
 * Fetch batch roles from guild
 * @param {Guild} guild - Discord guild  
 * @returns {Array} Array of batch role objects
 */
export async function getBatchRoles(guild) {
    try {
        const roles = await guild.roles.fetch();

        // Batch role patterns - looking for year numbers
        const batchPattern = /batch.*(\d{4})|(\d{4}).*batch|^(\d{4})$/i;

        const batchRoles = roles.filter(role => {
            return batchPattern.test(role.name);
        });

        // Sort by year descending (newest first)
        return Array.from(batchRoles.values())
            .map(role => ({
                id: role.id,
                name: role.name,
                year: extractYear(role.name)
            }))
            .sort((a, b) => (b.year || 0) - (a.year || 0));
    } catch (error) {
        log('Error fetching batch roles', 'role', null, error, 'error');
        return [];
    }
}

/**
 * Extract year from role name
 * @param {string} name - Role name
 * @returns {number|null} Extracted year
 */
function extractYear(name) {
    const match = name.match(/(\d{4})/);
    return match ? parseInt(match[1]) : null;
}

/**
 * Create role selection menu for event eligibility
 * @param {Array} roles - Array of role objects
 * @param {string} customId - Custom ID for the select menu
 * @param {string} placeholder - Placeholder text
 * @param {number} maxValues - Maximum selections allowed
 * @returns {ActionRowBuilder} Action row with select menu
 */
export function createRoleSelectMenu(roles, customId, placeholder, maxValues = 25) {
    const options = roles.slice(0, 25).map(role =>
        new StringSelectMenuOptionBuilder()
            .setLabel(role.name)
            .setValue(role.id)
            .setDescription(`Role ID: ${role.id}`)
    );

    // Add "All" option
    options.unshift(
        new StringSelectMenuOptionBuilder()
            .setLabel('All (No restriction)')
            .setValue('all')
            .setDescription('Allow all users regardless of this role type')
            .setDefault(false)
    );

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(customId)
        .setPlaceholder(placeholder)
        .setMinValues(0)
        .setMaxValues(Math.min(options.length, maxValues))
        .addOptions(options);

    return new ActionRowBuilder().addComponents(selectMenu);
}

/**
 * Show role selection interface for event eligibility
 * @param {CommandInteraction} interaction - Discord interaction
 * @param {Object} eventData - Event data from eventPosterData
 * @returns {Promise<Object>} Selected roles object {facultyRoles, batchRoles, requireVerified, allowGuests}
 */
export async function showRoleSelectionInterface(interaction, eventData) {
    try {
        const guild = interaction.guild;

        // Fetch roles
        const facultyRoles = await getFacultyRoles(guild);
        const batchRoles = await getBatchRoles(guild);

        if (facultyRoles.length === 0 && batchRoles.length === 0) {
            await interaction.reply({
                content: '⚠️ No faculty or batch roles found. Proceeding without role restrictions.',
                ephemeral: true
            });
            return { facultyRoles: [], batchRoles: [], requireVerified: false, allowGuests: true };
        }

        // Create select menus
        const facultyMenu = facultyRoles.length > 0
            ? createRoleSelectMenu(facultyRoles, 'select_faculty_roles', 'Select eligible faculties', 10)
            : null;

        const batchMenu = batchRoles.length > 0
            ? createRoleSelectMenu(batchRoles, 'select_batch_roles', 'Select eligible batches', 15)
            : null;

        const components = [];
        if (facultyMenu) components.push(facultyMenu);
        if (batchMenu) components.push(batchMenu);

        if (components.length === 0) {
            return { facultyRoles: [], batchRoles: [], requireVerified: false, allowGuests: true };
        }

        // Send message with select menus
        await interaction.reply({
            content: '**🎯 Select Event Eligibility**\n\n' +
                'Choose which roles can register for this event:\n' +
                '• Select specific faculties and/or batches\n' +
                '• Select "All" to allow everyone from that category\n' +
                '• Leave unselected to skip that restriction\n\n' +
                'Click "Confirm Selection" when done.',
            components: components,
            ephemeral: true
        });

        // Wait for user selections with timeout
        const collector = interaction.channel.createMessageComponentCollector({
            filter: i => i.user.id === interaction.user.id,
            componentType: ComponentType.StringSelect,
            time: 120000 // 2 minutes
        });

        const selectedRoles = {
            facultyRoles: [],
            batchRoles: [],
            requireVerified: false,
            allowGuests: false
        };

        return new Promise((resolve) => {
            collector.on('collect', async (selectInteraction) => {
                if (selectInteraction.customId === 'select_faculty_roles') {
                    selectedRoles.facultyRoles = selectInteraction.values.filter(v => v !== 'all');
                    await selectInteraction.deferUpdate();
                } else if (selectInteraction.customId === 'select_batch_roles') {
                    selectedRoles.batchRoles = selectInteraction.values.filter(v => v !== 'all');
                    await selectInteraction.deferUpdate();
                }
            });

            collector.on('end', () => {
                resolve(selectedRoles);
            });

            // Add confirm button after 5 seconds
            setTimeout(async () => {
                try {
                    const confirmButton = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId('confirm_eligibility')
                            .setLabel('Confirm Selection & Continue')
                            .setStyle(ButtonStyle.Success)
                            .setEmoji('✅')
                    );

                    await interaction.editReply({
                        components: [...components, confirmButton]
                    });
                } catch (error) {
                    log('Error adding confirm button', 'role', null, error, 'warn');
                }
            }, 5000);
        });

    } catch (error) {
        log('Error in role selection interface', 'role', null, error, 'error');
        return { facultyRoles: [], batchRoles: [], requireVerified: false, allowGuests: true };
    }
}

/**
 * Store eligibility roles in database
 * @param {number} eventId - Event ID
 * @param {Array} facultyRoles - Array of faculty role IDs
 * @param {Array} batchRoles - Array of batch role IDs  
 * @param {boolean} requireVerified - Require verified role
 * @param {boolean} allowGuests - Allow guest role
 * @param {Database} db - Database instance
 */
export async function storeEligibilityRoles(eventId, facultyRoles, batchRoles, requireVerified, allowGuests, db) {
    const rolesToInsert = [];

    // Add faculty roles
    facultyRoles.forEach(roleId => {
        rolesToInsert.push({ eventId, roleId, roleType: 'faculty' });
    });

    // Add batch roles
    batchRoles.forEach(roleId => {
        rolesToInsert.push({ eventId, roleId, roleType: 'batch' });
    });

    // Add verified role if required
    if (requireVerified) {
        const verifiedRoleId = process.env.VERIFIED_ROLE_ID;
        if (verifiedRoleId) {
            rolesToInsert.push({ eventId, roleId: verifiedRoleId, roleType: 'verified' });
        }
    }

    // Add guest allowance
    if (allowGuests) {
        rolesToInsert.push({ eventId, roleId: 'guest', roleType: 'guest' });
    }

    // If no roles specified, allow all
    if (rolesToInsert.length === 0) {
        rolesToInsert.push({ eventId, roleId: 'all', roleType: 'custom' });
    }

    // Insert into database
    for (const role of rolesToInsert) {
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO event_eligibility_roles (event_id, role_id, role_type) VALUES (?, ?, ?)`,
                [role.eventId, role.roleId, role.roleType],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    log(`Stored ${rolesToInsert.length} eligibility roles for event ${eventId}`, 'role', null, null, 'success');
}

/**
 * Check if user is eligible for an event
 * @param {string} userId - User ID
 * @param {number} eventId - Event ID
 * @param {GuildMember} member - Guild member object
 * @param {Database} db - Database instance
 * @returns {Promise<Object>} {eligible: boolean, reason: string}
 */
export async function checkEventEligibility(userId, eventId, member, db) {
    try {
        // Get event eligibility roles
        const eligibilityRoles = await new Promise((resolve, reject) => {
            db.all(
                `SELECT role_id, role_type FROM event_eligibility_roles WHERE event_id = ?`,
                [eventId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        // If no restrictions or "all" role, everyone is eligible
        if (eligibilityRoles.length === 0 || eligibilityRoles.some(r => r.role_id === 'all')) {
            return { eligible: true, reason: 'No restrictions' };
        }

        // Check if user has any of the required roles
        const userRoleIds = member.roles.cache.map(r => r.id);

        // Check faculty roles
        const facultyRoles = eligibilityRoles.filter(r => r.role_type === 'faculty');
        const batchRoles = eligibilityRoles.filter(r => r.role_type === 'batch');
        const verifiedRequired = eligibilityRoles.some(r => r.role_type === 'verified');
        const guestsAllowed = eligibilityRoles.some(r => r.role_type === 'guest');

        let hasFacultyRole = facultyRoles.length === 0; // If no faculty restriction, pass
        let hasBatchRole = batchRoles.length === 0; // If no batch restriction, pass

        // Check faculty
        if (facultyRoles.length > 0) {
            hasFacultyRole = facultyRoles.some(r => userRoleIds.includes(r.role_id));
        }

        // Check batch
        if (batchRoles.length > 0) {
            hasBatchRole = batchRoles.some(r => userRoleIds.includes(r.role_id));
        }

        // Check verified if required
        if (verifiedRequired) {
            const verifiedRoleId = process.env.VERIFIED_ROLE_ID;
            if (!userRoleIds.includes(verifiedRoleId) && !guestsAllowed) {
                return {
                    eligible: false,
                    reason: 'This event requires verified Pulchowkian members only.'
                };
            }
        }

        // Must satisfy all applicable restrictions
        if (!hasFacultyRole) {
            return {
                eligible: false,
                reason: 'You do not have the required faculty role for this event.'
            };
        }

        if (!hasBatchRole) {
            return {
                eligible: false,
                reason: 'You do not have the required batch role for this event.'
            };
        }

        return { eligible: true, reason: 'Eligible' };

    } catch (error) {
        log('Error checking event eligibility', 'role', { userId, eventId }, error, 'error');
        // On error, allow registration (fail open)
        return { eligible: true, reason: 'Error checking eligibility, allowed by default' };
    }
}
