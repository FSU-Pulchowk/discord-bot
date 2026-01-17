// src/utils/clubButtonHandlers.js
import { 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle, 
    ActionRowBuilder,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle
} from 'discord.js';
import { db, getClubByIdentifier } from '../database.js';
import { log } from './debug.js';
import { checkClubPermission } from './clubPermissions.js';

/**
 * Handle "Join Club" button clicks
 */
export async function handleJoinClubButton(interaction) {
    const clubIdStr = interaction.customId.split('_')[2];
    const clubId = parseInt(clubIdStr);
    
    if (isNaN(clubId)) {
        log('Invalid club ID in join button', 'club', { customId: interaction.customId }, null, 'error');
        return await interaction.reply({
            content: '❌ Invalid club identifier. Please try again or contact an administrator.',
            ephemeral: true
        }).catch(() => {});
    }

    const PULCHOWKIAN_ROLE_ID = process.env.VERIFIED_ROLE_ID || 'YOUR_VERIFIED_ROLE_ID';

    try {
        if (!interaction.guild) {
            return await interaction.reply({
                content: '❌ This command can only be used in a server.',
                ephemeral: true
            });
        }

        // Check if user has @Pulchowkian role
        if (!interaction.member.roles.cache.has(PULCHOWKIAN_ROLE_ID)) {
            return await interaction.reply({
                content: '❌ Only verified @Pulchowkian members can join clubs. Please verify first using `/verify`!',
                ephemeral: true
            });
        }

        let club;
        try {
            club = await new Promise((resolve, reject) => {
                db.get(
                    `SELECT * FROM clubs WHERE id = ? AND status = 'active'`,
                    [clubId],
                    (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    }
                );
            });
        } catch (dbError) {
            log('Database error fetching club', 'club', { clubId }, dbError, 'error');
            return await interaction.reply({
                content: '❌ Database error. Please try again later.',
                ephemeral: true
            });
        }

        if (!club) {
            return await interaction.reply({
                content: '❌ This club is not currently active or does not exist.',
                ephemeral: true
            });
        }

        const existingMember = await new Promise((resolve, reject) => {
            db.get(
                `SELECT id FROM club_members WHERE club_id = ? AND user_id = ? AND status = 'active'`,
                [clubId, interaction.user.id],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (existingMember) {
            return await interaction.reply({
                content: '✅ You are already a member of this club!',
                ephemeral: true
            });
        }

        const pendingRequest = await new Promise((resolve, reject) => {
            db.get(
                `SELECT id FROM club_join_requests WHERE club_id = ? AND user_id = ? AND status = 'pending'`,
                [clubId, interaction.user.id],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (pendingRequest) {
            return await interaction.reply({
                content: '⏳ You already have a pending request for this club. Please wait for approval.',
                ephemeral: true
            });
        }

        // Check if club requires approval
        if (club.require_approval) {
            // ✅ FIX 4: Modal doesn't need defer - just show it
            const modal = new ModalBuilder()
                .setCustomId(`join_club_modal_${clubId}`)
                .setTitle(`Join ${club.name}`);

            const fullNameInput = new TextInputBuilder()
                .setCustomId('full_name')
                .setLabel('Your Full Name')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Enter your full name')
                .setRequired(true)
                .setMaxLength(100);

            const confirmationInput = new TextInputBuilder()
                .setCustomId('interest_confirmed')
                .setLabel('Confirm Interest (Type "YES")')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('YES')
                .setRequired(true)
                .setMaxLength(3)
                .setMinLength(3);

            const reasonInput = new TextInputBuilder()
                .setCustomId('reason')
                .setLabel('Why do you want to join this club?')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Share your motivation and interests...')
                .setRequired(true)
                .setMinLength(20)
                .setMaxLength(500);

            modal.addComponents(
                new ActionRowBuilder().addComponents(fullNameInput),
                new ActionRowBuilder().addComponents(confirmationInput),
                new ActionRowBuilder().addComponents(reasonInput)
            );

            await interaction.showModal(modal);
        } else {
            // Auto-approve join
            await autoApproveJoin(interaction, club, clubId);
        }

    } catch (error) {
        log('Error handling join club button:', 'club', { clubId }, error, 'error');
        
        // ✅ FIX 5: Better error response handling
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: '❌ An error occurred. Please try again later.',
                ephemeral: true
            }).catch(() => {});
        }
    }
}

/**
 * Auto-approve club join (for clubs without approval requirement)
 */
async function autoApproveJoin(interaction, club, clubId) {
    try {
        await interaction.deferReply({ ephemeral: true });

        // Check member capacity
        const memberCount = await new Promise((resolve, reject) => {
            db.get(
                `SELECT COUNT(*) as count FROM club_members WHERE club_id = ? AND status = 'active'`,
                [clubId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row?.count || 0);
                }
            );
        });

        if (club.max_members && memberCount >= club.max_members) {
            return await interaction.editReply({
                content: `❌ This club has reached its maximum capacity of ${club.max_members} members.`
            });
        }

        // Add to club members
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO club_members (club_id, user_id, guild_id, role, status) VALUES (?, ?, ?, 'member', 'active')`,
                [clubId, interaction.user.id, interaction.guild.id],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        // Assign club role
        if (club.role_id) {
            try {
                const role = await interaction.guild.roles.fetch(club.role_id);
                if (role) {
                    await interaction.member.roles.add(role, `Joined club: ${club.name}`);
                }
            } catch (roleError) {
                log('Failed to assign club role', 'club', { roleId: club.role_id }, roleError, 'warn');
            }
        }

        // Log action
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO club_audit_log (guild_id, club_id, action_type, performed_by, target_id, details) 
                 VALUES (?, ?, 'member_joined', ?, ?, ?)`,
                [
                    interaction.guild.id,
                    clubId,
                    interaction.user.id,
                    interaction.user.id,
                    JSON.stringify({ clubName: club.name, clubSlug: club.slug, autoApproved: true })
                ],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        // Send success message
        const successEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('🎉 Welcome to the Club!')
            .setDescription(`You've successfully joined **${club.name}**!`)
            .addFields(
                { name: '🏛️ Club', value: club.name, inline: true },
                { name: '🔗 Slug', value: `\`${club.slug}\``, inline: true },
                { name: '👥 Role', value: club.role_id ? `<@&${club.role_id}>` : 'N/A', inline: true }
            );

        if (club.channel_id) {
            successEmbed.addFields({ 
                name: '📢 Club Channel', 
                value: `Check out <#${club.channel_id}> for announcements and events!`,
                inline: false
            });
        }

        await interaction.editReply({ embeds: [successEmbed] });

        // Notify club channel
        if (club.channel_id) {
            try {
                const channel = await interaction.guild.channels.fetch(club.channel_id);
                const welcomeMsg = new EmbedBuilder()
                    .setColor('#5865F2')
                    .setDescription(`👋 Welcome ${interaction.user} to **${club.name}**!`)
                    .setTimestamp();

                await channel.send({ embeds: [welcomeMsg] });
            } catch (channelError) {
                log('Failed to send welcome message to club channel', 'club', { channelId: club.channel_id }, channelError, 'warn');
            }
        }

    } catch (error) {
        log('Error in auto-approve join', 'club', { clubId }, error, 'error');
        
        if (interaction.deferred) {
            await interaction.editReply({
                content: '❌ An error occurred while joining the club.'
            }).catch(() => {});
        }
    }
}

/**
 * Handle join club modal submission
 */
export async function handleJoinClubModal(interaction) {
    // ✅ CRITICAL: Defer IMMEDIATELY - modals expire in 3 seconds!
    try {
        await interaction.deferReply({ ephemeral: true });
    } catch (deferError) {
        // Interaction already expired before we could defer
        if (deferError.code === 10062 || deferError.message?.includes('Unknown interaction')) {
            log('Join club modal interaction expired before defer', 'club', { 
                customId: interaction.customId,
                userId: interaction.user.id 
            }, null, 'warn');
            return;
        }
        throw deferError;
    }

    // ✅ FIX 6: Validate clubId from modal customId
    const clubIdStr = interaction.customId.split('_')[3];
    const clubId = parseInt(clubIdStr);
    
    if (isNaN(clubId)) {
        return await interaction.editReply({
            content: '❌ Invalid club identifier.'
        });
    }

    // ✅ FIX: Get all modal field values with error handling
    let fullName, interestConfirmed, reason;
    
    try {
        fullName = interaction.fields.getTextInputValue('full_name');
        interestConfirmed = interaction.fields.getTextInputValue('interest_confirmed').toUpperCase();
        reason = interaction.fields.getTextInputValue('reason');
    } catch (fieldError) {
        log('Error reading modal fields', 'club', { clubId }, fieldError, 'error');
        return await interaction.editReply({
            content: '❌ Error reading form data. Please try again.'
        });
    }

    try {
        // Validate confirmation
        if (interestConfirmed !== 'YES') {
            return await interaction.editReply({
                content: '❌ You must type "YES" to confirm your interest in becoming a member.'
            });
        }

        // Get club details
        const club = await new Promise((resolve, reject) => {
            db.get(
                `SELECT c.*, 
                 (SELECT COUNT(*) FROM club_members WHERE club_id = c.id AND status = 'active') as member_count
                 FROM clubs c
                 WHERE c.id = ? AND c.status = 'active'`,
                [clubId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!club) {
            return await interaction.editReply({
                content: '❌ This club is not currently accepting members.'
            });
        }

        // Check member capacity
        if (club.max_members && club.member_count >= club.max_members) {
            return await interaction.editReply({
                content: `❌ This club has reached its maximum capacity of ${club.max_members} members.`
            });
        }

        // Get user email from verified_users
        const verifiedUser = await new Promise((resolve, reject) => {
            db.get(
                `SELECT email FROM verified_users WHERE user_id = ?`,
                [interaction.user.id],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        // Create join request
        const requestId = await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO club_join_requests (club_id, user_id, guild_id, full_name, email, interest_reason, status) 
                 VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
                [clubId, interaction.user.id, interaction.guild.id, fullName, verifiedUser?.email, reason],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });

        // Get club moderators
        const moderators = await new Promise((resolve, reject) => {
            db.all(
                `SELECT user_id FROM club_members 
                 WHERE club_id = ? AND role IN ('president', 'moderator') AND status = 'active'`,
                [clubId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        // Create notification embed
        const requestEmbed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('🆕 New Club Join Request')
            .setDescription(`Someone wants to join **${club.name}**`)
            .addFields(
                { name: '👤 User', value: `<@${interaction.user.id}>`, inline: true },
                { name: '📝 Full Name', value: fullName, inline: true },
                { name: '🆔 Request ID', value: requestId.toString(), inline: true },
                { name: '🔗 Club Slug', value: `\`${club.slug}\``, inline: true },
                { name: '💬 Reason', value: reason.length > 1000 ? reason.substring(0, 997) + '...' : reason }
            )
            .setThumbnail(interaction.user.displayAvatarURL())
            .setTimestamp()
            .setFooter({ text: 'Use buttons below to approve/reject' });

        const approveButton = new ButtonBuilder()
            .setCustomId(`approve_join_${requestId}`)
            .setLabel('Approve')
            .setStyle(ButtonStyle.Success)
            .setEmoji('✅');

        const rejectButton = new ButtonBuilder()
            .setCustomId(`reject_join_${requestId}`)
            .setLabel('Reject')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('❌');

        const row = new ActionRowBuilder().addComponents(approveButton, rejectButton);

        // Notify president and moderators
        for (const mod of moderators) {
            try {
                const modUser = await interaction.client.users.fetch(mod.user_id);
                await modUser.send({ embeds: [requestEmbed], components: [row] });
            } catch (err) {
                log(`Failed to notify moderator ${mod.user_id}`, 'club', null, err, 'warn');
            }
        }

        // Confirm to user
        const confirmEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('✅ Join Request Submitted')
            .setDescription(`Your request to join **${club.name}** has been sent to the club leadership.`)
            .addFields(
                { name: '📋 Request ID', value: requestId.toString(), inline: true },
                { name: '🏛️ Club', value: club.name, inline: true },
                { name: '🔗 Slug', value: `\`${club.slug}\``, inline: true },
                { name: '⏳ Next Steps', value: 
                    '• The club president/moderators will review your request\n' +
                    '• You\'ll receive a DM when your request is processed\n' +
                    '• This usually takes 24-48 hours'
                }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [confirmEmbed] });

        // Log action
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO club_audit_log (guild_id, club_id, action_type, performed_by, target_id, details) 
                 VALUES (?, ?, 'join_request_submitted', ?, ?, ?)`,
                [
                    interaction.guild.id,
                    clubId,
                    interaction.user.id,
                    requestId.toString(),
                    JSON.stringify({ clubId, clubName: club.name, clubSlug: club.slug, fullName, reason })
                ],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

    } catch (error) {
        log('Error handling join modal:', 'club', { clubId }, error, 'error');
        await interaction.editReply({
            content: '❌ An error occurred while processing your request.'
        }).catch(() => {});
    }
}

/**
 * Handle approve/reject join request buttons
 */
export async function handleJoinRequestResponse(interaction, action) {
    await interaction.deferUpdate();

    const requestId = parseInt(interaction.customId.split('_')[2]);

    if (isNaN(requestId)) {
        return await interaction.followUp({
            content: '❌ Invalid request ID.',
            ephemeral: true
        });
    }

    try {
        // Get request details
        const request = await new Promise((resolve, reject) => {
            db.get(
                `SELECT jr.*, c.name as club_name, c.slug as club_slug, c.role_id, c.guild_id, c.president_user_id
                 FROM club_join_requests jr
                 JOIN clubs c ON jr.club_id = c.id
                 WHERE jr.id = ?`,
                [requestId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!request) {
            return await interaction.followUp({
                content: '❌ Request not found.',
                ephemeral: true
            });
        }

        if (request.status !== 'pending') {
            return await interaction.followUp({
                content: `⚠️ This request has already been ${request.status}.`,
                ephemeral: true
            });
        }

        // ✅ FIX 7: Fetch guild if interaction is in DM
        const guild = interaction.guild || await interaction.client.guilds.fetch(request.guild_id);
        const member = guild.members.cache.get(interaction.user.id) || await guild.members.fetch(interaction.user.id);

        // Check permission - must be club president or moderator
        const permissionCheck = await checkClubPermission({
            member: member,
            clubId: request.club_id,
            action: 'moderate'
        });

        if (!permissionCheck.allowed) {
            return await interaction.followUp({
                content: `❌ You don't have permission to manage join requests for this club. (${permissionCheck.reason})`,
                ephemeral: true
            });
        }

        if (action === 'approve') {
            // Update request status
            await new Promise((resolve, reject) => {
                db.run(
                    `UPDATE club_join_requests SET status = 'approved', reviewed_by = ?, reviewed_at = ? WHERE id = ?`,
                    [interaction.user.id, Date.now(), requestId],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });

            // Add to club members
            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT INTO club_members (club_id, user_id, guild_id, role, status) VALUES (?, ?, ?, 'member', 'active')`,
                    [request.club_id, request.user_id, request.guild_id],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });

            // Assign club role
            const targetMember = await guild.members.fetch(request.user_id);
            
            if (request.role_id) {
                const role = await guild.roles.fetch(request.role_id);
                if (role) {
                    await targetMember.roles.add(role, `Approved to join ${request.club_name}`);
                }
            }

            // Update embed message
            const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor('#00FF00')
                .addFields({ name: '✅ Approved by', value: `<@${interaction.user.id}>`, inline: true });

            await interaction.editReply({ embeds: [updatedEmbed], components: [] });

            // Notify user
            const user = await interaction.client.users.fetch(request.user_id);
            const approvalEmbed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('🎉 Welcome to the Club!')
                .setDescription(`Your request to join **${request.club_name}** has been approved!`)
                .addFields(
                    { name: '🏛️ Club', value: request.club_name, inline: true },
                    { name: '🔗 Slug', value: `\`${request.club_slug}\``, inline: true },
                    { name: '✅ You now have access to:', value: 
                        `• Club role: ${request.role_id ? `<@&${request.role_id}>` : 'N/A'}\n` +
                        '• Club channels and events\n' +
                        '• Club announcements'
                    }
                )
                .setTimestamp();

            await user.send({ embeds: [approvalEmbed] }).catch(() => {});

            // Log action
            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT INTO club_audit_log (guild_id, club_id, action_type, performed_by, target_id, details) 
                     VALUES (?, ?, 'join_request_approved', ?, ?, ?)`,
                    [
                        request.guild_id,
                        request.club_id,
                        interaction.user.id,
                        request.user_id,
                        JSON.stringify({ 
                            requestId, 
                            clubName: request.club_name,
                            clubSlug: request.club_slug
                        })
                    ],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });

        } else if (action === 'reject') {
            // Update request status
            await new Promise((resolve, reject) => {
                db.run(
                    `UPDATE club_join_requests SET status = 'rejected', reviewed_by = ?, reviewed_at = ? WHERE id = ?`,
                    [interaction.user.id, Date.now(), requestId],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });

            // Update embed message
            const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor('#FF0000')
                .addFields({ name: '❌ Rejected by', value: `<@${interaction.user.id}>`, inline: true });

            await interaction.editReply({ embeds: [updatedEmbed], components: [] });

            // Notify user
            const user = await interaction.client.users.fetch(request.user_id);
            const rejectEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('❌ Join Request Not Approved')
                .setDescription(`Your request to join **${request.club_name}** was not approved at this time.`)
                .addFields(
                    { name: '💡 What you can do', value: 
                        '• You can submit a new request in the future\n' +
                        '• Feel free to join other clubs\n' +
                        '• Contact the club president for more information'
                    }
                );

            await user.send({ embeds: [rejectEmbed] }).catch(() => {});

            // Log action
            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT INTO club_audit_log (guild_id, club_id, action_type, performed_by, target_id, details) 
                     VALUES (?, ?, 'join_request_rejected', ?, ?, ?)`,
                    [
                        request.guild_id,
                        request.club_id,
                        interaction.user.id,
                        request.user_id,
                        JSON.stringify({ 
                            requestId, 
                            clubName: request.club_name,
                            clubSlug: request.club_slug
                        })
                    ],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
        }

    } catch (error) {
        log('Error handling join request response:', 'club', { requestId }, error, 'error');
        await interaction.followUp({
            content: '❌ An error occurred while processing the request.',
            ephemeral: true
        }).catch(() => {});
    }
}