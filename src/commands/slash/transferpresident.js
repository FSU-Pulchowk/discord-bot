// src/commands/slash/transferpresident.js
import { 
    SlashCommandBuilder, 
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    MessageFlags,
    PermissionsBitField
} from 'discord.js';
import { db, getClubByIdentifier, isClubPresident } from '../../database.js';
import { log } from '../../utils/debug.js';
import { isServerAdmin, hasServerPrivilegedRole } from '../../utils/clubPermissions.js';

export const data = new SlashCommandBuilder()
    .setName('transferpresident')
    .setDescription('Transfer club presidency to another member')
    .addStringOption(option =>
        option.setName('club')
            .setDescription('Club name or slug')
            .setRequired(true)
            .setAutocomplete(true))
    .addUserOption(option =>
        option.setName('new_president')
            .setDescription('New president (must be verified club member)')
            .setRequired(true))
    .addStringOption(option =>
        option.setName('reason')
            .setDescription('Reason for transfer')
            .setRequired(true)
            .setMaxLength(500));

export async function execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const clubIdentifier = interaction.options.getString('club');
    const newPresident = interaction.options.getUser('new_president');
    const reason = interaction.options.getString('reason');
    const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID || 'YOUR_VERIFIED_ROLE_ID';

    try {
        // Get club details
        const club = await getClubByIdentifier(interaction.guild.id, clubIdentifier);

        if (!club) {
            return await interaction.editReply({
                content: '❌ Club not found. Please check the club name/slug and try again.'
            });
        }

        if (club.status !== 'active') {
            return await interaction.editReply({
                content: `❌ This club is currently ${club.status}. Presidency cannot be transferred.`
            });
        }

        // Check if new president is the same as current
        if (newPresident.id === club.president_user_id) {
            return await interaction.editReply({
                content: '❌ This user is already the club president.'
            });
        }

        // Check if new president has Pulchowkian role
        const newPresidentMember = await interaction.guild.members.fetch(newPresident.id);
        if (!newPresidentMember.roles.cache.has(VERIFIED_ROLE_ID)) {
            return await interaction.editReply({
                content: `❌ ${newPresident.tag} must have the @Pulchowkian role to become club president.\n\nThey need to verify first using \`/verify\`.`
            });
        }

        // Check if new president is a club member
        const isMember = await new Promise((resolve, reject) => {
            db.get(
                `SELECT id, role FROM club_members WHERE club_id = ? AND user_id = ? AND status = 'active'`,
                [club.id, newPresident.id],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!isMember) {
            return await interaction.editReply({
                content: `❌ ${newPresident.tag} must be an active member of **${club.name}** to become president.\n\nThey need to join the club first.`
            });
        }

        // Determine who is initiating the transfer and permission requirements
        const isCurrentPresident = await isClubPresident(club.id, interaction.user.id);
        const isOwner = interaction.guild.ownerId === interaction.user.id;
        const isAdmin = isServerAdmin(interaction.member);
        const isMod = hasServerPrivilegedRole(interaction.member) && !isAdmin;

        // Permission check
        if (!isCurrentPresident && !isOwner && !isAdmin && !isMod) {
            return await interaction.editReply({
                content: '❌ You don\'t have permission to transfer club presidency.\n\n**Who can transfer:**\n• Current club president\n• Server owner\n• Server administrators\n• Server moderators (with owner approval)'
            });
        }

        // If server admin or moderator (not owner), require owner approval
        if ((isAdmin || isMod) && !isOwner && !isCurrentPresident) {
            await requestOwnerApproval(interaction, club, newPresident, reason, isAdmin ? 'admin' : 'moderator');
            return;
        }

        // Direct transfer (current president or owner)
        await executeTransfer(interaction, club, newPresident, reason, interaction.user.id, null);

    } catch (error) {
        log('Error in transferpresident command', 'club', null, error, 'error');
        await interaction.editReply({
            content: `❌ An error occurred: ${error.message}`
        }).catch(() => {});
    }
}

/**
 * Request owner approval for admin/mod initiated transfer
 */
async function requestOwnerApproval(interaction, club, newPresident, reason, initiatorRole) {
    try {
        const guild = interaction.guild;
        const owner = await guild.fetchOwner();

        // Create pending transfer record
        const transferId = `transfer_${club.id}_${Date.now()}`;
        
        // Store in temporary storage (you could use a database table or in-memory map)
        // For simplicity, we'll use the audit log and check button custom_id
        
        const approvalEmbed = new EmbedBuilder()
            .setColor('#FFA500')
            .setTitle('🔄 Club Presidency Transfer - Approval Required')
            .setDescription(`A ${initiatorRole} has requested to transfer club presidency and requires your approval.`)
            .addFields(
                { name: '🏛️ Club', value: club.name, inline: true },
                { name: '🔗 Slug', value: `\`${club.slug}\``, inline: true },
                { name: '👤 Current President', value: `<@${club.president_user_id}>`, inline: true },
                { name: '👤 New President', value: `${newPresident} (${newPresident.tag})`, inline: true },
                { name: '👮 Requested By', value: `${interaction.user} (${initiatorRole})`, inline: true },
                { name: '🆔 Club ID', value: club.id.toString(), inline: true },
                { name: '📝 Reason', value: reason, inline: false },
                { name: '⚠️ Action Required', value: 'As the server owner, you must approve this transfer for it to proceed.', inline: false }
            )
            .setTimestamp()
            .setFooter({ text: 'Only the server owner can approve this transfer' });

        const approveButton = new ButtonBuilder()
            .setCustomId(`approve_transfer_${club.id}_${newPresident.id}_${interaction.user.id}`)
            .setLabel('Approve Transfer')
            .setStyle(ButtonStyle.Success)
            .setEmoji('✅');

        const denyButton = new ButtonBuilder()
            .setCustomId(`deny_transfer_${club.id}_${newPresident.id}_${interaction.user.id}`)
            .setLabel('Deny Transfer')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('❌');

        const row = new ActionRowBuilder().addComponents(approveButton, denyButton);

        // Send to owner
        await owner.send({ embeds: [approvalEmbed], components: [row] });

        // Log the request
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO club_audit_log (guild_id, club_id, action_type, performed_by, target_id, details) 
                 VALUES (?, ?, 'president_transfer_requested', ?, ?, ?)`,
                [
                    guild.id,
                    club.id,
                    interaction.user.id,
                    newPresident.id,
                    JSON.stringify({ 
                        clubName: club.name,
                        clubSlug: club.slug,
                        currentPresident: club.president_user_id,
                        newPresident: newPresident.id,
                        reason,
                        initiatorRole,
                        requiresApproval: true
                    })
                ],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        // Confirm to initiator
        const confirmEmbed = new EmbedBuilder()
            .setColor('#FFA500')
            .setTitle('⏳ Transfer Request Sent')
            .setDescription(`Your request to transfer presidency of **${club.name}** has been sent to the server owner for approval.`)
            .addFields(
                { name: '🏛️ Club', value: club.name, inline: true },
                { name: '🔗 Slug', value: `\`${club.slug}\``, inline: true },
                { name: '👤 New President', value: newPresident.tag, inline: true },
                { name: '📝 Reason', value: reason, inline: false },
                { name: '⏳ Next Steps', value: 
                    '• The server owner will review your request\n' +
                    '• You\'ll be notified when a decision is made\n' +
                    '• If approved, the transfer will be executed automatically'
                }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [confirmEmbed] });

    } catch (error) {
        log('Error requesting owner approval', 'club', null, error, 'error');
        await interaction.editReply({
            content: '❌ Failed to send approval request to server owner. They may have DMs disabled.'
        });
    }
}

/**
 * Execute the presidency transfer
 */
async function executeTransfer(interaction, club, newPresident, reason, initiatedBy, approvedBy) {
    try {
        const guild = interaction.guild;
        const oldPresidentId = club.president_user_id;

        // Get club roles
        const clubRole = club.role_id ? await guild.roles.fetch(club.role_id).catch(() => null) : null;
        const modRole = club.moderator_role_id ? await guild.roles.fetch(club.moderator_role_id).catch(() => null) : null;

        if (!clubRole || !modRole) {
            return await interaction.editReply({
                content: '❌ Club roles not found. Please contact an administrator.'
            });
        }

        // Fetch members
        const oldPresidentMember = await guild.members.fetch(oldPresidentId).catch(() => null);
        const newPresidentMember = await guild.members.fetch(newPresident.id);

        // Update database - Change old president to member
        await new Promise((resolve, reject) => {
            db.run(
                `UPDATE club_members SET role = 'member', updated_at = ? WHERE club_id = ? AND user_id = ?`,
                [Date.now(), club.id, oldPresidentId],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        // Update database - Change new president role
        await new Promise((resolve, reject) => {
            db.run(
                `UPDATE club_members SET role = 'president', updated_at = ? WHERE club_id = ? AND user_id = ?`,
                [Date.now(), club.id, newPresident.id],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        // Update club president
        await new Promise((resolve, reject) => {
            db.run(
                `UPDATE clubs SET president_user_id = ?, updated_at = ? WHERE id = ?`,
                [newPresident.id, Date.now(), club.id],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        // Update Discord roles
        // Old president: Keep club role, keep mod role (optional - could remove)
        // New president: Ensure has both club role and mod role
        if (newPresidentMember) {
            if (!newPresidentMember.roles.cache.has(clubRole.id)) {
                await newPresidentMember.roles.add(clubRole, 'Became club president');
            }
            if (!newPresidentMember.roles.cache.has(modRole.id)) {
                await newPresidentMember.roles.add(modRole, 'Became club president');
            }
        }

        // Optionally keep old president as moderator or demote to regular member
        // For now, we'll keep them as moderator (they keep the mod role)

        // Log the transfer
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO club_audit_log (guild_id, club_id, action_type, performed_by, target_id, details) 
                 VALUES (?, ?, 'president_transferred', ?, ?, ?)`,
                [
                    guild.id,
                    club.id,
                    initiatedBy,
                    newPresident.id,
                    JSON.stringify({ 
                        clubName: club.name,
                        clubSlug: club.slug,
                        oldPresident: oldPresidentId,
                        newPresident: newPresident.id,
                        reason,
                        approvedBy: approvedBy || 'direct'
                    })
                ],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        // Create success embed
        const successEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('✅ Presidency Transferred Successfully')
            .setDescription(`**${club.name}** has a new president!`)
            .addFields(
                { name: '🏛️ Club', value: club.name, inline: true },
                { name: '🔗 Slug', value: `\`${club.slug}\``, inline: true },
                { name: '👤 Previous President', value: `<@${oldPresidentId}>`, inline: true },
                { name: '👑 New President', value: `${newPresident} (${newPresident.tag})`, inline: true },
                { name: '👮 Initiated By', value: `<@${initiatedBy}>`, inline: true }
            );

        if (approvedBy) {
            successEmbed.addFields({ name: '✅ Approved By', value: `<@${approvedBy}>`, inline: true });
        }

        successEmbed.addFields({ name: '📝 Reason', value: reason, inline: false });
        successEmbed.setTimestamp();

        await interaction.editReply({ embeds: [successEmbed] });

        // Notify the new president
        try {
            const newPresidentNotify = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('👑 You are now Club President!')
                .setDescription(`You have been appointed as the president of **${club.name}** in ${guild.name}`)
                .addFields(
                    { name: '🏛️ Club', value: club.name, inline: true },
                    { name: '🔗 Slug', value: `\`${club.slug}\``, inline: true },
                    { name: '📝 Reason', value: reason, inline: false },
                    { name: '👑 Your Responsibilities', value: 
                        '• Lead and manage the club\n' +
                        '• Promote moderators using `/clubmod`\n' +
                        '• Create events and announcements\n' +
                        '• Grow the club membership\n' +
                        '• Transfer presidency when stepping down'
                    }
                )
                .setTimestamp();

            await newPresident.send({ embeds: [newPresidentNotify] });
        } catch (dmError) {
            log('Could not DM new president', 'club', null, dmError, 'warn');
        }

        // Notify the old president
        if (oldPresidentMember && oldPresidentId !== initiatedBy) {
            try {
                const oldPresidentNotify = new EmbedBuilder()
                    .setColor('#FFA500')
                    .setTitle('🔄 Club Presidency Transferred')
                    .setDescription(`You are no longer the president of **${club.name}**`)
                    .addFields(
                        { name: '🏛️ Club', value: club.name, inline: true },
                        { name: '🔗 Slug', value: `\`${club.slug}\``, inline: true },
                        { name: '👑 New President', value: newPresident.tag, inline: true },
                        { name: '📝 Reason', value: reason, inline: false },
                        { name: '📊 Your Status', value: 'You remain a club member and retain moderator privileges.', inline: false }
                    )
                    .setTimestamp();

                const oldPresidentUser = await interaction.client.users.fetch(oldPresidentId);
                await oldPresidentUser.send({ embeds: [oldPresidentNotify] });
            } catch (dmError) {
                log('Could not DM old president', 'club', null, dmError, 'warn');
            }
        }

        // Post announcement in club channel
        if (club.channel_id) {
            try {
                const channel = await guild.channels.fetch(club.channel_id);
                const announcementEmbed = new EmbedBuilder()
                    .setColor('#5865F2')
                    .setTitle('👑 New Club President')
                    .setDescription(`**${club.name}** has a new president!`)
                    .addFields(
                        { name: '👑 New President', value: `${newPresident}`, inline: true },
                        { name: '🙏 Thank You', value: `<@${oldPresidentId}> for your leadership!`, inline: true }
                    )
                    .setTimestamp();

                await channel.send({ 
                    content: club.role_id ? `<@&${club.role_id}>` : null,
                    embeds: [announcementEmbed] 
                });
            } catch (channelError) {
                log('Could not post to club channel', 'club', null, channelError, 'warn');
            }
        }

    } catch (error) {
        log('Error executing transfer', 'club', null, error, 'error');
        throw error;
    }
}

/**
 * Handle approval button click
 */
export async function handleTransferApproval(interaction, action) {
    await interaction.deferUpdate();

    const parts = interaction.customId.split('_');
    const clubId = parseInt(parts[2]);
    const newPresidentId = parts[3];
    const initiatedBy = parts[4];

    try {
        // Verify this is the server owner
        if (interaction.user.id !== interaction.guild.ownerId) {
            return await interaction.followUp({
                content: '❌ Only the server owner can approve presidency transfers.',
                ephemeral: true
            });
        }

        // Get club details
        const club = await new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM clubs WHERE id = ?`,
                [clubId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!club) {
            return await interaction.followUp({
                content: '❌ Club not found.',
                ephemeral: true
            });
        }

        // Get the audit log entry for the reason
        const auditEntry = await new Promise((resolve, reject) => {
            db.get(
                `SELECT details FROM club_audit_log 
                 WHERE club_id = ? AND action_type = 'president_transfer_requested' 
                 AND target_id = ? AND performed_by = ?
                 ORDER BY timestamp DESC LIMIT 1`,
                [clubId, newPresidentId, initiatedBy],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        let reason = 'Transfer approved by server owner';
        if (auditEntry) {
            try {
                const details = JSON.parse(auditEntry.details);
                reason = details.reason || reason;
            } catch (e) {
                // Use default reason
            }
        }

        const newPresident = await interaction.client.users.fetch(newPresidentId);

        if (action === 'approve') {
            // Execute the transfer
            await executeTransfer(interaction, club, newPresident, reason, initiatedBy, interaction.user.id);

            // Update the approval message
            const approvedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor('#00FF00')
                .setTitle('✅ Transfer Approved')
                .addFields({ name: '✅ Approved By', value: `${interaction.user.tag}`, inline: true });

            await interaction.editReply({ embeds: [approvedEmbed], components: [] });

            // Notify the initiator
            try {
                const initiator = await interaction.client.users.fetch(initiatedBy);
                await initiator.send({
                    content: `✅ Your request to transfer presidency of **${club.name}** to ${newPresident.tag} has been **approved** by the server owner and has been executed.`
                });
            } catch (dmError) {
                log('Could not DM initiator', 'club', null, dmError, 'warn');
            }

        } else {
            // Deny the transfer
            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT INTO club_audit_log (guild_id, club_id, action_type, performed_by, target_id, details) 
                     VALUES (?, ?, 'president_transfer_denied', ?, ?, ?)`,
                    [
                        interaction.guild.id,
                        clubId,
                        interaction.user.id,
                        newPresidentId,
                        JSON.stringify({ 
                            clubName: club.name,
                            initiatedBy,
                            reason: 'Denied by server owner'
                        })
                    ],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });

            // Update the approval message
            const deniedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor('#FF0000')
                .setTitle('❌ Transfer Denied')
                .addFields({ name: '❌ Denied By', value: `${interaction.user.tag}`, inline: true });

            await interaction.editReply({ embeds: [deniedEmbed], components: [] });

            // Notify the initiator
            try {
                const initiator = await interaction.client.users.fetch(initiatedBy);
                await initiator.send({
                    content: `❌ Your request to transfer presidency of **${club.name}** to ${newPresident.tag} has been **denied** by the server owner.`
                });
            } catch (dmError) {
                log('Could not DM initiator', 'club', null, dmError, 'warn');
            }
        }

    } catch (error) {
        log('Error handling transfer approval', 'club', null, error, 'error');
        await interaction.followUp({
            content: '❌ An error occurred while processing the approval.',
            ephemeral: true
        }).catch(() => {});
    }
}

/**
 * Autocomplete handler
 */
export async function autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused();
    const guildId = interaction.guild.id;
    const userId = interaction.user.id;

    try {
        // Check user role to determine which clubs to show
        const isOwner = interaction.guild.ownerId === userId;
        const isAdmin = isServerAdmin(interaction.member);
        const isMod = hasServerPrivilegedRole(interaction.member);

        let query, params;

        if (isOwner || isAdmin || isMod) {
            // Show all active clubs
            query = `SELECT id, name, slug FROM clubs WHERE guild_id = ? AND status = 'active' ORDER BY name ASC`;
            params = [guildId];
        } else {
            // Show only clubs where user is president
            query = `SELECT id, name, slug FROM clubs WHERE guild_id = ? AND president_user_id = ? AND status = 'active' ORDER BY name ASC`;
            params = [guildId, userId];
        }

        const clubs = await new Promise((resolve, reject) => {
            db.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        const filtered = clubs
            .filter(club => 
                club.name.toLowerCase().includes(focusedValue.toLowerCase()) ||
                club.slug.toLowerCase().includes(focusedValue.toLowerCase())
            )
            .slice(0, 25)
            .map(club => ({
                name: `${club.name} (${club.slug})`,
                value: club.slug
            }));

        if (filtered.length === 0) {
            filtered.push({
                name: '❌ No clubs found or no permission',
                value: 'no_clubs'
            });
        }

        await interaction.respond(filtered);
    } catch (error) {
        log('Error in transferpresident autocomplete', 'club', null, error, 'error');
        await interaction.respond([]);
    }
}