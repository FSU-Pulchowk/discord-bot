// src/events/interactionCreate.js

import { Events, MessageFlags, PermissionsBitField } from 'discord.js';
import { 
    handleJoinClubButton, 
    handleJoinClubModal, 
    handleJoinRequestResponse 
} from '../utils/clubButtonHandlers.js';
import {
    handleEventApproval,
    handleEventRejection,
    handleJoinEventButton,
    handlePreviewParticipants
} from '../utils/eventHandlers.js';
import {
    handleClubApproval,
    handleClubRejection
} from '../utils/clubApprovalHandlers.js';
import { handleCreateEventModal } from '../commands/slash/createEvent.js';
import { handleModalSubmit as handleRegisterClubModal } from '../commands/slash/registerclub.js';
import { handleAnnouncementModal } from '../commands/slash/announce.js';
import { handleTransferApproval } from '../commands/slash/transferpresident.js';
import { log } from '../utils/debug.js';

export const name = Events.InteractionCreate;

export async function execute(interaction) {
    // Handle slash commands
    if (interaction.isChatInputCommand()) {
        const command = interaction.client.commands.get(interaction.commandName);

        if (!command) {
            log(`No command matching ${interaction.commandName} was found.`, 'command', null, null, 'warn');
            return await safeReply(interaction, {
                content: '⚠️ Command not found. It might have been removed or is not properly deployed.',
                ephemeral: true
            });
        }

        try {
            await command.execute(interaction);
        } catch (error) {
            log(`Error executing ${interaction.commandName}`, 'command', null, error, 'error');
            
            // Don't try to reply if it was a modal error
            if (error.code === 40060 || error.message?.includes('modal')) {
                log(`Modal-related error in ${interaction.commandName}, likely already handled`, 'command', null, null, 'warn');
                return;
            }
            
            const errorMessage = {
                content: '❌ There was an error while executing this command!',
                flags: MessageFlags.Ephemeral
            };

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(errorMessage).catch(() => {});
            } else {
                await interaction.reply(errorMessage).catch(() => {});
            }
        }
    }

    // Handle button interactions
    else if (interaction.isButton()) {
        const customId = interaction.customId;

        try {
            // Club buttons
            if (customId.startsWith('join_club_')) {
                return await handleJoinClubButton(interaction);
            }
            if (customId.startsWith('approve_club_')) {
                return await handleClubApproval(interaction);
            }
            if (customId.startsWith('reject_club_')) {
                return await handleClubRejection(interaction);
            }
            if (customId.startsWith('approve_join_')) {
                return await handleJoinRequestResponse(interaction, 'approve');
            }
            if (customId.startsWith('reject_join_')) {
                return await handleJoinRequestResponse(interaction, 'reject');
            }
            
            // Event buttons
            if (customId.startsWith('approve_event_')) {
                return await handleEventApproval(interaction);
            }
            if (customId.startsWith('reject_event_')) {
                return await handleEventRejection(interaction);
            }
            if (customId.startsWith('join_event_')) {
                return await handleJoinEventButton(interaction);
            }
            if (customId.startsWith('preview_participants_')) {
                return await handlePreviewParticipants(interaction);
            }
            
            // Transfer presidency buttons (NEW)
            if (customId.startsWith('approve_transfer_')) {
                return await handleTransferApproval(interaction, 'approve');
            }
            if (customId.startsWith('deny_transfer_')) {
                return await handleTransferApproval(interaction, 'deny');
            }
            
            // Verification buttons
            if (customId.startsWith('verify_start_button_')) {
                const verifyCmd = interaction.client.commands.get('verify');
                if (verifyCmd && typeof verifyCmd.handleButtonInteraction === 'function') {
                    return await verifyCmd.handleButtonInteraction(interaction);
                }
            }
            if (customId.startsWith('confirm_otp_button_')) {
                const confirmOtpCmd = interaction.client.commands.get('confirmotp');
                if (confirmOtpCmd && typeof confirmOtpCmd.handleButtonInteraction === 'function') {
                    return await confirmOtpCmd.handleButtonInteraction(interaction);
                }
            }
            
            // Suggestion buttons
            if (customId === 'confirm_suggestion' || customId === 'cancel_suggestion') {
                return; // These are handled by the suggest command
            }
            if (customId.startsWith('suggest_vote_')) {
                return await safeReply(interaction, {
                    content: 'Your vote has been registered via reaction! Use 👍 or 👎 on the message itself.',
                    ephemeral: true
                });
            }
            if (customId.startsWith('delete_suggestion_')) {
                // Handle in modal
                return;
            }
            
            // GotVerified pagination
            if (customId.startsWith('gotverified_')) {
                if (!interaction.member?.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
                    return await safeReply(interaction, {
                        content: '⚠️ You do not have permission to view this list.',
                        ephemeral: true
                    });
                }
                
                await interaction.deferUpdate();
                
                const parts = customId.split('_');
                const action = parts[1];
                let currentPage = parseInt(parts[2], 10);
                const originalUserId = parts[3];

                if (interaction.user.id !== originalUserId) {
                    return await interaction.editReply({
                        content: '⚠️ You cannot control someone else\'s verification list.'
                    });
                }
                
                // Import and use the gotverified command's pagination
                const { renderGotVerifiedPage } = await import('../commands/slash/gotVerified.js');
                const db = interaction.client.db;
                
                const allRows = await new Promise((resolve, reject) => {
                    db.all(
                        `SELECT user_id, real_name, email FROM verified_users WHERE guild_id = ? ORDER BY real_name ASC`,
                        [interaction.guild.id],
                        (err, rows) => {
                            if (err) reject(err);
                            else resolve(rows || []);
                        }
                    );
                });
                
                if (action === 'next') currentPage++;
                if (action === 'prev') currentPage--;
                
                const pageData = await renderGotVerifiedPage(interaction, allRows, currentPage, originalUserId);
                return await interaction.editReply(pageData);
            }
            
            // Setup buttons
            if (customId.startsWith('confirm_setup_fsu_') || customId.startsWith('cancel_setup_fsu_')) {
                if (!interaction.member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
                    return await safeReply(interaction, {
                        content: 'You do not have permission to perform this action.',
                        ephemeral: true
                    });
                }

                const setupFSUCommand = interaction.client.commands.get('setupfsu');
                if (setupFSUCommand && typeof setupFSUCommand._performSetupLogic === 'function') {
                    if (customId.startsWith('confirm_setup_fsu_')) {
                        await interaction.update({
                            content: '🔧 Beginning FSU server setup...',
                            components: [],
                            embeds: []
                        });
                        return await setupFSUCommand._performSetupLogic(interaction);
                    } else {
                        return await interaction.update({
                            content: '❌ FSU server setup cancelled.',
                            components: [],
                            embeds: []
                        });
                    }
                }
            }
            
            // Warn buttons
            if (customId === 'confirm_warn' || customId === 'cancel_warn') {
                return; // Handled by warn command
            }
            
            // Unknown button - defer and inform user
            await interaction.deferUpdate().catch(() => {});
            await interaction.editReply({
                content: '⚠️ This button interaction is no longer available or has expired.',
                components: []
            }).catch(() => {});
            
        } catch (error) {
            log(`Error handling button ${customId}`, 'interaction', null, error, 'error');
            
            const errorMessage = {
                content: '❌ An error occurred while processing this action.',
                ephemeral: true
            };

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(errorMessage).catch(() => {});
            } else {
                await interaction.reply(errorMessage).catch(() => {});
            }
        }
    }

    // Handle modal submissions
    else if (interaction.isModalSubmit()) {
        const customId = interaction.customId;

        try {
            // Club modals
            if (customId.startsWith('join_club_modal_')) {
                return await handleJoinClubModal(interaction);
            }
            if (customId.startsWith('create_event_modal_')) {
                return await handleCreateEventModal(interaction);
            }
            if (customId === 'club_registration_modal') {
                return await handleRegisterClubModal(interaction);
            }
            if (customId.startsWith('announcement_modal_')) {
                return await handleAnnouncementModal(interaction);
            }
            
            // Verification modals
            if (customId === 'verifyModal') {
                const verifyCmd = interaction.client.commands.get('verify');
                if (verifyCmd && typeof verifyCmd.handleModalSubmit === 'function') {
                    return await verifyCmd.handleModalSubmit(interaction);
                }
            }
            if (customId === 'confirmOtpModal') {
                const confirmOtpCmd = interaction.client.commands.get('confirmotp');
                if (confirmOtpCmd && typeof confirmOtpCmd.handleModalSubmit === 'function') {
                    return await confirmOtpCmd.handleModalSubmit(interaction);
                }
            }
            
            // Suggestion modals
            if (customId.startsWith('deny_reason_modal_') || customId.startsWith('delete_reason_modal_')) {
                // These are handled by suggestion system in bot.js
                return;
            }
            
            // Unknown modal
            await safeReply(interaction, {
                content: '⚠️ This form submission is no longer valid.',
                ephemeral: true
            });
            
        } catch (error) {
            log(`Error handling modal ${customId}`, 'interaction', null, error, 'error');
            
            const errorMessage = {
                content: '❌ An error occurred while processing your submission.',
                ephemeral: true
            };

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(errorMessage).catch(() => {});
            } else {
                await interaction.reply(errorMessage).catch(() => {});
            }
        }
    }

    // Handle autocomplete
    else if (interaction.isAutocomplete()) {
        const command = interaction.client.commands.get(interaction.commandName);

        if (!command || !command.autocomplete) {
            return;
        }

        try {
            await command.autocomplete(interaction);
        } catch (error) {
            log(`Error in autocomplete for ${interaction.commandName}`, 'interaction', null, error, 'error');
        }
    }
}

/**
 * Safe reply helper
 */
async function safeReply(interaction, options) {
    const replyOptions = { ...options };
    if (replyOptions.ephemeral !== undefined) {
        replyOptions.flags = replyOptions.ephemeral ? MessageFlags.Ephemeral : undefined;
        delete replyOptions.ephemeral;
    }

    try {
        if (interaction.replied) {
            await interaction.followUp(replyOptions);
        } else if (interaction.deferred) {
            await interaction.editReply(replyOptions);
        } else {
            await interaction.reply(replyOptions);
        }
    } catch (error) {
        if (error.code !== 10062 && error.code !== 40060) {
            log('Failed to send interaction response', 'interaction', null, error, 'error');
        }
    }
}