import { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } from 'discord.js';

export const data = new SlashCommandBuilder()
    .setName('addfaq')
    .setDescription('Adds a new Frequently Asked Question to the knowledge base.')
    .addStringOption(option =>
        option.setName('question')
            .setDescription('The question for the FAQ')
            .setRequired(true))
    .addStringOption(option =>
        option.setName('answer')
            .setDescription('The answer to the FAQ')
            .setRequired(true))
    .addStringOption(option =>
        option.setName('keywords')
            .setDescription('Comma-separated keywords for searching (optional)')
            .setRequired(false))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild); 

export async function execute(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
    }

    const question = interaction.options.getString('question');
    const answer = interaction.options.getString('answer');
    const keywords = interaction.options.getString('keywords');
    const userId = interaction.user.id;
    const guildId = interaction.guild.id;

    const db = interaction.client.db; 

    db.run(`INSERT INTO faqs (guild_id, question, answer, keywords, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [guildId, question, answer, keywords, userId, Date.now()],
        function(err) {
            if (err) {
                console.error('Error inserting FAQ into database:', err.message);
                const embed = new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error adding FAQ: ${err.message}`);
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }
            const embed = new EmbedBuilder().setColor('#00FF00').setTitle('✅ FAQ Added').setDescription(`FAQ ID **#${this.lastID}** added.`)
                .addFields(
                    { name: 'Question', value: question, inline: false },
                    { name: 'Answer', value: answer, inline: false },
                    { name: 'Keywords', value: keywords || 'None', inline: true },
                    { name: 'Added By', value: interaction.user.tag, inline: true }
                ).setTimestamp();
            interaction.reply({ embeds: [embed] }); 
        }
    );
}