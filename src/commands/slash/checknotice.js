import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

export const data = new SlashCommandBuilder()
    .setName('checknotices')
    .setDescription('Manually trigger a notice check (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
        if (!interaction.client.noticeProcessor) {
            return await interaction.editReply('❌ Notice processor not available.');
        }
        await interaction.editReply('🔄 Starting manual notice check...');
        await interaction.client.noticeProcessor.checkAndAnnounceNotices();
        await interaction.editReply('✅ Manual notice check completed successfully!');
    } catch (error) {
        console.error('Manual notice check error:', error);
        await interaction.editReply(`❌ Error during manual notice check: ${error.message}`);
    }
}