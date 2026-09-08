// src/services/ads/adManager.js
// High-level business logic and image-upload session management.

import path from 'path';
import { promises as fsP } from 'fs';
import axios from 'axios';
import * as repo from './adRepository.js';
import { filterEligibleAds, pickBestPresenceAd } from './adEligibility.js';

/**
 * Generate a unique advertisement ID in the format  AD-YYYYMMDD-XXXX
 * where XXXX is 4 random uppercase hex digits.
 */
export function generateAdId() {
    const d   = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const hex = Math.floor(Math.random() * 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
    return `AD-${ymd}-${hex}`;
}

/** Create a new ad; generates its ID automatically. */
export async function createAd(data) {
    return repo.createAd({ ...data, id: generateAdId() });
}

/** Partially update an existing ad (ID is never changed). */
export async function editAd(id, fields) {
    return repo.updateAd(id, fields);
}

/**
 * Soft-delete an ad and remove its local image from disk (if any).
 */
export async function deleteAd(id) {
    const ad = await repo.getAdById(id);
    if (ad?.image_url) {
        const fullPath = path.resolve(process.cwd(), ad.image_url);
        try {
            await fsP.unlink(fullPath);
            console.log(`[AdManager] Deleted image file: ${fullPath}`);
        } catch (err) {
            console.warn(`[AdManager] Could not delete image (${fullPath}): ${err.message}`);
        }
    }
    return repo.softDeleteAd(id);
}

/** Return the best eligible ad for a regular member to view. */
export async function getAdForMember(guildId, userId, channelId = null, roleIds = []) {
    const now  = Date.now();
    const ads  = await repo.getEligibleDmAds(now);
    const ctx  = { now, guildId, userId, channelId, roleIds };
    const best = pickBestPresenceAd(filterEligibleAds(ads, ctx));
    return best ?? null;
}

const IMAGE_DIR_REL = path.join('exports', 'ad-images');

/** Ensure exports/ad-images/ exists and return its absolute path. */
export async function ensureImageDir() {
    const dir = path.resolve(process.cwd(), IMAGE_DIR_REL);
    await fsP.mkdir(dir, { recursive: true });
    return dir;
}

const ALLOWED_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);

/**
 * Download an image from a Discord attachment URL and save it locally.
 *
 * @param {string} adId          – used as the file-name stem
 * @param {string} attachmentUrl – CDN URL from a Discord attachment
 * @returns {Promise<string>}    – relative path stored in the DB, e.g. "exports/ad-images/AD-….png"
 */
export async function saveAdImage(adId, attachmentUrl) {
    const dir = await ensureImageDir();

    // Derive extension from the URL (ignore query-string)
    const rawExt = attachmentUrl.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
    const ext    = ALLOWED_EXTS.has(rawExt) ? rawExt : 'png';

    const filename     = `${adId}.${ext}`;
    const absolutePath = path.join(dir, filename);
    const relativePath = path.join(IMAGE_DIR_REL, filename);

    const response = await axios.get(attachmentUrl, {
        responseType: 'arraybuffer',
        timeout: 15_000,
        maxContentLength: 8 * 1024 * 1024,
    });

    await fsP.writeFile(absolutePath, response.data);
    console.log(`[AdManager] Saved image → ${absolutePath}`);
    return relativePath;
}

/** @type {Map<string, { adId: string, timeout: NodeJS.Timeout, resolve: Function, reject: Function }>} */
const _sessions = new Map();

const SESSION_TTL_MS = 5 * 60 * 1000; 

/**
 * Start an image-upload DM session for a user.
 * Returns a Promise that resolves to:
 *   { skipped: true }
 *   { skipped: false, imagePath: string }
 *
 * The promise rejects if the user doesn't respond within 5 minutes.
 *
 * @param {string} userId
 * @param {string} adId
 * @returns {Promise<{ skipped: boolean, imagePath?: string }>}
 */
export function startImageUploadSession(userId, adId) {
    clearImageUploadSession(userId); // cancel any stale session

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            _sessions.delete(userId);
            reject(new Error('Image upload timed out — session expired after 5 minutes'));
        }, SESSION_TTL_MS);

        _sessions.set(userId, { adId, timeout, resolve, reject });
    });
}

/** Cancel an active upload session (e.g. after timeout or explicit skip). */
export function clearImageUploadSession(userId) {
    const s = _sessions.get(userId);
    if (s) {
        clearTimeout(s.timeout);
        _sessions.delete(userId);
    }
}

/** Returns true if the user has an active upload session. */
export function hasPendingImageSession(userId) {
    return _sessions.has(userId);
}

/**
 * Process a DM message from a user who may have a pending upload session.
 * Returns true if the message was consumed by a session (even if the session
 * continues waiting for a valid file), false if no session was active.
 *
 * @param {import('discord.js').Message} message
 * @returns {Promise<boolean>}
 */
export async function handleImageUploadMessage(message) {
    const session = _sessions.get(message.author.id);
    if (!session) return false;

    const { adId, timeout, resolve } = session;
    const content = message.content?.trim().toLowerCase() ?? '';

    if (content === 'skip') {
        clearTimeout(timeout);
        _sessions.delete(message.author.id);
        await message.reply('✅ Ad saved without an image.');
        resolve({ skipped: true });
        return true;
    }

    const attachment = message.attachments.first();
    if (!attachment) {
        await message.reply('⚠️ Please **attach an image file** to your message, or type `skip` to save the ad without one.');
        return true; 
    }

    if (attachment.size > 8 * 1024 * 1024) {
        await message.reply('❌ File exceeds the 8 MB limit. Please upload a smaller image or type `skip`.');
        return true;
    }

    const rawExt = attachment.name?.split('.').pop()?.toLowerCase() ?? '';
    if (!ALLOWED_EXTS.has(rawExt)) {
        await message.reply('❌ Only PNG, JPG, GIF, and WebP images are supported. Please try again or type `skip`.');
        return true;
    }

    try {
        const relativePath = await saveAdImage(adId, attachment.url);
        clearTimeout(timeout);
        _sessions.delete(message.author.id);
        await message.reply('✅ Image uploaded and saved successfully!');
        resolve({ skipped: false, imagePath: relativePath });
    } catch (err) {
        console.error('[AdManager] Failed to save uploaded image:', err);
        await message.reply(`❌ Failed to save the image: ${err.message}. Please try again or type \`skip\`.`);
    }

    return true;
}