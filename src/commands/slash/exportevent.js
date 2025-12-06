// src/commands/slash/exportevent.js
import { SlashCommandBuilder, PermissionFlagsBits, AttachmentBuilder } from 'discord.js';
import { db } from '../../database.js';
import { log } from '../../utils/debug.js';
import { exportEventParticipants, generateExportFilename } from '../../utils/excelExporter.js';
import { checkClubPermission } from '../../utils/clubPermissions.js';

export const data = new SlashCommandBuilder()
    .setName('exportevent')
    .setDescription('Export event participants to Excel file')
    .addIntegerOption(option =>
        option.setName('event_id')
            .setDescription('Event ID to export')
            .setRequired(true)
    );

export async function execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const eventId = interaction.options.getInteger('event_id');

    try {
        // Get event details
        const event = await new Promise((resolve, reject) => {
            db.get(
                `SELECT e.*, c.name as club_name, c.slug as club_slug
                 FROM club_events e
                 JOIN clubs c ON e.club_id = c.id
                 WHERE e.id = ?`,
                [eventId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!event) {
            return await interaction.editReply({
                content: '❌ Event not found.'
            });
        }

        // Check permissions - must be club moderator or server admin
        const permissionCheck = await checkClubPermission({
            member: interaction.member,
            clubId: event.club_id,
            action: 'moderate'
        });

        if (!permissionCheck.allowed) {
            return await interaction.editReply({
                content: `❌ You don't have permission to export this event's data.\n\n**Reason:** ${permissionCheck.reason}`
            });
        }

        // Generate Excel file
        const buffer = await exportEventParticipants(eventId);
        const filename = generateExportFilename(event);

        // Create attachment
        const attachment = new AttachmentBuilder(buffer, { name: filename });

        // Send file
        await interaction.editReply({
            content: `✅ **Event Participants Export**\n\n` +
                `📊 Event: **${event.title}**\n` +
                `🏛️ Club: **${event.club_name}**\n` +
                `📅 Date: ${event.event_date}\n\n` +
                `📎 Excel file attached with all participant data including payment status and transaction proofs.`,
            files: [attachment]
        });

        log('Event export generated', 'export', {
            eventId,
            clubId: event.club_id,
            exportedBy: interaction.user.id
        }, null, 'success');

    } catch (error) {
        log('Error in exportevent command', 'export', { eventId }, error, 'error');
        await interaction.editReply({
            content: '❌ An error occurred while generating the export. Please try again.'
        });
    }
}
