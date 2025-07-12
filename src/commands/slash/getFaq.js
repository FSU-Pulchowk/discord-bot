import { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } from 'discord.js';

export const data = new SlashCommandBuilder()
    .setName('getfaq')
    .setDescription('Retrieves an FAQ by ID or searches by keywords.')
    .addStringOption(option =>
        option.setName('query')
            .setDescription('FAQ ID or keywords to search for')
            .setRequired(true)); 

export async function execute(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }


    const queryInput = interaction.options.getString('query').toLowerCase();
    const faqId = parseInt(queryInput);
    let sqlQuery, params;

    const db = interaction.client.db;

    if (!isNaN(faqId)) {
        sqlQuery = `SELECT * FROM faqs WHERE id = ? AND guild_id = ?`;
        params = [faqId, interaction.guild.id];
    } else {
        const searchKeywords = `%${queryInput}%`;
        sqlQuery = `SELECT * FROM faqs WHERE guild_id = ? AND (LOWER(question) LIKE ? OR LOWER(answer) LIKE ? OR (keywords IS NOT NULL AND LOWER(keywords) LIKE ?)) ORDER BY id DESC LIMIT 5`;
        params = [interaction.guild.id, searchKeywords, searchKeywords, searchKeywords];
    }

    db.all(sqlQuery, params, async (err, rows) => {
        if (err) {
            console.error('Error fetching FAQ:', err.message);
            return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error fetching FAQ: ${err.message}`)], ephemeral: true });
        }
        if (rows.length === 0) {
            return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription(`❌ No FAQ found for "${queryInput}".`)], ephemeral: true });
        }

        const embeds = [];
        for (const row of rows) {
            let creatorTag = 'FSU';
            if (row.created_by) {
                try {
                    const creator = await interaction.client.users.fetch(row.created_by); // Use interaction.client.users.fetch
                    creatorTag = creator.tag;
                } catch (fetchError) {
                    console.warn(`Could not fetch user ${row.created_by} for FAQ ID ${row.id}:`, fetchError.message);
                }
            }
            embeds.push(new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle(`❓ FAQ ID #${row.id}: ${row.question}`)
                .setDescription(row.answer)
                .addFields(
                    { name: 'Keywords', value: row.keywords || 'None', inline: true },
                    { name: 'Added By', value: creatorTag, inline: true }
                )
                .setTimestamp(new Date(row.created_at || Date.now())));
        }
        interaction.reply({ embeds: embeds.slice(0, 5) }); 
    });
}