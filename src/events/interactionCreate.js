// src/events/interactionCreate.js
import { log } from '../utils/debug.js';

// Import all handlers
import { handleClubApproval, handleClubRejection } from '../utils/clubApprovalHandlers.js';
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
    handleModalStep1 as handleRegisterStep1,
    handleVerifyButton,
    handleOTPVerification,
    handleModalStep2 as handleRegisterStep2,
    handleContinueRegistration,
    handleSkipAdditionalDetails
} from '../commands/slash/registerclub.js';
import {
    handleSimpleAnnouncementModal,
    handleEmbedAnnouncementModal
} from '../commands/slash/announce.js';
import {
    handleCreateEventModalStep1,
    handleCreateEventModalStep2,
    handleUploadPosterButton,
    handleSkipPosterButton
} from '../commands/slash/createEvent.js';
import { handleTransferApproval } from '../commands/slash/transferpresident.js';
import { handleButtonInteraction as handleVerifyStartButton } from '../commands/slash/verify.js';

export async function handleInteraction(interaction) {
    try {
        // Handle slash commands
        if (interaction.isCommand()) {
            const command = interaction.client.commands.get(interaction.commandName);
            if (!command) {
                log(`Unknown command: ${interaction.commandName}`, 'interaction', null, null, 'warn');
                return;
            }

            try {
                await command.execute(interaction);
            } catch (error) {
                log(`Error executing command: ${interaction.commandName}`, 'interaction', null, error, 'error');

                const errorMessage = {
                    content: '❌ There was an error executing this command!',
                    ephemeral: true
                };

                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply(errorMessage).catch(() => { });
                } else {
                    await interaction.reply(errorMessage).catch(() => { });
                }
            }
        }

        // Handle autocomplete
        else if (interaction.isAutocomplete()) {
            const command = interaction.client.commands.get(interaction.commandName);

            if (!command || !command.autocomplete) {
                log(`No autocomplete handler for: ${interaction.commandName}`, 'interaction', null, null, 'warn');
                return;
            }

            try {
                await command.autocomplete(interaction);
            } catch (error) {
                log(`Autocomplete error: ${interaction.commandName}`, 'interaction', null, error, 'error');
            }
        }

        // Handle modals
        else if (interaction.isModalSubmit()) {
            const customId = interaction.customId;

            try {
                // ✅ CRITICAL: Defer immediately to prevent timeout
                // Modal submissions have 3 second window!

                // Club registration modals
                if (customId === 'club_registration_modal_step1') {
                    await handleRegisterStep1(interaction);
                }
                else if (customId.startsWith('club_registration_modal_step2_')) {
                    await handleRegisterStep2(interaction);
                }
                else if (customId.startsWith('verify_otp_modal_')) {
                    await handleOTPVerification(interaction);
                }

                // ✅ FIX: Join club modals - handle BEFORE checking other patterns
                else if (customId.startsWith('join_club_modal_')) {
                    log('Processing join club modal', 'interaction', { customId, userId: interaction.user.id }, null, 'verbose');
                    await handleJoinClubModal(interaction);
                }

                // Event creation modals
                else if (customId.startsWith('create_event_modal_step1_')) {
                    await handleCreateEventModalStep1(interaction);
                }
                else if (customId === 'create_event_modal_step2') {
                    await handleCreateEventModalStep2(interaction);
                }

                // Announcement modals
                else if (customId.startsWith('announce_simple_')) {
                    await handleSimpleAnnouncementModal(interaction);
                }
                else if (customId.startsWith('announce_embed_')) {
                    await handleEmbedAnnouncementModal(interaction);
                }

                else {
                    log(`Unhandled modal: ${customId}`, 'interaction', null, null, 'warn');

                    // ✅ FIX: Don't let unhandled modals hang
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({
                            content: '⚠️ This form is not currently supported.',
                            ephemeral: true
                        }).catch(() => { });
                    }
                }
            } catch (error) {
                log(`Error handling modal: ${customId}`, 'interaction', null, error, 'error');

                // ✅ FIX: Better error handling for expired interactions
                if (error.code === 10062 || error.message?.includes('Unknown interaction')) {
                    log('Modal interaction expired (took >3s to process)', 'interaction', { customId }, null, 'warn');
                    return; // Can't respond to expired interaction
                }

                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: '❌ An error occurred while processing your submission.',
                        ephemeral: true
                    }).catch(() => { });
                } else {
                    await interaction.editReply({
                        content: '❌ An error occurred while processing your submission.'
                    }).catch(() => { });
                }
            }
        }

        // Handle buttons
        else if (interaction.isButton()) {
            const customId = interaction.customId;

            try {
                // Club approval buttons
                if (customId.startsWith('approve_club_')) {
                    await handleClubApproval(interaction);
                }
                else if (customId.startsWith('reject_club_')) {
                    await handleClubRejection(interaction);
                }

                // Event approval buttons
                else if (customId.startsWith('approve_event_')) {
                    await handleEventApproval(interaction);
                }
                else if (customId.startsWith('reject_event_')) {
                    await handleEventRejection(interaction);
                }

                // ✅ FIX: More specific join club button check
                // IMPORTANT: Check for 'join_club_' followed by numbers ONLY (not 'join_club_modal_')
                else if (customId.startsWith('join_club_') && !customId.includes('modal')) {
                    await handleJoinClubButton(interaction);
                }

                // Join request response buttons (approve/reject member requests)
                else if (customId.startsWith('approve_join_')) {
                    await handleJoinRequestResponse(interaction, 'approve');
                }
                else if (customId.startsWith('reject_join_')) {
                    await handleJoinRequestResponse(interaction, 'reject');
                }

                // Event participation buttons
                else if (customId.startsWith('join_event_')) {
                    await handleJoinEventButton(interaction);
                }
                else if (customId.startsWith('preview_participants_')) {
                    await handlePreviewParticipants(interaction);
                }

                // Email verification buttons (club registration)
                else if (customId.startsWith('verify_club_email_')) {
                    await handleVerifyButton(interaction);
                }

                // Continue registration button (after OTP verification)
                else if (customId.startsWith('continue_registration_')) {
                    await handleContinueRegistration(interaction);
                }

                // Skip additional details button
                else if (customId.startsWith('skip_additional_details_')) {
                    await handleSkipAdditionalDetails(interaction);
                }

                // Event poster upload buttons
                else if (customId === 'upload_event_poster') {
                    await handleUploadPosterButton(interaction);
                }
                else if (customId === 'skip_event_poster') {
                    await handleSkipPosterButton(interaction);
                }

                // Presidency transfer approval buttons
                else if (customId.startsWith('approve_transfer_')) {
                    await handleTransferApproval(interaction, 'approve');
                }
                else if (customId.startsWith('deny_transfer_')) {
                    await handleTransferApproval(interaction, 'deny');
                }

                // Verification buttons
                else if (customId.startsWith('verify_start_button_')) {
                    await handleVerifyStartButton(interaction);
                }

                else {
                    log(`Unhandled button: ${customId}`, 'interaction', null, null, 'warn');
                }
            } catch (error) {
                log(`Error handling button: ${customId}`, 'interaction', null, error, 'error');

                const errorMessage = {
                    content: '❌ An error occurred while processing your action.',
                    ephemeral: true
                };

                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp(errorMessage).catch(() => { });
                } else {
                    await interaction.reply(errorMessage).catch(() => { });
                }
            }
        }

        else if (interaction.isStringSelectMenu() || interaction.isRoleSelectMenu() || interaction.isChannelSelectMenu()) {
            log(`Unhandled select menu: ${interaction.customId}`, 'interaction', null, null, 'warn');
        }

    } catch (error) {
        log('Critical error in interaction handler', 'interaction', null, error, 'error');
    }
}