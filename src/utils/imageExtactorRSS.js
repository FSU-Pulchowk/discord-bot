import { fetchWithRetry } from '../services/scraper.js';
import { load } from 'cheerio';
import { log } from '../utils/debug.js';

/**
 * Returns the first non-empty value from an array.
 * @param {Array} arr The array to search.
 * @returns {*} The first non-empty value, or null.
 */
function firstNonEmpty(arr) {
    for (const val of arr) {
        if (val) return val;
    }
    return null;
}

/**
 * Extract the best image URL from an RSS/Atom item.
 * @param {object} item The rss-parser item (with your customFields).
 * @param {object} opts
 * @param {string} [opts.siteUrl] A base URL to resolve relative paths (feed or item link).
 * @param {boolean} [opts.verifyWithHEAD=true] Do a HEAD request to ensure URL is an image.
 * @param {boolean} [opts.scrapePageForOG=true] If no image found, fetch item.link and parse og/twitter meta.
 * @param {number} [opts.requestTimeoutMs=8000]
 * @returns {Promise<string|null>}
 */
export async function extractBestImage(item, opts = {}) {
    const {
        siteUrl,
        verifyWithHEAD = true,
        scrapePageForOG = true,
        requestTimeoutMs = 8000,
    } = opts;

    const base = firstNonEmpty([
        safeUrl(item.link),
        safeUrl(siteUrl),
        domainFromUrl(safeUrl(item.link)) || domainFromUrl(safeUrl(siteUrl)),
    ]);

    const candidates = [
        ...fromMedia(item),
        ...fromEnclosures(item),
        ...fromItunes(item),
        ...fromGenericFields(item),
    ]
        .map(u => absolutize(u, base))
        .filter(Boolean);

    if (!candidates.length) {
        const html = firstNonEmpty([
            item['content:encoded'],
            item.content,
            item.summary,
            item.description,
        ]);
        if (html) {
            candidates.push(...fromHtmlImgs(html, base));
        }
    }

    if (!candidates.length && scrapePageForOG && safeUrl(item.link)) {
        try {
            const pageHtml = await fetchText(item.link, requestTimeoutMs);
            const og = fromOG(pageHtml, item.link);
            if (og) candidates.push(og);
        } catch {
            /* ignore */
        }
    }

    if (!candidates.length && base) {
        const origin = originOf(base);
        if (origin) {
            candidates.push(`${origin}/favicon.png`, `${origin}/favicon.ico`);
        }
    }

    const unique = dedupeUrls(candidates.map(cleanImageUrl));
    const ranked = unique
        .map(u => ({ url: u, score: scoreImageUrl(u) }))
        .sort((a, b) => b.score - a.score);

    if (verifyWithHEAD) {
        for (const { url } of ranked) {
            if (await looksLikeImage(url, requestTimeoutMs)) return url;
        }
        return null;
    }

    return ranked.length ? ranked[0].url : null;
}

/**
 * Extracts image URLs from various media-related fields in the RSS item.
 * @param {object} item The RSS item.
 * @returns {string[]} An array of potential image URLs.
 */
function fromMedia(item) {
    const out = [];
    const mediaNodes = []
        .concat(normalizeNode(item.mediaContent))
        .concat(normalizeNode(item.mediaThumbnail))
        .concat(normalizeNode(item['media:content']))
        .concat(normalizeNode(item['media:thumbnail']))
        .concat(normalizeNode(item['media:group']));

    for (const m of mediaNodes) {
        if (!m) continue;
        const url = m.url || m['@_url'] || (m.$ && m.$.url) || m['#text'];
        if (url) out.push(url);
    }
    return out;
}

/**
 * Extracts image URLs from the `enclosure` field.
 * @param {object} item The RSS item.
 * @returns {string[]} An array of potential image URLs.
 */
function fromEnclosures(item) {
    const out = [];
    const encl = normalizeNode(item.enclosure || item.enclosures);
    for (const e of encl) {
        const url = e?.url || e?.href;
        const type = (e?.type || '').toLowerCase();
        if (url && (!type || type.startsWith('image/'))) out.push(url);
    }

    const links = normalizeNode(item.link);
    for (const l of links) {
        if (l?.rel === 'enclosure' && String(l?.type || '').startsWith('image/') && l?.href) {
            out.push(l.href);
        }
    }
    return out;
}

/**
 * Extracts image URLs from iTunes specific fields.
 * @param {object} item The RSS item.
 * @returns {string[]} An array of potential image URLs.
 */
function fromItunes(item) {
    const out = [];
    const iimg = item.itunes?.image || item['itunes:image'];
    if (typeof iimg === 'string') out.push(iimg);
    else if (iimg?.href) out.push(iimg.href);
    else if (iimg?.url) out.push(iimg.url);
    return out;
}

/**
 * Extracts image URLs from generic fields like 'image', 'thumbnail', etc.
 * @param {object} item The RSS item.
 * @returns {string[]} An array of potential image URLs.
 */
function fromGenericFields(item) {
    const out = [];
    for (const k of ['image', 'thumbnail', 'picture', 'cover']) {
        const v = item[k];
        if (!v) continue;
        if (typeof v === 'string') out.push(v);
        else if (v.url) out.push(v.url);
        else if (v.href) out.push(v.href);
    }
    return out;
}

/**
 * Extracts image URLs from `<img>` tags within the HTML content.
 * @param {string} html The HTML string.
 * @param {string} base The base URL to resolve relative paths.
 * @returns {string[]} An array of potential image URLs.
 */
function fromHtmlImgs(html, base) {
    const out = [];
    const $ = load(html);
    $('img').each((_, el) => {
        const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src');
        if (src) out.push(absolutize(src, base));
        const srcset = $(el).attr('srcset');
        if (srcset) {
            const largest = pickLargestFromSrcset(srcset, base);
            if (largest) out.push(largest);
        }
    });
    return out.filter(Boolean);
}

/**
 * Extracts Open Graph (og:image) and Twitter card image URLs from HTML.
 * @param {string} html The HTML string.
 * @param {string} pageUrl The page URL for resolving relative paths.
 * @returns {string|null} The best image URL found, or null.
 */
function fromOG(html, pageUrl) {
    const $ = load(html);
    const og = $('meta[property="og:image"]').attr('content') ||
        $('meta[name="og:image"]').attr('content') ||
        $('meta[name="twitter:image"]').attr('content') ||
        $('meta[name="twitter:image:src"]').attr('content');
    return og ? absolutize(og, pageUrl) : null;
}

/**
 * Picks the largest image URL from a `srcset` attribute.
 * @param {string} srcset The `srcset` string.
 * @param {string} base The base URL.
 * @returns {string|null} The largest image URL, or null.
 */
function pickLargestFromSrcset(srcset, base) {
    const entries = srcset.split(',').map(s => s.trim()).map(s => {
        const [url, size] = s.split(/\s+/);
        const n = parseInt((size || '').replace(/[^\d]/g, ''), 10);
        return { url: absolutize(url, base), size: isFinite(n) ? n : 0 };
    });
    entries.sort((a, b) => b.size - a.size);
    return entries[0]?.url || null;
}

/**
 * Normalizes a value to an array if it isn't already one.
 * @param {*} x The value to normalize.
 * @returns {Array} The normalized array.
 */
function normalizeNode(x) {
    if (!x) return [];
    return Array.isArray(x) ? x : [x];
}

/**
 * Safely creates a URL object from a string.
 * @param {string} u The URL string.
 * @returns {string|null} The URL string or null if invalid.
 */
function safeUrl(u) {
    try {
        return u ? new URL(u).toString() : null;
    } catch {
        return null;
    }
}

/**
 * Resolves a URL to an absolute path.
 * @param {string} u The URL string.
 * @param {string} base The base URL.
 * @returns {string|null} The absolute URL string or null if invalid.
 */
function absolutize(u, base) {
    if (!u) return null;
    try {
        return new URL(u, base || undefined).toString();
    } catch {
        return null;
    }
}

/**
 * Gets the domain origin from a URL.
 * @param {string} u The URL string.
 * @returns {string|null} The URL origin or null if invalid.
 */
function domainFromUrl(u) {
    try {
        return u ? new URL(u).origin : null;
    } catch {
        return null;
    }
}

/**
 * Gets the origin of a URL.
 * @param {string} u The URL string.
 * @returns {string|null} The URL origin or null if invalid.
 */
function originOf(u) {
    try {
        return new URL(u).origin;
    } catch {
        return null;
    }
}

/**
 * Cleans image URLs by removing tracking parameters.
 * @param {string} u The URL to clean.
 * @returns {string} The cleaned URL.
 */
function cleanImageUrl(u) {
    if (!u) return u;
    const drop = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
    try {
        const url = new URL(u);
        for (const k of drop) url.searchParams.delete(k);
        if (url.searchParams.get('format') && url.pathname.endsWith('.svg')) {
            // keep it
        } else {
            for (const k of ['cb', 'v', 'ver', 'version', 'ts', 't', '_']) url.searchParams.delete(k);
        }
        return url.toString();
    } catch {
        return u;
    }
}

/**
 * Removes duplicate URLs from an array.
 * @param {string[]} arr The array of URLs.
 * @returns {string[]} A new array with unique URLs.
 */
function dedupeUrls(arr) {
    const seen = new Set();
    const out = [];
    for (const u of arr) {
        if (u && !seen.has(u)) {
            seen.add(u);
            out.push(u);
        }
    }
    return out;
}

/**
 * Scores an image URL based on various keywords and characteristics.
 * @param {string} u The URL to score.
 * @returns {number} The score.
 */
function scoreImageUrl(u) {
    const s = u.toLowerCase();
    let score = 0;
    if (s.includes('og:image') || s.includes('twitter')) score += 30;
    if (s.includes('/wp-content/') || s.includes('/uploads/')) score += 8;
    if (s.includes('cdn')) score += 6;

    const sizeHints = s.match(/(\d{3,5})[xX](\d{3,5})/g) || [];
    for (const _ of sizeHints) score += 4;
    if (/\.(jpe?g|png|webp)(\?|$)/.test(s)) score += 12;
    if (/\.(gif)(\?|$)/.test(s)) score += 3; // often low quality
    if (/\.(svg)(\?|$)/.test(s)) score += 2; // logos, keep lower weight
    if (s.includes('sprite')) score -= 10;
    if (s.includes('icon')) score -= 6;

    if (s.startsWith('https://')) score += 2;

    return score;
}

/**
 * Performs a HEAD request to check if a URL points to an image.
 * @param {string} url The URL to check.
 * @param {number} timeoutMs The timeout in milliseconds.
 * @returns {Promise<boolean>} True if the URL is an image, false otherwise.
 */
async function looksLikeImage(url, timeoutMs) {
    try {
        const res = await fetchWithRetry(url, {
            method: 'HEAD',
            timeout: timeoutMs,
        });
        const contentType = res.headers?.get?.('content-type') || '';
        return contentType.startsWith('image/');
    } catch {
        return false;
    }
}

/**
 * Fetches text content from a URL.
 * @param {string} url The URL to fetch.
 * @param {number} timeoutMs The timeout in milliseconds.
 * @returns {Promise<string>} The fetched text.
 * @throws {Error} If the fetch response is not supported.
 */
async function fetchText(url, timeoutMs) {
    const res = await fetchWithRetry(url, { method: 'GET', timeout: timeoutMs });
    if (typeof res.text === 'function') return await res.text();
    if (typeof res === 'string') return res;
    if (res?.buffer) return res.buffer().then(b => b.toString('utf8'));
    throw new Error('Unsupported fetchWithRetry response');
}

/**
 * Attaches a best-guess image URL to each item in an array of feed items.
 * @param {Array<object>} items The array of feed items.
 * @param {object} opts Options for image extraction.
 * @returns {Promise<Array<object>>} The array of feed items with the `imageUrl` property added.
 */
export async function attachImagesToItems(items, { siteUrl, verifyWithHEAD, scrapePageForOG } = {}) {
    const out = [];
    for (const item of items) {
        const imageUrl = await extractBestImage(item, { siteUrl, verifyWithHEAD, scrapePageForOG });
        out.push({ ...item, imageUrl });
    }
    return out;
}