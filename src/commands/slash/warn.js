import { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } from 'discord.js';

export const data = new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warns a user and records it in the database.')
    .addUserOption(option =>
        option.setName('target_user')
            .setDescription('The user to warn')
            .setRequired(true))
    .addStringOption(option =>
        option.setName('reason')
            .setDescription('Reason for the warning (optional)')
            .setRequired(false))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.KickMembers);
export async function execute(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
        return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
    }

    const targetUser = interaction.options.getMember('target_user');
    const reason = interaction.options.getString('reason') || 'No reason provided.';

    if (!targetUser) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription("❌ Please mention a user to warn.")], ephemeral: true });
    }
    if (targetUser.id === interaction.user.id) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription("❌ You cannot warn yourself.")], ephemeral: true });
    }
    if (targetUser.id === interaction.client.user.id) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription("❌ I cannot be warned.")], ephemeral: true });
    }
    if (targetUser.id === interaction.guild.ownerId) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription("❌ Cannot warn the server owner.")], ephemeral: true });
    }
    if (targetUser.roles.highest.position >= interaction.member.roles.highest.position && interaction.user.id !== interaction.guild.ownerId) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription("❌ Cannot warn a user with a role equal to or higher than your own.")], ephemeral: true });
    }

    const guildId = interaction.guild.id;
    const moderatorId = interaction.user.id;
    const db = interaction.client.db;

    db.run(`INSERT INTO warnings (userId, guildId, moderatorId, reason, timestamp) VALUES (?, ?, ?, ?, ?)`,
        [targetUser.id, guildId, moderatorId, reason, Date.now()],
        function(err) {
            if (err) {
                console.error('Error inserting warning into database:', err.message);
                return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ An error occurred while recording the warning: ${err.message}`)], ephemeral: true });
            }
            const warningId = this.lastID; 
            const embed = new EmbedBuilder()
                .setColor('#FFA500')
                .setTitle('⚠️ User Warned')
                .setDescription(`**${targetUser.user.tag}** has been warned.`)
                .addFields(
                    { name: 'Moderator', value: interaction.user.tag, inline: true },
                    { name: 'Reason', value: reason, inline: true },
                    { name: 'Warning ID', value: warningId.toString(), inline: true }
                )
                .setTimestamp();
            
            interaction.reply({ embeds: [embed] });

            targetUser.send(`You have been warned in **${interaction.guild.name}** for: \`${reason}\`. Your warning ID is: \`${warningId}\`.\n\nRepeated warnings may lead to further moderation actions.`).catch(dmErr => {
                console.warn(`Could not DM warning message to ${targetUser.user.tag}:`, dmErr.message);
                interaction.followUp({ content: `⚠️ Could not DM warning to ${targetUser.user.tag}. They might have DMs disabled or I lack permissions.`, ephemeral: true }).catch(e => console.error("Error sending DM failure message:", e));
            });
        }
    );
}