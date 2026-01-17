// src/commands/slash/clubmod.js
import { 
    SlashCommandBuilder, 
    EmbedBuilder
} from 'discord.js';
import { db, getClubByIdentifier, isClubPresident } from '../../database.js';
import { log } from '../../utils/debug.js';
import { checkClubPermission } from '../../utils/clubPermissions.js';

export const data = new SlashCommandBuilder()
    .setName('clubmod')
    .setDescription('Manage club moderators (President only)')
    .addSubcommand(subcommand =>
        subcommand
            .setName('add')
            .setDescription('Add a moderator to your club')
            .addStringOption(option =>
                option
                    .setName('club')
                    .setDescription('Your club name or slug')
                    .setRequired(true)
                    .setAutocomplete(true)
            )
            .addUserOption(option =>
                option
                    .setName('user')
                    .setDescription('The user to promote to moderator')
                    .setRequired(true)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('remove')
            .setDescription('Remove a moderator from your club')
            .addStringOption(option =>
                option
                    .setName('club')
                    .setDescription('Your club name or slug')
                    .setRequired(true)
                    .setAutocomplete(true)
            )
            .addUserOption(option =>
                option
                    .setName('user')
                    .setDescription('The moderator to demote')
                    .setRequired(true)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('list')
            .setDescription('List all moderators in your club')
            .addStringOption(option =>
                option
                    .setName('club')
                    .setDescription('Your club name or slug')
                    .setRequired(true)
                    .setAutocomplete(true)
            )
    );

export async function execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const subcommand = interaction.options.getSubcommand();
    const clubIdentifier = interaction.options.getString('club');
    const userId = interaction.user.id;
    const guildId = interaction.guild.id;

    try {
        // Get club by name or slug
        const club = await getClubByIdentifier(guildId, clubIdentifier);

        if (!club) {
            return await interaction.editReply({
                content: '❌ Club not found. Please check the club name/slug and try again.'
            });
        }

        if (club.status !== 'active') {
            return await interaction.editReply({
                content: `❌ This club is currently ${club.status} and moderators cannot be managed.`
            });
        }

        // Check if user is club president (only presidents can manage moderators)
        const isPresident = await isClubPresident(club.id, userId);
        
        if (!isPresident) {
            return await interaction.editReply({
                content: `❌ Only the club president can manage moderators.\n\n**Club:** ${club.name}\n**President:** <@${club.president_user_id}>`
            });
        }

        // Get club roles
        const clubRole = club.role_id ? await interaction.guild.roles.fetch(club.role_id).catch(() => null) : null;
        let modRole = club.moderator_role_id ? await interaction.guild.roles.fetch(club.moderator_role_id).catch(() => null) : null;

        // ✅ FIX: Create moderator role if it doesn't exist
        if (!modRole && clubRole) {
            log('Moderator role missing, creating it now', 'club', { clubId: club.id, clubName: club.name });
            
            try {
                modRole = await interaction.guild.roles.create({
                    name: `${club.name} - Moderator`,
                    color: clubRole.color, // Same color as club role
                    hoist: true, // Display separately in sidebar
                    mentionable: true,
                    reason: `Creating missing moderator role for ${club.name}`
                });

                // Update database with new moderator role
                await new Promise((resolve, reject) => {
                    db.run(
                        `UPDATE clubs SET moderator_role_id = ?, updated_at = ? WHERE id = ?`,
                        [modRole.id, Date.now(), club.id],
                        (err) => {
                            if (err) reject(err);
                            else resolve();
                        }
                    );
                });

                log('Created moderator role successfully', 'club', { 
                    clubId: club.id, 
                    clubName: club.name, 
                    modRoleId: modRole.id 
                });

            } catch (createError) {
                log('Failed to create moderator role', 'club', { clubId: club.id }, createError, 'error');
                return await interaction.editReply({
                    content: '❌ Failed to create moderator role. Please contact an administrator.'
                });
            }
        }

        if (!clubRole) {
            return await interaction.editReply({
                content: '❌ Club role not found. Please contact an administrator to fix club configuration.'
            });
        }

        if (!modRole) {
            return await interaction.editReply({
                content: '❌ Failed to create/find moderator role. Please contact an administrator.'
            });
        }

        if (subcommand === 'add') {
            await handleAddModerator(interaction, club, clubRole, modRole);
        } else if (subcommand === 'remove') {
            await handleRemoveModerator(interaction, club, clubRole, modRole);
        } else if (subcommand === 'list') {
            await handleListModerators(interaction, club, modRole);
        }

    } catch (error) {
        log('Error managing club moderators', 'club', null, error, 'error');
        await interaction.editReply({
            content: `❌ An error occurred: ${error.message}`
        }).catch(() => {});
    }
}

/**
 * Add a club moderator
 */
async function handleAddModerator(interaction, club, clubRole, modRole) {
    const targetUser = interaction.options.getUser('user');
    const targetMember = await interaction.guild.members.fetch(targetUser.id);

    // Check if user is already a moderator
    if (targetMember.roles.cache.has(modRole.id)) {
        return await interaction.editReply({
            content: `❌ ${targetUser.username} is already a moderator of **${club.name}**.`
        });
    }

    // Check if user is a club member
    if (!targetMember.roles.cache.has(clubRole.id)) {
        return await interaction.editReply({
            content: `❌ ${targetUser.username} must be a club member first.\n\nThey need to join the club before being promoted to moderator.`
        });
    }

    // Prevent promoting yourself (president is already highest)
    if (targetUser.id === interaction.user.id) {
        return await interaction.editReply({
            content: '❌ You are already the club president. You don\'t need to add yourself as a moderator.'
        });
    }

    // Promote to moderator
    await targetMember.roles.add(modRole, `Promoted to moderator by ${interaction.user.tag}`);

    // Update database
    await new Promise((resolve, reject) => {
        db.run(
            `UPDATE club_members SET role = 'moderator', updated_at = ? WHERE club_id = ? AND user_id = ? AND guild_id = ?`,
            [Date.now(), club.id, targetUser.id, interaction.guild.id],
            (err) => {
                if (err) reject(err);
                else resolve();
            }
        );
    });

    // Log action
    await new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO club_audit_log (guild_id, club_id, action_type, performed_by, target_id, details) 
             VALUES (?, ?, 'moderator_added', ?, ?, ?)`,
            [
                interaction.guild.id,
                club.id,
                interaction.user.id,
                targetUser.id,
                JSON.stringify({ 
                    clubName: club.name,
                    clubSlug: club.slug,
                    moderatorId: targetUser.id,
                    moderatorName: targetUser.username
                })
            ],
            (err) => {
                if (err) reject(err);
                else resolve();
            }
        );
    });

    const successEmbed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('✅ Moderator Added')
        .setDescription(`${targetUser} has been promoted to moderator of **${club.name}**`)
        .addFields(
            { name: '🛏️ Club', value: club.name, inline: true },
            { name: '🔗 Slug', value: `\`${club.slug}\``, inline: true },
            { name: '👤 New Moderator', value: `${targetUser.tag}`, inline: true },
            { name: '🛡️ New Permissions', value: 
                '• Manage messages in club channels\n' +
                '• Mute/deafen members in voice\n' +
                '• Mention @everyone in club channels\n' +
                '• Post announcements\n' +
                '• Create events\n' +
                '• Approve join requests\n' +
                '• Manage threads',
                inline: false
            }
        )
        .setTimestamp();

    await interaction.editReply({ embeds: [successEmbed] });

    // Notify the new moderator
    try {
        const dmEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle(`🎉 You've been promoted to Moderator!`)
            .setDescription(`You are now a moderator of **${club.name}** in ${interaction.guild.name}`)
            .addFields(
                { name: '🛏️ Club', value: club.name, inline: true },
                { name: '🔗 Slug', value: `\`${club.slug}\``, inline: true },
                { name: '👑 Promoted By', value: `${interaction.user.tag}`, inline: true },
                { name: '🛡️ Your New Permissions', value: 
                    '• Manage club messages and channels\n' +
                    '• Moderate voice channels\n' +
                    '• Post announcements\n' +
                    '• Create events\n' +
                    '• Approve join requests\n' +
                    '• Help manage club activities',
                    inline: false
                },
                { name: '📋 Important Notes', value:
                    '• You can only moderate **this club**, not the entire server\n' +
                    '• Work with the president to grow the club\n' +
                    '• Be respectful and helpful to members',
                    inline: false
                }
            )
            .setTimestamp();

        await targetUser.send({ embeds: [dmEmbed] });
    } catch (dmError) {
        log('Could not DM new moderator', 'club', null, dmError, 'warn');
    }
}

/**
 * Remove a club moderator
 */
async function handleRemoveModerator(interaction, club, clubRole, modRole) {
    const targetUser = interaction.options.getUser('user');
    const targetMember = await interaction.guild.members.fetch(targetUser.id);

    // Prevent removing yourself
    if (targetUser.id === interaction.user.id) {
        return await interaction.editReply({
            content: '❌ You cannot remove yourself as moderator. If you want to step down, transfer presidency first or contact an administrator.'
        });
    }

    // Check if user is a moderator
    if (!targetMember.roles.cache.has(modRole.id)) {
        return await interaction.editReply({
            content: `❌ ${targetUser.username} is not a moderator of **${club.name}**.`
        });
    }

    // Remove moderator role
    await targetMember.roles.remove(modRole, `Demoted by ${interaction.user.tag}`);

    // Update database
    await new Promise((resolve, reject) => {
        db.run(
            `UPDATE club_members SET role = 'member', updated_at = ? WHERE club_id = ? AND user_id = ? AND guild_id = ?`,
            [Date.now(), club.id, targetUser.id, interaction.guild.id],
            (err) => {
                if (err) reject(err);
                else resolve();
            }
        );
    });

    // Log action
    await new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO club_audit_log (guild_id, club_id, action_type, performed_by, target_id, details) 
             VALUES (?, ?, 'moderator_removed', ?, ?, ?)`,
            [
                interaction.guild.id,
                club.id,
                interaction.user.id,
                targetUser.id,
                JSON.stringify({ 
                    clubName: club.name,
                    clubSlug: club.slug,
                    moderatorId: targetUser.id,
                    moderatorName: targetUser.username
                })
            ],
            (err) => {
                if (err) reject(err);
                else resolve();
            }
        );
    });

    const successEmbed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('✅ Moderator Removed')
        .setDescription(`${targetUser} has been removed as moderator of **${club.name}**`)
        .addFields(
            { name: '🛏️ Club', value: club.name, inline: true },
            { name: '🔗 Slug', value: `\`${club.slug}\``, inline: true },
            { name: '📊 Status', value: 'They remain a club member with standard permissions', inline: false }
        )
        .setTimestamp();

    await interaction.editReply({ embeds: [successEmbed] });

    // Notify the demoted user
    try {
        const dmEmbed = new EmbedBuilder()
            .setColor('#FFA500')
            .setTitle('🔔 Moderator Status Removed')
            .setDescription(`Your moderator status for **${club.name}** has been removed.`)
            .addFields(
                { name: '🛏️ Club', value: club.name, inline: true },
                { name: '🔗 Slug', value: `\`${club.slug}\``, inline: true },
                { name: '📋 Note', value: 'You are still a member of the club with regular member permissions.', inline: false }
            )
            .setTimestamp();

        await targetUser.send({ embeds: [dmEmbed] });
    } catch (dmError) {
        log('Could not DM demoted moderator', 'club', null, dmError, 'warn');
    }
}

/**
 * List all club moderators
 */
async function handleListModerators(interaction, club, modRole) {
    try {
        // Get all moderators and president
        const moderators = await new Promise((resolve, reject) => {
            db.all(
                `SELECT user_id, role FROM club_members 
                 WHERE club_id = ? AND guild_id = ? AND (role = 'moderator' OR role = 'president') AND status = 'active'
                 ORDER BY 
                    CASE role 
                        WHEN 'president' THEN 1
                        WHEN 'moderator' THEN 2
                        ELSE 3
                    END,
                    user_id ASC`,
                [club.id, interaction.guild.id],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        if (moderators.length === 0) {
            return await interaction.editReply({
                content: `No moderators found for **${club.name}** (besides the president).`
            });
        }

        const modList = [];
        for (const mod of moderators) {
            try {
                const member = await interaction.guild.members.fetch(mod.user_id);
                const isPresident = mod.role === 'president';
                const emoji = isPresident ? '👑' : '🛡️';
                const roleText = isPresident ? 'President' : 'Moderator';
                modList.push(`${emoji} ${member.user.tag} (<@${mod.user_id}>) - *${roleText}*`);
            } catch (err) {
                log('Could not fetch moderator', 'club', { userId: mod.user_id }, err, 'warn');
            }
        }

        const listEmbed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle(`${club.name} - Moderators`)
            .setDescription(modList.join('\n') || 'No moderators')
            .addFields(
                { name: '🛏️ Club', value: club.name, inline: true },
                { name: '🔗 Slug', value: `\`${club.slug}\``, inline: true },
                { name: '📊 Total', value: `${moderators.length} (including president)`, inline: true },
                { name: '🛡️ Moderator Role', value: `<@&${modRole.id}>`, inline: true }
            )
            .setFooter({ text: `Use /clubmod add club:${club.slug} to promote members` })
            .setTimestamp();

        if (club.logo_url) {
            listEmbed.setThumbnail(club.logo_url);
        }

        await interaction.editReply({ embeds: [listEmbed] });

    } catch (error) {
        log('Error listing moderators', 'club', { clubId: club.id }, error, 'error');
        await interaction.editReply({
            content: '❌ An error occurred while listing moderators.'
        });
    }
}

/**
 * Autocomplete handler for club names (only clubs user is president of)
 */
export async function autocomplete(interaction) {
    const focusedOption = interaction.options.getFocused(true);
    const focusedValue = focusedOption.value.toLowerCase();
    const guildId = interaction.guild.id;
    const userId = interaction.user.id;

    try {
        // Only handle 'club' option autocomplete
        if (focusedOption.name !== 'club') {
            await interaction.respond([]);
            return;
        }

        // Only show clubs where user is president
        const clubs = await new Promise((resolve, reject) => {
            db.all(
                `SELECT id, name, slug
                 FROM clubs
                 WHERE guild_id = ? AND president_user_id = ? AND status = 'active'
                 ORDER BY name ASC`,
                [guildId, userId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        // If no clubs found at all
        if (!clubs || clubs.length === 0) {
            await interaction.respond([
                {
                    name: '❌ No clubs found where you are president',
                    value: 'no_clubs_found'
                }
            ]);
            return;
        }

        // Filter clubs based on search input
        let filtered;
        
        if (!focusedValue || focusedValue.trim() === '') {
            // If empty search, show first 25 clubs
            filtered = clubs.slice(0, 25);
        } else {
            // Filter by name or slug
            filtered = clubs.filter(club => {
                const nameMatch = club.name.toLowerCase().includes(focusedValue);
                const slugMatch = club.slug.toLowerCase().includes(focusedValue);
                return nameMatch || slugMatch;
            });
        }

        // Take only first 25 results (Discord limit)
        const results = filtered.slice(0, 25).map(club => ({
            name: `${club.name} (${club.slug})`.substring(0, 100), // Discord max is 100 chars
            value: club.slug
        }));

        // If no matches found after filtering
        if (results.length === 0) {
            await interaction.respond([
                {
                    name: `❌ No clubs matching "${focusedValue}"`,
                    value: 'no_match'
                }
            ]);
            return;
        }

        await interaction.respond(results);

    } catch (error) {
        log('Error in clubmod autocomplete', 'club', { 
            userId, 
            guildId, 
            focusedValue: focusedOption?.value 
        }, error, 'error');
        
        // Always respond, even on error
        try {
            await interaction.respond([
                {
                    name: '❌ Error loading clubs - please try again',
                    value: 'error'
                }
            ]);
        } catch (respondError) {
            log('Failed to respond to autocomplete after error', 'club', null, respondError, 'error');
        }
    }
}