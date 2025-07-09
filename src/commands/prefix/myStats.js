import { EmbedBuilder } from 'discord.js';
import { Command } from '../../utils/Command.js';

class MyStatsCommand extends Command {
    constructor(client, options) {
        super(client, {
            name: 'mystats',
            description: 'Displays your message count and voice chat time.',
            permissions: [],
            usage: '',
            dbInstance: options.dbInstance,
        });
    }

    async execute(message, args) {
        this.db.get(`SELECT messages_sent, voice_time_minutes FROM user_stats WHERE user_id = ? AND guild_id = ?`,
            [message.author.id, message.guild.id], (err, row) => {
                if (err) {
                    console.error('Error fetching user stats:', err.message);
                    return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error fetching your stats: ${err.message}`)] });
                }
                const embed = new EmbedBuilder()
                    .setColor('#0099ff') // Blue
                    .setTitle(`📊 ${message.author.tag}'s Stats`)
                    .setDescription('Your activity in this server:')
                    .addFields(
                        { name: 'Messages Sent', value: (row ? row.messages_sent : 0).toLocaleString(), inline: true },
                        { name: 'Voice Time', value: `${row ? row.voice_time_minutes : 0} minutes`, inline: true }
                    )
                    .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
                    .setTimestamp();
                message.reply({ embeds: [embed] });
            }
        );
    }
}

export { MyStatsCommand };