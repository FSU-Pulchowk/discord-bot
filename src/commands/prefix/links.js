import { EmbedBuilder } from 'discord.js';
import { Command } from '../../utils/Command.js';

class LinksCommand extends Command {
    constructor(client, options) {
        super(client, {
            name: 'links',
            description: 'Provides important FSU-related links.',
            permissions: [],
            usage: '',
            dbInstance: options.dbInstance,
        });
    }

    async execute(message, args) {
        const linksEmbed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('🔗 Important FSU Links (Pulchowk Campus)')
            .setDescription('Useful links for Free Student Union, Pulchowk Campus:')
            .addFields(
                { name: 'Pulchowk Campus', value: 'https://pcampus.edu.np/' },
                { name: 'IOE Entrance', value: 'https://entrance.ioe.edu.np/' },
                { name: 'FSU Pulchowk Facebook', value: 'https://www.facebook.com/fsupulchowk' },
                { name: 'IOE Colleges', value: 'https://ioe.tu.edu.np/colleges' },
                { name: 'Campus Gerneral Notices', value: 'https://pcampus.edu.np/category/general-notices/' }
            )
            .setFooter({ text: `Information as of ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'Asia/Kathmandu' })}` })
            .setTimestamp();
            
        message.reply({ embeds: [linksEmbed] });
    }
}

export { LinksCommand };