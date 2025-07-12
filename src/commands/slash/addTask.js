import { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } from 'discord.js';

export const data = new SlashCommandBuilder()
    .setName('addtask')
    .setDescription('Adds a new administrative task to the to-do list.')
    .addStringOption(option =>
        option.setName('description')
            .setDescription('The description of the task')
            .setRequired(true))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator); 

export async function execute(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
    }

    const taskDescription = interaction.options.getString('description');
    const userId = interaction.user.id;
    const guildId = interaction.guild.id;

    const db = interaction.client.db;

    db.run(`INSERT INTO admin_tasks (guildId, creatorId, taskDescription, createdAt, status) VALUES (?, ?, ?, ?, ?)`,
        [guildId, userId, taskDescription, Date.now(), 'pending'],
        function(err) {
            if (err) {
                console.error('Error inserting task:', err.message);
                const embed = new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error adding task: ${err.message}`);
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }
            const embed = new EmbedBuilder().setColor('#00FF00').setTitle('✅ Task Added').setDescription(`Task **#${this.lastID}**: \`${taskDescription}\``)
                .addFields(
                    { name: 'Created By', value: interaction.user.tag, inline: true },
                    { name: 'Status', value: 'Pending', inline: true }
                ).setTimestamp();
            interaction.reply({ embeds: [embed] });
        }
    );
}
