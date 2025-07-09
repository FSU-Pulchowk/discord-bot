import { EmbedBuilder, PermissionsBitField } from 'discord.js';
import { Command } from '../../utils/Command.js';

class RemoveFaqCommand extends Command {
    constructor(client, options) {
        super(client, {
            name: 'removefaq',
            description: 'Removes an FAQ by its ID.',
            permissions: [PermissionsBitField.Flags.Administrator, PermissionsBitField.Flags.ManageGuild],
            usage: '<FAQ ID>',
            dbInstance: options.dbInstance,
        });
    }

    async execute(message, args) {
        const faqId = parseInt(args[0]);
        if (isNaN(faqId)) return this.sendUsage(message, 'Please provide a valid FAQ ID to remove.');

        this.db.run(`DELETE FROM faqs WHERE id = ? AND guild_id = ?`, [faqId, message.guild.id], function(err) {
            if (err) {
                console.error('Error deleting FAQ:', err.message);
                return message.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error deleting FAQ: ${err.message}`)] });
            }
            if (this.changes > 0) {
                message.reply({ embeds: [new EmbedBuilder().setColor('#00FF00').setTitle('✅ FAQ Removed').setDescription(`FAQ ID **#${faqId}** has been successfully removed.`)] });
            } else {
                message.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription(`❌ No FAQ with ID **#${faqId}** found for this server.`)] });
            }
        });
    }
}

export { RemoveFaqCommand };