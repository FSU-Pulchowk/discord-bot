import { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, ChannelType } from 'discord.js';

export const data = new SlashCommandBuilder()
    .setName('approvesuggestion')
    .setDescription('Approves a suggestion by its ID.')
    .addIntegerOption(option =>
        option.setName('suggestion_id')
            .setDescription('The ID of the suggestion to approve')
            .setRequired(true))
    .addStringOption(option =>
        option.setName('reason')
            .setDescription('Reason for approving the suggestion (optional)')
            .setRequired(false))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild); 

export async function execute(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
    }

    const suggestionId = interaction.options.getInteger('suggestion_id');
    const reason = interaction.options.getString('reason') || 'No reason provided.';
    const userId = interaction.user.id;
    const guildId = interaction.guild.id;

    const db = interaction.client.db;
    const SUGGESTIONS_CHANNEL_ID = process.env.SUGGESTIONS_CHANNEL_ID || 'YOUR_SUGGESTIONS_CHANNEL_ID_HERE';

    // FIX: Added missing backticks to the SQL query string
    db.get(`SELECT * FROM suggestions WHERE id = ? AND guild_id = ?`, [suggestionId, guildId], async (err, row) => {
        if (err) {
            console.error('Error fetching suggestion:', err.message);
            return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error fetching suggestion: ${err.message}`)], ephemeral: true });
        }
        if (!row) return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription(`❌ No suggestion ID **#${suggestionId}** found.`)], ephemeral: true });
        if (row.status === 'approved') return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription(`⚠️ Suggestion **#${suggestionId}** is already approved.`)], ephemeral: true });

        db.run(`UPDATE suggestions SET status = 'approved', reviewed_by = ?, reviewed_at = ?, reason = ? WHERE id = ?`,
            [userId, Date.now(), reason, suggestionId],
            async (updateErr) => {
                if (updateErr) {
                    console.error('Error updating suggestion:', updateErr.message);
                    return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error approving suggestion: ${updateErr.message}`)], ephemeral: true });
                }

                let suggesterUser;
                try {
                    suggesterUser = await interaction.client.users.fetch(row.user_id);
                    const dmEmbed = new EmbedBuilder()
                        .setColor('#00FF00')
                        .setTitle('✅ Your Suggestion Has Been Approved!')
                        .setDescription(`Your suggestion (ID: **#${suggestionId}**) has been approved by ${interaction.user.tag} in **${interaction.guild.name}**.`)
                        .addFields(
                            { name: 'Your Suggestion', value: row.suggestion_text, inline: false },
                            { name: 'Reason for Approval', value: reason, inline: false }
                        )
                        .setTimestamp();
                    await suggesterUser.send({ embeds: [dmEmbed] }).catch(dmErr => {
                        console.warn(`Could not send approval DM to suggester ${suggesterUser.tag} (${suggesterUser.id}):`, dmErr.message);
                        interaction.followUp({ content: `⚠️ Could not send DM to the suggester for suggestion **#${suggestionId}**. They might have DMs disabled.`, ephemeral: true }).catch(console.error);
                    });
                } catch (fetchUserErr) {
                    console.error(`Error fetching suggester user ${row.user_id}:`, fetchUserErr.message);
                    interaction.followUp({ content: `⚠️ Could not find the suggester for suggestion **#${suggestionId}** to send a DM.`, ephemeral: true }).catch(console.error);
                }

                if (SUGGESTIONS_CHANNEL_ID === 'YOUR_SUGGESTIONS_CHANNEL_ID_HERE') {
                    await interaction.reply({ content: `⚠️ Suggestion **#${suggestionId}** approved. Original message not updated as SUGGESTIONS_CHANNEL_ID is not configured in .env.`, ephemeral: true }).catch(console.error);
                } else {
                    const suggestionsChannel = interaction.guild.channels.cache.get(SUGGESTIONS_CHANNEL_ID);
                    if (suggestionsChannel && suggestionsChannel.type === ChannelType.GuildText && row.message_id) {
                        try {
                            const suggestionMessage = await suggestionsChannel.messages.fetch(row.message_id);
                            if (suggestionMessage && suggestionMessage.embeds[0]) {
                                const originalEmbed = suggestionMessage.embeds[0];
                                const statusIndex = originalEmbed.fields.findIndex(f => f.name.toLowerCase() === 'status');
                                const newEmbed = EmbedBuilder.from(originalEmbed).setColor('#00FF00'); // Green for approved

                                if (statusIndex > -1) {
                                    newEmbed.spliceFields(statusIndex, 1, { name: 'Status', value: `Approved by ${interaction.user.tag} ${reason !== 'No reason provided.' ? `(${reason})` : ''}`, inline: true });
                                } else {
                                     newEmbed.addFields({ name: 'Status', value: `Approved by ${interaction.user.tag} ${reason !== 'No reason provided.' ? `(${reason})` : ''}`, inline: true });
                                }
                                newEmbed.setFooter({ text: `Suggestion ID: ${row.id} | Upvotes: ${row.upvotes || 0} | Downvotes: ${row.downvotes || 0} | Approved` });
                                await suggestionMessage.edit({ embeds: [newEmbed] });
                                await interaction.reply({ content: `✅ Suggestion **#${suggestionId}** approved and original message updated.`, ephemeral: true });
                            }
                        } catch (msgError) {
                            console.error(`Error updating suggestion message ${row.message_id}:`, msgError);
                            await interaction.reply({ content: `⚠️ Suggestion **#${suggestionId}** approved, but failed to update original message (might be deleted or bot lacks permissions).`, ephemeral: true }).catch(console.error);
                        }
                    } else {
                        await interaction.reply({ content: `⚠️ Suggestion **#${suggestionId}** approved. Original message not updated (suggestions channel not found/text channel, or message ID missing).`, ephemeral: true }).catch(console.error);
                    }
                }
            }
        );
    });
}