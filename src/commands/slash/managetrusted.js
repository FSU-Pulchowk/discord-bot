// src/commands/slash/managetrusted.js
import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { db } from '../../database.js';
import { log } from '../../utils/debug.js';

export const data = new SlashCommandBuilder()
    .setName('managetrusted')
    .setDescription('Manage trusted members for your club')
    .addSubcommand(subcommand =>
        subcommand
            .setName('add')
            .setDescription('Add a trusted member to your club')
            .addIntegerOption(option =>
                option.setName('club_id')
                    .setDescription('Your club ID')
                    .setRequired(true))
            .addUserOption(option =>
                option.setName('user')
                    .setDescription('User to add as trusted member')
                    .setRequired(true)))
    .addSubcommand(subcommand =>
        subcommand
            .setName('remove')
            .setDescription('Remove a trusted member from your club')
            .addIntegerOption(option =>
                option.setName('club_id')
                    .setDescription('Your club ID')
                    .setRequired(true))
            .addUserOption(option =>
                option.setName('user')
                    .setDescription('User to remove from trusted members')
                    .setRequired(true)))
    .addSubcommand(subcommand =>
        subcommand
            .setName('list')
            .setDescription('List all trusted members of your club')
            .addIntegerOption(option =>
                option.setName('club_id')
                    .setDescription('Your club ID')
                    .setRequired(true)));

export async function execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const clubId = interaction.options.getInteger('club_id');

    // Verify club exists and user is president
    const club = await new Promise((resolve, reject) => {
        db.get(
            `SELECT * FROM clubs WHERE id = ? AND status = 'active'`,
            [clubId],
            (err, row) => {
                if (err) reject(err);
                else resolve(row);
            }
        );
    });

    if (!club) {
        return await interaction.reply({
            content: 'Club not found or inactive.',
            flags: MessageFlags.Ephemeral
        });
    }

    // Check if user is president
    if (club.president_user_id !== interaction.user.id) {
        return await interaction.reply({
            content: 'Only the club president can manage trusted members.',
            flags: MessageFlags.Ephemeral
        });
    }

    switch (subcommand) {
        case 'add':
            await handleAddTrusted(interaction, club);
            break;
        case 'remove':
            await handleRemoveTrusted(interaction, club);
            break;
        case 'list':
            await handleListTrusted(interaction, club);
            break;
    }
}

async function handleAddTrusted(interaction, club) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const user = interaction.options.getUser('user');

    try {
        // Check if user is already trusted
        const existing = await new Promise((resolve, reject) => {
            db.get(
                `SELECT id FROM club_trusted_members WHERE club_id = ? AND user_id = ?`,
                [club.id, user.id],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (existing) {
            return await interaction.editReply({
                content: `${user.tag} is already a trusted member of ${club.name}.`
            });
        }

        // Check if user is a member of the club
        const isMember = await new Promise((resolve, reject) => {
            db.get(
                `SELECT id FROM club_members WHERE club_id = ? AND user_id = ? AND status = 'active'`,
                [club.id, user.id],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!isMember) {
            return await interaction.editReply({
                content: `${user.tag} must be a member of ${club.name} before being added as a trusted member.`
            });
        }

        // Add as trusted member
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO club_trusted_members (club_id, user_id) VALUES (?, ?)`,
                [club.id, user.id],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        // Update member role in database
        await new Promise((resolve, reject) => {
            db.run(
                `UPDATE club_members SET role = 'officer' WHERE club_id = ? AND user_id = ?`,
                [club.id, user.id],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        // Log action
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO club_audit_log (guild_id, action_type, performed_by, target_id, details) 
                 VALUES (?, 'trusted_member_added', ?, ?, ?)`,
                [
                    interaction.guild.id,
                    interaction.user.id,
                    club.id.toString(),
                    JSON.stringify({ clubName: club.name, trustedUserId: user.id, trustedUserTag: user.tag })
                ],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        // Send notification to user
        try {
            const dmEmbed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('Promoted to Trusted Member!')
                .setDescription(`You've been promoted to a **Trusted Member** of **${club.name}**!`)
                .addFields(
                    { name: 'New Permissions', value: 
                        '• Create events for the club\n' +
                        '• Post announcements\n' +
                        '• Approve join requests\n' +
                        '• Manage club activities'
                    },
                    { name: 'Promoted By', value: `${interaction.user.tag}`, inline: true }
                )
                .setTimestamp();

            await user.send({ embeds: [dmEmbed] });
        } catch (dmError) {
            log('Failed to send trusted member notification DM', 'club', null, dmError, 'warn');
        }

        // Success response
        const successEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('Trusted Member Added')
            .setDescription(`${user} has been added as a trusted member of **${club.name}**`)
            .addFields(
                { name: 'User', value: `${user.tag} (<@${user.id}>)`, inline: true },
                { name: 'Club', value: club.name, inline: true },
                { name: 'Permissions Granted', value: 
                    '• Create events\n' +
                    '• Post announcements\n' +
                    '• Approve join requests'
                }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [successEmbed] });

    } catch (error) {
        log('Error adding trusted member', 'club', null, error, 'error');
        await interaction.editReply({
            content: `An error occurred: ${error.message}`
        });
    }
}

async function handleRemoveTrusted(interaction, club) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const user = interaction.options.getUser('user');

    try {
        // Check if user is trusted
        const existing = await new Promise((resolve, reject) => {
            db.get(
                `SELECT id FROM club_trusted_members WHERE club_id = ? AND user_id = ?`,
                [club.id, user.id],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!existing) {
            return await interaction.editReply({
                content: `${user.tag} is not a trusted member of ${club.name}.`
            });
        }

        // Remove trusted status
        await new Promise((resolve, reject) => {
            db.run(
                `DELETE FROM club_trusted_members WHERE club_id = ? AND user_id = ?`,
                [club.id, user.id],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        // Update member role back to regular member
        await new Promise((resolve, reject) => {
            db.run(
                `UPDATE club_members SET role = 'member' WHERE club_id = ? AND user_id = ?`,
                [club.id, user.id],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        // Log action
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO club_audit_log (guild_id, action_type, performed_by, target_id, details) 
                 VALUES (?, 'trusted_member_removed', ?, ?, ?)`,
                [
                    interaction.guild.id,
                    interaction.user.id,
                    club.id.toString(),
                    JSON.stringify({ clubName: club.name, removedUserId: user.id, removedUserTag: user.tag })
                ],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        // Send notification to user
        try {
            const dmEmbed = new EmbedBuilder()
                .setColor('#FFA500')
                .setTitle('Trusted Member Status Removed')
                .setDescription(`Your **Trusted Member** status for **${club.name}** has been removed.`)
                .addFields(
                    { name: 'Note', value: 'You are still a member of the club with regular member permissions.' },
                    { name: 'Removed By', value: `${interaction.user.tag}`, inline: true }
                )
                .setTimestamp();

            await user.send({ embeds: [dmEmbed] });
        } catch (dmError) {
            log('Failed to send removal notification DM', 'club', null, dmError, 'warn');
        }

        // Success response
        const successEmbed = new EmbedBuilder()
            .setColor('#FFA500')
            .setTitle('Trusted Member Removed')
            .setDescription(`${user} has been removed as a trusted member of **${club.name}**`)
            .addFields(
                { name: 'User', value: `${user.tag} (<@${user.id}>)`, inline: true },
                { name: 'Club', value: club.name, inline: true },
                { name: 'Status', value: 'Regular member permissions' }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [successEmbed] });

    } catch (error) {
        log('Error removing trusted member', 'club', null, error, 'error');
        await interaction.editReply({
            content: `An error occurred: ${error.message}`
        });
    }
}

async function handleListTrusted(interaction, club) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        // Get all trusted members
        const trustedMembers = await new Promise((resolve, reject) => {
            db.all(
                `SELECT tm.user_id, tm.added_at 
                 FROM club_trusted_members tm
                 WHERE tm.club_id = ?
                 ORDER BY tm.added_at ASC`,
                [club.id],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle(`Trusted Members - ${club.name}`)
            .setDescription(trustedMembers.length === 0 ? 
                'No trusted members yet. Use `/managetrusted add` to add trusted members.' :
                `Total: ${trustedMembers.length} trusted member(s)`)
            .setTimestamp();

        if (trustedMembers.length > 0) {
            let memberList = '';
            
            for (let i = 0; i < trustedMembers.length; i++) {
                const tm = trustedMembers[i];
                try {
                    const user = await interaction.client.users.fetch(tm.user_id);
                    const addedDate = new Date(tm.added_at * 1000).toLocaleDateString();
                    memberList += `${i + 1}. ${user.tag} (<@${user.id}>)\n   Added: ${addedDate}\n`;
                } catch (error) {
                    memberList += `${i + 1}. Unknown User (ID: ${tm.user_id})\n`;
                }
            }

            // Split into chunks if too long
            const chunks = memberList.match(/.{1,1024}/gs) || [];
            chunks.forEach((chunk, index) => {
                embed.addFields({
                    name: index === 0 ? 'Trusted Members' : 'Continued',
                    value: chunk,
                    inline: false
                });
            });
        }

        embed.addFields({
            name: 'Trusted Member Permissions',
            value: '• Create events\n• Post announcements\n• Approve join requests\n• Manage club activities',
            inline: false
        });

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        log('Error listing trusted members', 'club', null, error, 'error');
        await interaction.editReply({
            content: `An error occurred: ${error.message}`
        });
    }
}