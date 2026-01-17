// src/commands/slash/clubmember.js
import { 
    SlashCommandBuilder, 
    EmbedBuilder,
    PermissionsBitField
} from 'discord.js';
import { db, getClubByIdentifier } from '../../database.js';
import { log } from '../../utils/debug.js';
import { checkClubPermission, removeUserFromClub } from '../../utils/clubPermissions.js';

export const data = new SlashCommandBuilder()
    .setName('clubmember')
    .setDescription('Manage club members (Moderators/Presidents only)')
    .addSubcommand(subcommand =>
        subcommand
            .setName('remove')
            .setDescription('Remove a member from your club')
            .addStringOption(option =>
                option.setName('club')
                    .setDescription('Your club name or slug')
                    .setRequired(true)
                    .setAutocomplete(true))
            .addUserOption(option =>
                option.setName('user')
                    .setDescription('Member to remove')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('reason')
                    .setDescription('Reason for removal')
                    .setRequired(true)
                    .setMaxLength(500)))
    .addSubcommand(subcommand =>
        subcommand
            .setName('list')
            .setDescription('List all club members')
            .addStringOption(option =>
                option.setName('club')
                    .setDescription('Club name or slug')
                    .setRequired(true)
                    .setAutocomplete(true))
            .addStringOption(option =>
                option.setName('filter')
                    .setDescription('Filter members by role')
                    .setRequired(false)
                    .addChoices(
                        { name: 'All Members', value: 'all' },
                        { name: 'Moderators Only', value: 'moderator' },
                        { name: 'Regular Members', value: 'member' }
                    )))
    .addSubcommand(subcommand =>
        subcommand
            .setName('info')
            .setDescription('View member information')
            .addStringOption(option =>
                option.setName('club')
                    .setDescription('Club name or slug')
                    .setRequired(true)
                    .setAutocomplete(true))
            .addUserOption(option =>
                option.setName('user')
                    .setDescription('Member to view')
                    .setRequired(true)));

export async function execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const subcommand = interaction.options.getSubcommand();
    const clubIdentifier = interaction.options.getString('club');
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
                content: `❌ This club is currently ${club.status}.`
            });
        }

        // Check permission based on subcommand
        const requiredAction = subcommand === 'remove' ? 'moderate' : 'view';
        const permissionCheck = await checkClubPermission({
            member: interaction.member,
            clubId: club.id,
            action: requiredAction
        });

        if (!permissionCheck.allowed) {
            return await interaction.editReply({
                content: `❌ You don't have permission to ${subcommand} members for this club.\n**Reason:** ${permissionCheck.reason}`
            });
        }

        if (subcommand === 'remove') {
            await handleRemoveMember(interaction, club);
        } else if (subcommand === 'list') {
            await handleListMembers(interaction, club);
        } else if (subcommand === 'info') {
            await handleMemberInfo(interaction, club);
        }

    } catch (error) {
        log('Error in clubmember command', 'club', null, error, 'error');
        await interaction.editReply({
            content: `❌ An error occurred: ${error.message}`
        }).catch(() => {});
    }
}

/**
 * Remove a member from the club
 */
async function handleRemoveMember(interaction, club) {
    const targetUser = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason');

    try {
        // Check if target is club president
        if (targetUser.id === club.president_user_id) {
            return await interaction.editReply({
                content: '❌ Cannot remove the club president. They must transfer presidency or the club must be dissolved by an admin.'
            });
        }

        // Check if user is trying to remove themselves
        if (targetUser.id === interaction.user.id) {
            return await interaction.editReply({
                content: '❌ You cannot remove yourself. To leave the club, contact an administrator or use the appropriate leave command.'
            });
        }

        // Check if target is a member
        const targetMember = await new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM club_members WHERE club_id = ? AND user_id = ? AND status = 'active'`,
                [club.id, targetUser.id],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!targetMember) {
            return await interaction.editReply({
                content: `❌ ${targetUser.username} is not an active member of **${club.name}**.`
            });
        }

        // Use the permission utility to remove the user
        const result = await removeUserFromClub(
            interaction.guild,
            club.id,
            targetUser.id,
            interaction.user.id,
            reason
        );

        if (!result.success) {
            return await interaction.editReply({
                content: `❌ Failed to remove member: ${result.error}`
            });
        }

        // Success embed
        const successEmbed = new EmbedBuilder()
            .setColor('#FFA500')
            .setTitle('✅ Member Removed')
            .setDescription(`${targetUser} has been removed from **${club.name}**`)
            .addFields(
                { name: '🏛️ Club', value: club.name, inline: true },
                { name: '🔗 Slug', value: `\`${club.slug}\``, inline: true },
                { name: '👤 Removed User', value: `${targetUser.tag}`, inline: true },
                { name: '👮 Removed By', value: `${interaction.user.tag}`, inline: true },
                { name: '📝 Reason', value: reason, inline: false }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [successEmbed] });

        // Notify the removed user
        try {
            const notifyEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('🔔 Removed from Club')
                .setDescription(`You have been removed from **${club.name}** in ${interaction.guild.name}`)
                .addFields(
                    { name: '🏛️ Club', value: club.name, inline: true },
                    { name: '🔗 Slug', value: `\`${club.slug}\``, inline: true },
                    { name: '📝 Reason', value: reason, inline: false },
                    { name: '💬 Questions?', value: 'Contact the club president or server administrators if you believe this was a mistake.', inline: false }
                )
                .setTimestamp();

            await targetUser.send({ embeds: [notifyEmbed] });
        } catch (dmError) {
            log('Could not DM removed member', 'club', null, dmError, 'warn');
        }

    } catch (error) {
        log('Error removing member', 'club', null, error, 'error');
        await interaction.editReply({
            content: `❌ An error occurred while removing the member: ${error.message}`
        });
    }
}

/**
 * List all club members
 */
async function handleListMembers(interaction, club) {
    const filter = interaction.options.getString('filter') || 'all';

    try {
        // Build query based on filter
        let query = `
            SELECT cm.*, vu.real_name, vu.email
            FROM club_members cm
            LEFT JOIN verified_users vu ON cm.user_id = vu.user_id
            WHERE cm.club_id = ? AND cm.status = 'active'
        `;
        
        if (filter === 'moderator') {
            query += ` AND cm.role IN ('moderator', 'president')`;
        } else if (filter === 'member') {
            query += ` AND cm.role = 'member'`;
        }
        
        query += ` ORDER BY 
            CASE cm.role 
                WHEN 'president' THEN 1
                WHEN 'moderator' THEN 2
                ELSE 3
            END,
            cm.joined_at ASC`;

        const members = await new Promise((resolve, reject) => {
            db.all(query, [club.id], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        if (members.length === 0) {
            return await interaction.editReply({
                content: `📋 No ${filter === 'all' ? '' : filter + ' '}members found for **${club.name}**.`
            });
        }

        // Create member list embed
        const listEmbed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle(`👥 ${club.name} - Members`)
            .setDescription(
                `**Total Members:** ${members.length}\n` +
                `**Filter:** ${filter === 'all' ? 'All Members' : filter === 'moderator' ? 'Moderators & President' : 'Regular Members'}`
            )
            .addFields(
                { name: '🏛️ Club', value: club.name, inline: true },
                { name: '🔗 Slug', value: `\`${club.slug}\``, inline: true },
                { name: '📊 Status', value: club.status, inline: true }
            )
            .setTimestamp();

        if (club.logo_url) {
            listEmbed.setThumbnail(club.logo_url);
        }

        // Split members into chunks for embed fields
        const chunkSize = 10;
        for (let i = 0; i < members.length; i += chunkSize) {
            const chunk = members.slice(i, i + chunkSize);
            const memberList = chunk.map((m, idx) => {
                const num = i + idx + 1;
                const roleEmoji = m.role === 'president' ? '👑' : m.role === 'moderator' ? '🛡️' : '👤';
                const name = m.real_name || 'Unknown';
                const joinedDate = new Date(m.joined_at * 1000).toLocaleDateString();
                return `${num}. ${roleEmoji} **${name}** (<@${m.user_id}>)\n   Role: ${m.role} • Joined: ${joinedDate} • Attendance: ${m.attendance_count}`;
            }).join('\n\n');

            listEmbed.addFields({
                name: `Members ${i + 1}-${Math.min(i + chunkSize, members.length)}`,
                value: memberList,
                inline: false
            });
        }

        await interaction.editReply({ embeds: [listEmbed] });

    } catch (error) {
        log('Error listing members', 'club', null, error, 'error');
        await interaction.editReply({
            content: '❌ An error occurred while listing members.'
        });
    }
}

/**
 * View detailed member information
 */
async function handleMemberInfo(interaction, club) {
    const targetUser = interaction.options.getUser('user');

    try {
        // Get member details
        const member = await new Promise((resolve, reject) => {
            db.get(
                `SELECT cm.*, vu.real_name, vu.email
                 FROM club_members cm
                 LEFT JOIN verified_users vu ON cm.user_id = vu.user_id
                 WHERE cm.club_id = ? AND cm.user_id = ?`,
                [club.id, targetUser.id],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!member) {
            return await interaction.editReply({
                content: `❌ ${targetUser.username} is not a member of **${club.name}**.`
            });
        }

        // Get event participation count
        const eventCount = await new Promise((resolve, reject) => {
            db.get(
                `SELECT COUNT(*) as count
                 FROM event_participants ep
                 JOIN club_events ce ON ep.event_id = ce.id
                 WHERE ce.club_id = ? AND ep.user_id = ?`,
                [club.id, targetUser.id],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row?.count || 0);
                }
            );
        });

        // Create info embed
        const infoEmbed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('👤 Member Information')
            .setDescription(`Information for ${targetUser} in **${club.name}**`)
            .addFields(
                { name: '🏛️ Club', value: club.name, inline: true },
                { name: '🔗 Slug', value: `\`${club.slug}\``, inline: true },
                { name: '📛 Real Name', value: member.real_name || 'Unknown', inline: true },
                { name: '🛡️ Role', value: member.role === 'president' ? '👑 President' : member.role === 'moderator' ? '🛡️ Moderator' : '👤 Member', inline: true },
                { name: '📊 Status', value: member.status, inline: true },
                { name: '📅 Joined', value: new Date(member.joined_at * 1000).toLocaleDateString(), inline: true },
                { name: '📈 Attendance', value: `${member.attendance_count} events`, inline: true },
                { name: '⭐ Points', value: member.contribution_points.toString(), inline: true },
                { name: '🎯 Events Participated', value: eventCount.toString(), inline: true }
            )
            .setThumbnail(targetUser.displayAvatarURL())
            .setTimestamp();

        if (member.last_active_at) {
            infoEmbed.addFields({ 
                name: '🕐 Last Active', 
                value: new Date(member.last_active_at * 1000).toLocaleDateString(), 
                inline: true 
            });
        }

        if (member.email) {
            infoEmbed.addFields({ name: '📧 Email', value: member.email, inline: true });
        }

        await interaction.editReply({ embeds: [infoEmbed] });

    } catch (error) {
        log('Error getting member info', 'club', null, error, 'error');
        await interaction.editReply({
            content: '❌ An error occurred while fetching member information.'
        });
    }
}

/**
 * Autocomplete handler for club names (clubs user can manage)
 */
export async function autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused();
    const guildId = interaction.guild.id;
    const subcommand = interaction.options.getSubcommand();

    try {
        // Get all active clubs
        const clubs = await new Promise((resolve, reject) => {
            db.all(
                `SELECT id, name, slug
                 FROM clubs
                 WHERE guild_id = ? AND status = 'active'
                 ORDER BY name ASC`,
                [guildId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        // Filter based on permission
        const requiredAction = subcommand === 'remove' ? 'moderate' : 'view';
        const filtered = [];

        for (const club of clubs) {
            if (club.name.toLowerCase().includes(focusedValue.toLowerCase()) ||
                club.slug.toLowerCase().includes(focusedValue.toLowerCase())) {
                
                const permCheck = await checkClubPermission({
                    member: interaction.member,
                    clubId: club.id,
                    action: requiredAction
                });

                if (permCheck.allowed) {
                    filtered.push({
                        name: `${club.name} (${club.slug})`,
                        value: club.slug
                    });
                }
            }

            if (filtered.length >= 25) break;
        }

        if (filtered.length === 0) {
            filtered.push({
                name: '❌ No clubs found or no permission',
                value: 'no_clubs'
            });
        }

        await interaction.respond(filtered);
    } catch (error) {
        log('Error in clubmember autocomplete', 'club', null, error, 'error');
        await interaction.respond([]);
    }
}