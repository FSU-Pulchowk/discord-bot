import { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } from 'discord.js';

export const data = new SlashCommandBuilder()
    .setName('removereactionrole')
    .setDescription('Removes a reaction role configuration.')
    .addStringOption(option =>
        option.setName('message_id')
            .setDescription('The ID of the message the reaction role is on')
            .setRequired(true))
    .addStringOption(option =>
        option.setName('emoji')
            .setDescription('The emoji used for the reaction role')
            .setRequired(true))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles);

export async function execute(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
    }

    const messageId = interaction.options.getString('message_id');
    const emoji = interaction.options.getString('emoji');
    const guildId = interaction.guild.id;
    const db = interaction.client.db;

    db.run(`DELETE FROM reaction_roles WHERE guild_id = ? AND message_id = ? AND emoji = ?`,
        [guildId, messageId, emoji],
        async function(err) {
            if (err) {
                console.error('Error deleting reaction role from DB:', err.message);
                return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error removing reaction role: ${err.message}`)], ephemeral: true });
            }
            if (this.changes > 0) { 
                await interaction.reply({ embeds: [new EmbedBuilder().setColor('#00FF00').setTitle('✅ Reaction Role Removed').setDescription(`Reaction role for ${emoji} on message ID \`${messageId}\` removed.`)], ephemeral: true });

                try {
                    const targetMsg = await interaction.channel.messages.fetch(messageId);
                    const emojiIdentifier = emoji.includes(':') ? emoji.split(':')[1] : emoji; // Handle custom emojis
                    const botReaction = targetMsg.reactions.cache.get(emojiIdentifier);
                    if (botReaction && botReaction.me) { 
                        await botReaction.users.remove(interaction.client.user.id);
                    }
                } catch (e) {
                    console.warn(`Could not remove bot's reaction from message ${messageId}:`, e.message);
                }
            } else {
                interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription(`❌ No reaction role found for ${emoji} on message ID \`${messageId}\` in this server.`)], ephemeral: true });
            }
        }
    );
}