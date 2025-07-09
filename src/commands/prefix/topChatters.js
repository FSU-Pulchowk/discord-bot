import { EmbedBuilder } from 'discord.js';
import { Command } from '../../utils/Command.js';

class TopChattersCommand extends Command {
    constructor(client, options) {
        super(client, {
            name: 'topchatters',
            description: 'Displays leaderboard of most active message senders.',
            permissions: [], 
            usage: '[limit (1-20)]',
            aliases: ['topmessages', 'chatleaders'],
            dbInstance: options.dbInstance,
        });
    }

    async execute(message, args) {
        const limit = parseInt(args[0]) || 10;
        if (isNaN(limit) || limit <= 0 || limit > 20) {
            return this.sendUsage(message, 'The limit must be a number between 1 and 20.');
        }

        this.db.all(`SELECT user_id, messages_sent FROM user_stats WHERE guild_id = ? ORDER BY messages_sent DESC LIMIT ?`,
            [message.guild.id, limit],
            async (err, rows) => {
                if (err) {
                    console.error('Error fetching top chatters:', err.message);
                    return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription('❌ Error fetching the top chatters leaderboard.')] });
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
                            const user = await this.client.users.fetch(rows[i].user_id);
                            description += `**${i + 1}. ${user.tag}**: ${rows[i].messages_sent.toLocaleString()} messages\n`;
                        } catch (fetchErr) {
                            console.warn(`Could not fetch user ${rows[i].user_id} for top chatters:`, fetchErr.message);
                            description += `**${i + 1}. Unknown User (ID: ${rows[i].user_id})**: ${rows[i].messages_sent.toLocaleString()} messages\n`;
                        }
                    }
                    embed.setDescription(description);
                }
                message.reply({ embeds: [embed] });
            }
        );
    }
}

export { TopChattersCommand };