import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
    .setName('links')
    .setDescription('Provides important FSU-related links.')
    .setDMPermission(true); 

export async function execute(interaction) {
    const linksEmbed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('🔗 Important FSU Links (Pulchowk Campus)')
        .setDescription('Useful links for Free Student Union, Pulchowk Campus:')
        .addFields(
            { name: 'Pulchowk Campus', value: 'https://pcampus.edu.np/' },
            { name: 'IOE Entrance', value: 'https://entrance.ioe.edu.np/' },
            { name: 'FSU Pulchowk Facebook', value: 'https://www.facebook.com/fsupulchowk' },
            { name: 'IOE Colleges', value: 'https://ioe.tu.edu.np/colleges' },
            { name: 'Campus General Notices', value: 'https://pcampus.edu.np/category/general-notices/' }
        )
        .setFooter({ text: `Information as of ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'Asia/Kathmandu' })}` })
        .setTimestamp();
        
    interaction.reply({ embeds: [linksEmbed] }); // Public reply is fine for general info
}
