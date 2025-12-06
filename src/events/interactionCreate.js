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
    handlePaymentProofUpload,
    handlePaymentVerification,
    handlePaymentRejection
} from '../utils/eventRegistration.js';
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
    handleModalSubmit as handleVerifyModalSubmit
} from '../commands/slash/verify.js';
import {
    handleCreateEventModalStep1,
    handleCreateEventModalStep2,
    handleContinueEventStep2,
    handleUploadPosterButton,
    handleSkipPosterButton
} from '../commands/slash/createEvent.js';
import { handleTransferApproval } from '../commands/slash/transferpresident.js';
import { handleButtonInteraction as handleVerifyStartButton } from '../commands/slash/verify.js';

export async function handleInteraction(interaction) {
    try {
        // Check if interaction is expired/invalid (happens after bot restart)
        const isExpired = await checkInteractionExpiry(interaction);
        if (isExpired) {
            return; // Silently ignore expired interactions
        }

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
                await handleCommandError(interaction, error);
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
                else if (customId === 'club_registration_modal_step2') {
                    await handleRegisterStep2(interaction);
                }
                else if (customId === 'otp_verification_modal' || customId.startsWith('verify_otp_modal_')) {
                    await handleOTPVerification(interaction);
                }

                // Event creation modals
                else if (customId.startsWith('create_event_modal_step1_')) {
                    await handleCreateEventModalStep1(interaction);
                }
                else if (customId.startsWith('create_event_modal_step2')) {
                    await handleCreateEventModalStep2(interaction);
                }

                // Announce modals
                else if (customId === 'simple_announcement_modal') {
                    await handleSimpleAnnouncementModal(interaction);
                }
                else if (customId === 'embed_announcement_modal') {
                    await handleEmbedAnnouncementModal(interaction);
                }

                // Verify modal
                else if (customId === 'verify_submission_modal') {
                    await handleVerifyModalSubmit(interaction);
                }

                else {
                    log(`Unhandled modal: ${customId}`, 'interaction', null, null, 'warn');
                }

            } catch (error) {
                await handleModalError(interaction, customId, error);
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

                // Event creation continuation button
                else if (customId.startsWith('continue_event_step2_')) {
                    await handleContinueEventStep2(interaction);
                }

                // Event poster upload buttons
                else if (customId === 'upload_event_poster') {
                    await handleUploadPosterButton(interaction);
                }
                else if (customId === 'skip_event_poster') {
                    await handleSkipPosterButton(interaction);
                }

                // Payment verification buttons
                else if (customId.startsWith('upload_payment_proof_')) {
                    await handlePaymentProofUpload(interaction);
                }
                else if (customId.startsWith('verify_payment_')) {
                    await handlePaymentVerification(interaction);
                }
                else if (customId.startsWith('reject_payment_')) {
                    await handlePaymentRejection(interaction);
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
                await handleButtonError(interaction, customId, error);
            }
        }

        else if (interaction.isStringSelectMenu() || interaction.isRoleSelectMenu() || interaction.isChannelSelectMenu()) {
            log(`Unhandled select menu: ${interaction.customId}`, 'interaction', null, null, 'warn');
        }

    } catch (error) {
        log('Critical error in interaction handler', 'interaction', null, error, 'error');
    }
}

/**
 * Check if interaction has expired (e.g., after bot restart)
 */
async function checkInteractionExpiry(interaction) {
    // Interactions are typically invalid if they're from before bot started
    // or the interaction token has expired (15 minutes from creation)
    try {
        // If bot was started recently and interaction is old, it's likely expired
        const botUptime = process.uptime() * 1000; // Convert to milliseconds
        const interactionAge = Date.now() - interaction.createdTimestamp;

        // If interaction is older than bot uptime, it's from before restart
        if (interactionAge > botUptime + 5000) { // 5s grace period
            log('Ignoring expired interaction from before bot restart', 'interaction', {
                customId: interaction.customId || interaction.commandName,
                age: Math.floor(interactionAge / 1000) + 's',
                uptime: Math.floor(botUptime / 1000) + 's'
            }, null, 'warn');
            return true;
        }

        return false;
    } catch (error) {
        // If we can't determine, assume it's not expired
        return false;
    }
}

/**
 * Handle command execution errors
 */
async function handleCommandError(interaction, error) {
    log(`Error executing command: ${interaction.commandName}`, 'interaction', null, error, 'error');

    const errorMessage = {
        content: '❌ There was an error executing this command!',
        ephemeral: true
    };

    try {
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(errorMessage);
        } else {
            await interaction.reply(errorMessage);
        }
    } catch (replyError) {
        // Silently fail if we can't send error message
    }
}

/**
 * Handle modal submission errors
 */
async function handleModalError(interaction, customId, error) {
    // Check for "Unknown interaction" error specifically
    if (error.message?.includes('Unknown interaction') || error.code === 10062) {
        log('Modal interaction expired (bot was likely restarted)', 'interaction', { customId }, null, 'warn');
        return; // Silently ignore - user will need to start fresh
    }

    log(`Error handling modal: ${customId}`, 'interaction', null, error, 'error');

    const errorMessage = {
        content: '❌ An error occurred while processing your submission. Please try again.',
        ephemeral: true
    };

    try {
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(errorMessage);
        } else {
            await interaction.reply(errorMessage);
        }
    } catch (replyError) {
        // Silently fail
    }
}

/**
 * Handle button interaction errors
 */
async function handleButtonError(interaction, customId, error) {
    // Check for "Unknown interaction" error specifically
    if (error.message?.includes('Unknown interaction') || error.code === 10062) {
        log('Button interaction expired (bot was likely restarted)', 'interaction', { customId }, null, 'warn');
        return; // Silently ignore - buttons from before restart won't work
    }

    log(`Error handling button: ${customId}`, 'interaction', null, error, 'error');

    const errorMessage = {
        content: '❌ An error occurred while processing your action. Please try again.',
        ephemeral: true
    };

    try {
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(errorMessage);
        } else {
            await interaction.reply(errorMessage);
        }
    } catch (replyError) {
        // Silently fail
    }
}