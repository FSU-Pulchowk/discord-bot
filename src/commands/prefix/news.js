import { EmbedBuilder } from 'discord.js';
import { Command } from '../../utils/Command.js';

class NewsCommand extends Command {
    constructor(client, options) {
        super(client, {
            name: 'news',
            description: 'Provides FSU Pulchowk Campus student news & notices.',
            permissions: [],
            usage: '',
            dbInstance: options.dbInstance,
        });
    }

    async execute(message, args) {
        const newsEmbed = new EmbedBuilder()
            .setColor('#FFA500')
            .setTitle('📰 FSU Pulchowk Campus News & Notices')
            .setDescription('Latest updates for students of Free Student Union, Pulchowk Campus:')
            .addFields(
                { name: 'Official Notice Board', value: '[General Notices](https://pcampus.edu.np/category/general-notices/)\n[Student Activities](https://pcampus.edu.np/category/student-activity/)\n[Admission Notices](https://pcampus.edu.np/category/admission-notices/)\n[Career Notices](https://pcampus.edu.np/category/career/)\n[Scholarship Notices](https://pcampus.edu.np/category/scholarship/)' },
                { name: 'Academic Calendar', value: 'Important dates: [View Calendar](https://pcampus.edu.np/academic-calender/)' }
            )
            .setFooter({ text: 'Source: pcampus.edu.np' })
            .setTimestamp();
            
        message.reply({ embeds: [newsEmbed] });
    }
}

export { NewsCommand };