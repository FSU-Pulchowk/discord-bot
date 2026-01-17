import { SlashCommandBuilder, PermissionsBitField } from 'discord.js';
import { db, getClubByIdentifier } from '../../database.js';
import { isServerAdmin, verifyClubChannelPermissions } from '../../utils/clubPermissions.js';

export const data = new SlashCommandBuilder()
    .setName('fixclubperms')
    .setDescription('[ADMIN] Fix permissions for club channels')
    .addStringOption(option =>
        option.setName('club')
            .setDescription('Club name or slug (leave empty to fix all)')
            .setRequired(false)
            .setAutocomplete(true))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator);

export async function execute(interaction) {
    if (!isServerAdmin(interaction.member)) {
        return await interaction.reply({
            content: '❌ Admin only command',
            ephemeral: true
        });
    }

    await interaction.deferReply({ ephemeral: true });

    const clubIdentifier = interaction.options.getString('club');

    if (clubIdentifier) {
        // Fix single club
        const club = await getClubByIdentifier(interaction.guild.id, clubIdentifier);
        if (!club) {
            return await interaction.editReply('❌ Club not found');
        }

        const result = await verifyClubChannelPermissions(interaction.guild, club.id);
        
        return await interaction.editReply({
            content: `✅ Fixed permissions for **${club.name}** (\`${club.slug}\`)\n\n` +
                     `Text Channel: ${result.results?.textChannel ? '✅' : '❌'}\n` +
                     `Voice Channel: ${result.results?.voiceChannel ? '✅' : '❌'}\n` +
                     `Category: ${result.results?.category ? '✅' : '❌'}`
        });
    } else {
        // Fix all clubs
        const clubs = await new Promise((resolve, reject) => {
            db.all(
                `SELECT id, name, slug FROM clubs WHERE guild_id = ? AND status = 'active'`,
                [interaction.guild.id],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        let fixed = 0;
        let failed = 0;

        for (const club of clubs) {
            const result = await verifyClubChannelPermissions(interaction.guild, club.id);
            if (result.success) fixed++;
            else failed++;
        }

        return await interaction.editReply({
            content: `✅ Permission fix complete!\n\n` +
                     `Fixed: ${fixed} clubs\n` +
                     `Failed: ${failed} clubs`
        });
    }
}

export async function autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused();
    
    try {
        const clubs = await new Promise((resolve, reject) => {
            db.all(
                `SELECT name, slug FROM clubs WHERE guild_id = ? AND status = 'active'`,
                [interaction.guild.id],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        const filtered = clubs
            .filter(c => 
                c.name.toLowerCase().includes(focusedValue.toLowerCase()) ||
                c.slug.toLowerCase().includes(focusedValue.toLowerCase())
            )
            .slice(0, 25)
            .map(c => ({ name: `${c.name} (${c.slug})`, value: c.slug }));

        await interaction.respond(filtered);
    } catch (error) {
        await interaction.respond([]);
    }
}