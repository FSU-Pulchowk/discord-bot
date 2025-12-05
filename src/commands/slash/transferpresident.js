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
    .addStringOption(option =>
        option.setName('new_president')
            .setDescription('New president (must be verified club member)')
            .setRequired(true)
            .setAutocomplete(true))
    .addStringOption(option =>
        option.setName('reason')
            .setDescription('Reason for transfer')
            .setRequired(true)
            .setMaxLength(500));

export async function execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const clubIdentifier = interaction.options.getString('club');
    const newPresidentId = interaction.options.getString('new_president');
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

        let newPresident;
        try {
            newPresident = await interaction.client.users.fetch(newPresidentId);
        } catch (error) {
            return await interaction.editReply({
                content: '❌ Could not find the specified user. Please try again.'
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
        
        const approvalEmbed = new EmbedBuilder()
            .setColor('#FFA500')
            .setTitle('🔄 Club Presidency Transfer - Approval Required')
            .setDescription(`A ${initiatorRole} has requested to transfer club presidency and requires your approval.`)
            .addFields(
                { name: '🛏️ Club', value: club.name, inline: true },
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
                { name: '🛏️ Club', value: club.name, inline: true },
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
        let modRole = club.moderator_role_id ? await guild.roles.fetch(club.moderator_role_id).catch(() => null) : null;

        if (!modRole && clubRole) {
            log('Moderator role missing during transfer, creating it now', 'club', { clubId: club.id, clubName: club.name });
            
            try {
                modRole = await guild.roles.create({
                    name: `${club.name} - Moderator`,
                    color: clubRole.color,
                    hoist: true,
                    mentionable: true,
                    reason: `Creating missing moderator role for presidency transfer of ${club.name}`
                });

                // Update database with new moderator role
                await new Promise((resolve, reject) => {
                    db.run(
                        `UPDATE clubs SET moderator_role_id = ?, updated_at = ? WHERE id = ?`,
                        [modRole.id, Date.now(), club.id],
                        (err) => {
                            if (err) reject(err);
                            else resolve();
                        }
                    );
                });

                log('Created moderator role successfully during transfer', 'club', { 
                    clubId: club.id, 
                    clubName: club.name, 
                    modRoleId: modRole.id 
                });

            } catch (createError) {
                log('Failed to create moderator role during transfer', 'club', { clubId: club.id }, createError, 'error');
                return await interaction.editReply({
                    content: '❌ Failed to create moderator role. Please contact an administrator.'
                });
            }
        }

        if (!clubRole) {
            return await interaction.editReply({
                content: '❌ Club role not found. Please contact an administrator.'
            });
        }

        if (!modRole) {
            return await interaction.editReply({
                content: '❌ Failed to create/find moderator role. Please contact an administrator.'
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
        if (newPresidentMember) {
            if (!newPresidentMember.roles.cache.has(clubRole.id)) {
                await newPresidentMember.roles.add(clubRole, 'Became club president');
            }
            if (!newPresidentMember.roles.cache.has(modRole.id)) {
                await newPresidentMember.roles.add(modRole, 'Became club president');
            }
        }

        // Keep old president as moderator (they keep the mod role)
        // If you want to remove their mod role, uncomment:
        // if (oldPresidentMember && oldPresidentMember.roles.cache.has(modRole.id)) {
        //     await oldPresidentMember.roles.remove(modRole, 'No longer president');
        // }

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
                { name: '🛏️ Club', value: club.name, inline: true },
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
                    { name: '🛏️ Club', value: club.name, inline: true },
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
                        { name: '🛏️ Club', value: club.name, inline: true },
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
    const focusedOption = interaction.options.getFocused(true);
    const focusedValue = focusedOption.value.toLowerCase();
    const guildId = interaction.guild.id;
    const userId = interaction.user.id;

    try {
        // Handle 'club' option autocomplete
        if (focusedOption.name === 'club') {
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

            // If no clubs found at all
            if (!clubs || clubs.length === 0) {
                await interaction.respond([
                    {
                        name: isOwner || isAdmin || isMod 
                            ? '❌ No active clubs found in this server'
                            : '❌ No clubs found where you are president',
                        value: 'no_clubs_found'
                    }
                ]);
                return;
            }

            // Filter clubs based on search input
            let filtered;
            
            if (!focusedValue || focusedValue.trim() === '') {
                filtered = clubs.slice(0, 25);
            } else {
                filtered = clubs.filter(club => {
                    const nameMatch = club.name.toLowerCase().includes(focusedValue);
                    const slugMatch = club.slug.toLowerCase().includes(focusedValue);
                    return nameMatch || slugMatch;
                });
            }

            // Take only first 25 results (Discord limit)
            const results = filtered.slice(0, 25).map(club => ({
                name: `${club.name} (${club.slug})`.substring(0, 100),
                value: club.slug
            }));

            // If no matches found after filtering
            if (results.length === 0) {
                await interaction.respond([
                    {
                        name: `❌ No clubs matching "${focusedValue}"`,
                        value: 'no_match'
                    }
                ]);
                return;
            }

            await interaction.respond(results);
            return;
        }

        // ✅ Handle 'new_president' option autocomplete - show only club members
        if (focusedOption.name === 'new_president') {
            // Get the selected club first
            const clubIdentifier = interaction.options.getString('club');
            
            if (!clubIdentifier || clubIdentifier === 'no_clubs_found' || clubIdentifier === 'no_match') {
                await interaction.respond([
                    {
                        name: '⚠️ Please select a club first',
                        value: 'select_club_first'
                    }
                ]);
                return;
            }

            // Get club details
            const club = await getClubByIdentifier(guildId, clubIdentifier);
            
            if (!club) {
                await interaction.respond([
                    {
                        name: '❌ Club not found',
                        value: 'club_not_found'
                    }
                ]);
                return;
            }

            // Get all active club members (excluding current president)
            const members = await new Promise((resolve, reject) => {
                db.all(
                    `SELECT cm.user_id, cm.role, vu.real_name
                     FROM club_members cm
                     LEFT JOIN verified_users vu ON cm.user_id = vu.user_id
                     WHERE cm.club_id = ? AND cm.status = 'active' AND cm.user_id != ?
                     ORDER BY 
                        CASE cm.role 
                            WHEN 'moderator' THEN 1
                            WHEN 'member' THEN 2
                            ELSE 3
                        END,
                        vu.real_name ASC`,
                    [club.id, club.president_user_id],
                    (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows || []);
                    }
                );
            });

            if (members.length === 0) {
                await interaction.respond([
                    {
                        name: '❌ No eligible members found in this club',
                        value: 'no_members'
                    }
                ]);
                return;
            }

            // Fetch Discord members to get usernames
            const memberOptions = [];
            
            for (const member of members.slice(0, 25)) { // Limit to 25 for Discord
                try {
                    const discordMember = await interaction.guild.members.fetch(member.user_id);
                    const roleEmoji = member.role === 'moderator' ? '🛡️ ' : '👤 ';
                    const displayName = member.real_name || discordMember.user.username;
                    
                    // Filter by search term
                    if (!focusedValue || 
                        displayName.toLowerCase().includes(focusedValue) ||
                        discordMember.user.username.toLowerCase().includes(focusedValue)) {
                        memberOptions.push({
                            name: `${roleEmoji}${displayName} (@${discordMember.user.username})`.substring(0, 100),
                            value: member.user_id
                        });
                    }
                } catch (error) {
                    // Skip members who can't be fetched
                    continue;
                }
            }

            if (memberOptions.length === 0) {
                await interaction.respond([
                    {
                        name: focusedValue 
                            ? `❌ No members matching "${focusedValue}"`
                            : '❌ No eligible members found',
                        value: 'no_match'
                    }
                ]);
                return;
            }

            await interaction.respond(memberOptions.slice(0, 25));
            return;
        }

        // Unknown option
        await interaction.respond([]);

    } catch (error) {
        log('Error in transferpresident autocomplete', 'club', { 
            userId, 
            guildId, 
            focusedOption: focusedOption?.name,
            focusedValue: focusedOption?.value 
        }, error, 'error');
        
        // Always respond, even on error
        try {
            await interaction.respond([
                {
                    name: '❌ Error loading data - please try again',
                    value: 'error'
                }
            ]);
        } catch (respondError) {
            log('Failed to respond to autocomplete after error', 'club', null, respondError, 'error');
        }
    }
}