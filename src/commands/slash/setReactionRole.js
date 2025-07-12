import { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } from 'discord.js';

export const data = new SlashCommandBuilder()
    .setName('setreactionrole')
    .setDescription('Sets up a reaction role on a message.')
    .addStringOption(option =>
        option.setName('message_id')
            .setDescription('The ID of the message to add the reaction role to')
            .setRequired(true))
    .addStringOption(option =>
        option.setName('emoji')
            .setDescription('The emoji to react with (e.g., 👍 or a custom emoji ID)')
            .setRequired(true))
    .addRoleOption(option =>
        option.setName('role')
            .setDescription('The role to assign when the emoji is reacted to')
            .setRequired(true))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles);

export async function execute(interaction) {
    if (!interaction.guild) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
    }

    const messageId = interaction.options.getString('message_id');
    const emoji = interaction.options.getString('emoji');
    const role = interaction.options.getRole('role');
    const guildId = interaction.guild.id;
    const db = interaction.client.db;

    let targetMessage;
    try {
        targetMessage = await interaction.channel.messages.fetch(messageId);
    } catch (fetchError) {
        console.error(`Error fetching message ${messageId}:`, fetchError);
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Message with ID \`${messageId}\` not found in this channel.`)], ephemeral: true });
    }

    if (!role) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFC107').setDescription(`❌ Role not found.`)], ephemeral: true });
    }

    if (!interaction.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription("❌ I need the 'Manage Roles' permission to set up reaction roles.")], ephemeral: true });
    }
    if (interaction.guild.members.me.roles.highest.position <= role.position) {
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ I cannot assign "${role.name}" because my highest role is not above it in the role hierarchy.`)], ephemeral: true });
    }

    try {
        await targetMessage.react(emoji);
    } catch (reactError) {
        console.error('Error reacting for reaction role:', reactError);
        return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Failed to react with ${emoji}. Please ensure it's a valid emoji and I have permission to react.`)], ephemeral: true });
    }

    db.run(`INSERT OR REPLACE INTO reaction_roles (guild_id, message_id, emoji, role_id) VALUES (?, ?, ?, ?)`,
        [guildId, messageId, emoji, role.id],
        (err) => {
            if (err) {
                console.error('Error saving reaction role to DB:', err.message);
                return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`❌ Error saving reaction role: ${err.message}`)], ephemeral: true });
            }
            const embed = new EmbedBuilder()
                .setColor('#00FF00') 
                .setTitle('✅ Reaction Role Set')
                .setDescription(`Reacting with ${emoji} on [this message](${targetMessage.url}) will now give the **${role.name}** role.`)
                .addFields(
                    { name: 'Message ID', value: messageId, inline: true },
                    { name: 'Emoji', value: emoji, inline: true },
                    { name: 'Role', value: role.name, inline: true }
                )
                .setTimestamp();
            interaction.reply({ embeds: [embed] }); // Can be ephemeral or public
        }
    );
}