import { EmbedBuilder } from 'discord.js';
import { Command } from '../../utils/Command.js';

class RemoveBirthdayCommand extends Command {
    constructor(client, options) {
        super(client, {
            name: 'removebirthday',
            description: 'Removes your birthday from announcements.',
            permissions: [],
            usage: '',
            dbInstance: options.dbInstance,
        });
    }

    async execute(message, args) {
        this.db.run(`DELETE FROM birthdays WHERE user_id = ? AND guild_id = ?`, [message.author.id, message.guild.id], function(err) {
            if (err) {
                console.error('Error removing birthday:', err.message);
                return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error removing your birthday: ${err.message}`)] });
            }
            if (this.changes > 0) {
                message.reply({ embeds: [new EmbedBuilder().setColor('#00FF00').setTitle('🗑️ Birthday Removed').setDescription('Your birthday has been successfully removed from the announcement list.')] });
            } else {
                message.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription('❌ No birthday was found for you to remove in this server.')] });
            }
        });
    }
}

export { RemoveBirthdayCommand };