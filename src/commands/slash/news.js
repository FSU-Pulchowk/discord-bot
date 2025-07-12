import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
    .setName('news')
    .setDescription('Provides FSU Pulchowk Campus student news & notices.')
    .setDMPermission(true);

export async function execute(interaction) {
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
        
    interaction.reply({ embeds: [newsEmbed] });
}