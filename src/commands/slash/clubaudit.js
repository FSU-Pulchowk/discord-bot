// src/commands/slash/clubaudit.js
import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { db, getClubByIdentifier } from '../../database.js';
import { log } from '../../utils/debug.js';
import { isServerAdmin } from '../../utils/clubPermissions.js';

export const data = new SlashCommandBuilder()
    .setName('clubaudit')
    .setDescription('View club audit log')
    .addStringOption(option =>
        option.setName('club')
            .setDescription('Club name or slug (leave empty for server-wide logs)')
            .setRequired(false)
            .setAutocomplete(true))
    .addStringOption(option =>
        option.setName('action')
            .setDescription('Filter by action type')
            .setRequired(false)
            .addChoices(
                { name: 'All Actions', value: 'all' },
                { name: 'Moderator Added', value: 'moderator_added' },
                { name: 'Moderator Removed', value: 'moderator_removed' },
                { name: 'President Transferred', value: 'president_transferred' },
                { name: 'Member Joined', value: 'join_request_approved' },
                { name: 'Announcements', value: 'announcement_posted' },
                { name: 'Club Approved', value: 'club_approved' },
                { name: 'Club Rejected', value: 'club_rejected' }
            ))
    .addIntegerOption(option =>
        option.setName('limit')
            .setDescription('Number of entries to show (default: 10, max: 25)')
            .setMinValue(1)
            .setMaxValue(25))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const clubIdentifier = interaction.options.getString('club');
    const actionFilter = interaction.options.getString('action') || 'all';
    const limit = interaction.options.getInteger('limit') || 10;

    try {
        let club = null;
        let clubId = null;

        // If club specified, get club details
        if (clubIdentifier) {
            club = await getClubByIdentifier(interaction.guild.id, clubIdentifier);

            if (!club) {
                return await interaction.editReply({
                    content: '❌ Club not found. Please check the club name/slug and try again.'
                });
            }

            clubId = club.id;
        }

        // Build query
        let query = `SELECT * FROM club_audit_log WHERE guild_id = ?`;
        const params = [interaction.guild.id];

        if (clubId) {
            query += ` AND club_id = ?`;
            params.push(clubId);
        }

        if (actionFilter !== 'all') {
            query += ` AND action_type = ?`;
            params.push(actionFilter);
        }

        query += ` ORDER BY timestamp DESC LIMIT ?`;
        params.push(limit);

        const logs = await new Promise((resolve, reject) => {
            db.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        if (logs.length === 0) {
            return await interaction.editReply({
                content: '📋 No audit log entries found matching your criteria.'
            });
        }

        // Create embed
        const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle(`📋 ${club ? `${club.name} ` : ''}Audit Log`)
            .setDescription(`Showing ${logs.length} most recent entries`)
            .setTimestamp();

        if (club) {
            embed.addFields(
                { name: '🏛️ Club', value: club.name, inline: true },
                { name: '🔗 Slug', value: `\`${club.slug}\``, inline: true }
            );
        }

        if (actionFilter !== 'all') {
            embed.addFields({ name: '🔍 Filter', value: formatActionType(actionFilter), inline: true });
        }

        // Add log entries
        const logEntries = [];
        for (const entry of logs) {
            const timestamp = `<t:${entry.timestamp}:f>`;
            const performer = `<@${entry.performed_by}>`;
            const action = formatActionType(entry.action_type);

            let details = '';
            if (entry.details) {
                try {
                    const detailsObj = JSON.parse(entry.details);
                    if (detailsObj.clubName) details += ` • **Club:** ${detailsObj.clubName}`;
                    if (detailsObj.memberName) details += ` • **User:** ${detailsObj.memberName}`;
                    if (detailsObj.reason) details += ` • **Reason:** ${detailsObj.reason}`;
                } catch (e) {
                    // Invalid JSON, skip details
                }
            }

            logEntries.push(`**${action}**\n${timestamp} by ${performer}${details}\n`);
        }

        // Split into multiple fields if needed (Discord has 1024 char limit per field)
        let currentField = '';
        let fieldCount = 0;

        for (const entry of logEntries) {
            if (currentField.length + entry.length > 1024) {
                embed.addFields({
                    name: fieldCount === 0 ? '📜 Recent Activity' : '\u200b',
                    value: currentField || 'No entries',
                    inline: false
                });
                currentField = entry;
                fieldCount++;
            } else {
                currentField += entry;
            }
        }

        if (currentField) {
            embed.addFields({
                name: fieldCount === 0 ? '📜 Recent Activity' : '\u200b',
                value: currentField,
                inline: false
            });
        }

        embed.setFooter({ text: `Total entries shown: ${logs.length} | Use /clubaudit for more options` });

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        log('Error in clubaudit command', 'club', null, error, 'error');
        await interaction.editReply({
            content: `❌ An error occurred: ${error.message}`
        });
    }
}

/**
 * Format action type for display
 */
function formatActionType(actionType) {
    const typeMap = {
        'moderator_added': '🛡️ Moderator Added',
        'moderator_removed': '🔻 Moderator Removed',
        'moderator_promoted': '⬆️ Member Promoted',
        'president_transferred': '👑 President Transferred',
        'president_transfer_requested': '⏳ Transfer Requested',
        'president_transfer_denied': '❌ Transfer Denied',
        'join_request_submitted': '📝 Join Request Submitted',
        'join_request_approved': '✅ Member Joined',
        'join_request_rejected': '❌ Join Request Rejected',
        'member_removed': '🚪 Member Removed',
        'member_kicked': '👢 Member Kicked',
        'announcement_posted': '📢 Announcement Posted',
        'public_announcement_posted': '🌐 Public Announcement',
        'club_approved': '✅ Club Approved',
        'club_rejected': '❌ Club Rejected',
        'event_created': '📅 Event Created',
        'event_cancelled': '🚫 Event Cancelled'
    };

    return typeMap[actionType] || actionType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Autocomplete handler for club names
 */
export async function autocomplete(interaction) {
    const focusedOption = interaction.options.getFocused(true);

    if (focusedOption.name !== 'club') {
        return await interaction.respond([]);
    }

    const focusedValue = focusedOption.value.toLowerCase();
    const guildId = interaction.guild.id;

    try {
        const clubs = await new Promise((resolve, reject) => {
            db.all(
                `SELECT id, name, slug FROM clubs WHERE guild_id = ? AND status = 'active' ORDER BY name ASC`,
                [guildId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        if (!clubs || clubs.length === 0) {
            return await interaction.respond([]);
        }

        // Filter clubs based on search input
        const filtered = clubs.filter(club => {
            const nameMatch = club.name.toLowerCase().includes(focusedValue);
            const slugMatch = club.slug.toLowerCase().includes(focusedValue);
            return nameMatch || slugMatch;
        });

        // Take only first 25 results (Discord limit)
        const results = filtered.slice(0, 25).map(club => ({
            name: `${club.name} (${club.slug})`.substring(0, 100),
            value: club.slug
        }));

        await interaction.respond(results);

    } catch (error) {
        log('Error in clubaudit autocomplete', 'club', null, error, 'error');
        await interaction.respond([]);
    }
}
