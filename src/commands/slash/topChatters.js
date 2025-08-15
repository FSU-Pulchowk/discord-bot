import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
    .setName('topchatters')
    .setDescription('Displays leaderboard of most active message senders.')
    .addIntegerOption(option =>
        option.setName('limit')
            .setDescription('Number of users to display (1-20, defaults to 10)')
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(20))
    .setDMPermission(false);

export async function execute(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    const limit = interaction.options.getInteger('limit') || 10;
    const guildId = interaction.guild.id;
    const db = interaction.client.db;

    await interaction.deferReply();

    db.all(`SELECT user_id, messages_sent FROM user_stats WHERE guild_id = ? ORDER BY messages_sent DESC LIMIT ?`,
        [guildId, limit],
        async (err, rows) => {
            if (err) {
                console.error('Error fetching top chatters:', err.message);
                return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription('❌ Error fetching the top chatters leaderboard.')] });
            }

            const embed = new EmbedBuilder()
                .setColor('#FFD700')
                .setTitle('🏆 Top Chatters Leaderboard')
                .setTimestamp();

            if (rows.length === 0) {
                embed.setDescription('No message data recorded yet for this server. Start chatting to appear on the leaderboard!');
            } else {
                let description = `Top ${rows.length} users by messages sent:\n\n`;
                for (let i = 0; i < rows.length; i++) {
                    try {
                        const user = interaction.client.users.cache.get(rows[i].user_id) || await interaction.client.users.fetch(rows[i].user_id);
                        description += `**${i + 1}. ${user.tag}**: ${rows[i].messages_sent.toLocaleString()} messages\n`;
                    } catch (fetchErr) {
                        console.warn(`Could not fetch user ${rows[i].user_id} for top chatters:`, fetchErr.message);
                        description += `**${i + 1}. Unknown User (ID: ${rows[i].user_id})**: ${rows[i].messages_sent.toLocaleString()} messages\n`;
                    }
                }
                embed.setDescription(description);
            }
            interaction.editReply({ embeds: [embed] });
        }
    );
}
