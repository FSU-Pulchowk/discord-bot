import axios from "axios";
import * as cheerio from "cheerio";
import { HttpProxyAgent } from "http-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import { log } from "../utils/debug.js";

const TU_BASE_URL   = "https://exam.ioe.tu.edu.np";
const TU_NOTICES_URL = `${TU_BASE_URL}/notices`;
const MAX_AGE_DAYS  = 15;

const USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0",
];

/**
 * Fetches a URL with a retry mechanism, proxy support, and rotating user-agents.
 * @param {string} url
 * @param {number} [retries=3]
 * @param {number} [timeout=60000]
 * @returns {Promise<string>}
 */
export async function fetchWithRetry(url, retries = 3, timeout = 60_000) {
    const proxyUrl = process.env.PROXY_URL;
    const randomUserAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            log(
                `[Axios Attempt ${attempt}/${retries}] Fetching ${url}` +
                (proxyUrl ? ` via proxy: ${proxyUrl}` : " directly"),
                "info"
            );

            const axiosInstance = axios.create({
                timeout,
                headers: {
                    "User-Agent": randomUserAgent,
                    Accept:
                        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Accept-Encoding": "gzip, deflate",
                    Connection: "keep-alive",
                },
                httpAgent:  proxyUrl ? new HttpProxyAgent(proxyUrl)  : undefined,
                httpsAgent: proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined,
            });

            const { data } = await axiosInstance.get(url);

            if (!data || data.length < 500) {
                log(`[Axios] Data for ${url} is too small (${data ? data.length : 0} bytes). Retrying.`, "warn");
                throw new Error("Incomplete or empty data from Axios.");
            }
            log(`[Axios Success] Fetched ${url} with ${data.length} bytes.`, "info");
            return data;

        } catch (err) {
            log(`[Axios Attempt ${attempt}] Failed to fetch ${url}. Error: ${err.message}`, "error");
            if (err.response) {
                log(`[Axios] HTTP Status: ${err.response.status}`, "error");
            }
            if (attempt === retries) {
                throw new Error(`Failed to fetch ${url} after ${retries} attempts.`);
            }
        }
    }
}

const BS_MONTHS_NP = [
    "बैशाख", "जेठ", "असार", "साउन", "भदौ", "असोज",
    "कार्तिक", "मंसिर", "पुष", "माघ", "फाल्गुन", "चैत",
];

// Approximate days per BS month (used only for the 15-day cutoff check)
const BS_MONTH_DAYS_AVG = [31, 31, 31, 32, 31, 30, 29, 30, 29, 30, 29, 30];

const NEPALI_DIGITS = "०१२३४५६७८९";

function nepaliDigitsToAscii(str) {
    return str
        .split("")
        .map((ch) => {
            const idx = NEPALI_DIGITS.indexOf(ch);
            return idx >= 0 ? String(idx) : ch;
        })
        .join("");
}

/**
 * Parse a Nepali date string like "१ जेठ २०८३" into an approximate JS Date.
 * Accuracy: ±1–2 days (sufficient to decide whether a notice is < 15 days old).
 * Returns null on parse failure.
 */
function parseNepaliDate(dateStr) {
    if (!dateStr) return null;
    const parts = dateStr.trim().split(/\s+/);
    if (parts.length < 3) return null;

    const day       = parseInt(nepaliDigitsToAscii(parts[0]), 10);
    const monthName = parts[1];
    const year      = parseInt(nepaliDigitsToAscii(parts[2]), 10);
    const monthIdx  = BS_MONTHS_NP.indexOf(monthName); // 0-based

    if (isNaN(day) || isNaN(year) || monthIdx === -1) return null;

    // BS 2000 Baisakh 1  ≈  AD 1943-04-14
    const adOrigin = new Date(1943, 3, 14);

    let daysElapsed = 0;
    for (let y = 2000; y < year; y++) daysElapsed += 365;
    for (let m = 0; m < monthIdx; m++) daysElapsed += BS_MONTH_DAYS_AVG[m];
    daysElapsed += day - 1;

    return new Date(adOrigin.getTime() + daysElapsed * 86_400_000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Cursor helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decode a Base64URL cursor string → object (or null).
 * Cursor format: {"created_at":"YYYY-MM-DD HH:MM:SS","_pointsToNextItems":true}
 */
function decodeCursor(cursorStr) {
    try {
        return JSON.parse(Buffer.from(cursorStr, "base64url").toString("utf8"));
    } catch {
        return null;
    }
}

/**
 * Parse one page of the TU exam notices list.
 * @returns {{ notices: Array, nextCursor: string|null }}
 */
function parseListPage(html) {
    const $ = cheerio.load(html);
    const notices = [];

    // Each card: div.recent-post-wrapper
    $(".recent-post-wrapper").each((_, el) => {
        const card       = $(el);
        const nepaliDate = card.find(".nep_date").text().trim();
        const linkEl     = card.find(".detail a");
        const title      = linkEl.find("h5").text().trim() || linkEl.text().trim();
        const href       = linkEl.attr("href");

        if (!title || !href) return;

        const link       = href.startsWith("http") ? href : `${TU_BASE_URL}${href}`;
        const parsedDate = parseNepaliDate(nepaliDate);

        notices.push({ title, link, nepaliDate, parsedDate });
    });

    // Extract "Next »" cursor
    let nextCursor = null;
    $(".pagination .page-item a[rel='next']").each((_, el) => {
        const href = $(el).attr("href") || "";
        const match = href.match(/[?&]cursor=([^&]+)/);
        if (match) nextCursor = decodeURIComponent(match[1]);
    });

    return { notices, nextCursor };
}

const FILE_EXT_RE = /\.(pdf|jpg|jpeg|png|gif|webp|docx?|xlsx?|pptx?|zip|rar)(\?.*)?$/i;

/**
 * Visit a notice detail page and return all attachment URLs.
 *
 * Extraction strategy (in priority order):
 * 1. `.ck-table a[href]`   – table-embedded links
 * 2. `.ck-content a[href]` – rich-text body links
 * 3. `p > a[href]`         – bare paragraph links (e.g. portal.tu.edu.np jpeg/pdf)
 * 4. Any `<a href>` ending with a known file extension
 * 5. Inline images (<img src="...">) embedded directly inside post tables, content canvas, or paragraphs.
 *
 * @param {string} url
 * @returns {Promise<{ attachments: string[] }>}
 */
async function scrapeDetailPage(url) {
    let html;
    try {
        html = await fetchWithRetry(url, 3, 45_000);
    } catch (err) {
        log(`[TU Scraper] Could not fetch detail page ${url}: ${err.message}`, "warn");
        return { attachments: [] };
    }

    const $ = cheerio.load(html);
    const seen        = new Set();
    const attachments = [];

    // Resolve absolute paths reliably against the actual page domain using the URL API
    function collect(rawPath) {
        if (!rawPath || rawPath.startsWith("#") || rawPath.startsWith("mailto:") || rawPath.startsWith("tel:")) return;
        try {
            const abs = new URL(rawPath, url).href;
            if (seen.has(abs)) return;

            const parsed = new URL(abs);
            const isKnownExtension = FILE_EXT_RE.test(parsed.pathname);

            // ── FIX: Apply an intelligent validation guard to skip non-attachment hyperlinks
            if (!isKnownExtension) {
                const domain = parsed.hostname.toLowerCase();
                const pathLower = parsed.pathname.toLowerCase();

                // Blacklist common external web domains, social networks, and credit networks
                const blacklistedDomains = [
                    'facebook.com', 'twitter.com', 'linkedin.com', 'instagram.com', 
                    'youtube.com', 'webdesignnepal.com', 'google.com', 't.me', 'telegram'
                ];
                if (blacklistedDomains.some(d => domain.includes(d))) {
                    return; // Ignore website credits and social sharing links
                }

                // If the link has no standard extension, only allow it if it resides on the target portals
                // OR has explicitly declared media/download folder structures
                const isTargetPortal = /ioe\.tu\.edu\.np|pcampus\.edu\.np|portal\.tu\.edu\.np/.test(domain);
                const isDownloadPath = /\/(downloads?|uploads?|medias?|attachments?|files?|documents?)\//i.test(pathLower);

                if (!isTargetPortal && !isDownloadPath) {
                    return; // Skip normal webpage hyperlinks
                }
            }

            seen.add(abs);
            attachments.push(abs);
        } catch (err) {
            log(`[TU Scraper] Skipping invalid URL path: ${rawPath}`, "warn");
        }
    }

    // 1 + 2: table cells and rich-text body anchors
    $(".ck-table a, .ck-content a").each((_, el) => collect($(el).attr("href")));

    // 3: bare paragraph links
    $("p > a").each((_, el) => collect($(el).attr("href")));

    // 4: any remaining anchor with a known file extension
    $("a[href]").each((_, el) => {
        const href = $(el).attr("href") || "";
        if (FILE_EXT_RE.test(href)) collect(href);
    });

    // 5: Inline images embedded directly inside post bodies (which might be the actual visual notice)
    $(".ck-content img, .ck-table img, p img").each((_, el) => {
        const src = $(el).attr("src") || "";
        if (src && FILE_EXT_RE.test(src)) {
            collect(src);
        }
    });

    return { attachments };
}

// ─────────────────────────────────────────────────────────────────────────────
// scrapeIoeTuExamNotice
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scrape the new IOE TU exam portal.
 * Walks cursor-based pages until all notices within the last 15 days have been collected.
 * @returns {Promise<Array<object>>}
 */
export async function scrapeIoeTuExamNotice() {
    log("[scrapeIoeTuExamNotice] Starting scrape of exam.ioe.tu.edu.np", "info");

    const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 86_400_000);
    const results = [];
    let pageUrl    = TU_NOTICES_URL;
    let pageNum    = 0;
    let keepPaging = true;

    while (keepPaging) {
        pageNum++;
        log(`[scrapeIoeTuExamNotice] Fetching list page ${pageNum}: ${pageUrl}`, "info");

        let html;
        try {
            html = await fetchWithRetry(pageUrl, 3, 60_000);
        } catch (err) {
            log(`[scrapeIoeTuExamNotice] Failed to fetch list page ${pageNum}: ${err.message}`, "error");
            break;
        }

        const { notices, nextCursor } = parseListPage(html);
        log(
            `[scrapeIoeTuExamNotice] Page ${pageNum}: ${notices.length} cards, nextCursor=${nextCursor ? "yes" : "none"}`,
            "info"
        );

        if (notices.length === 0) break;

        for (const notice of notices) {
            // Stop paging once we reach notices older than the cutoff
            if (notice.parsedDate && notice.parsedDate < cutoff) {
                log(
                    `[scrapeIoeTuExamNotice] "${notice.title}" (${notice.nepaliDate}) is older than ${MAX_AGE_DAYS} days – stopping`,
                    "info"
                );
                keepPaging = false;
                break;
            }

            // Fetch attachments from the detail page
            const { attachments } = await scrapeDetailPage(notice.link);
            log(`[scrapeIoeTuExamNotice] "${notice.title}": ${attachments.length} attachment(s)`, "info");

            results.push({
                title:       notice.title,
                link:        notice.link,
                nepaliDate:  notice.nepaliDate,
                date:        notice.parsedDate
                                 ? notice.parsedDate.toISOString().split("T")[0]
                                 : notice.nepaliDate,
                attachments,
                source:      "IOE TU Exam Section",
            });

            // Polite delay between detail requests
            await new Promise((r) => setTimeout(r, 600));
        }

        if (!keepPaging || !nextCursor) break;

        // Safety: don't follow a cursor that already points past the cutoff
        const cursorData = decodeCursor(nextCursor);
        if (cursorData?.created_at) {
            const cursorDate = new Date(cursorData.created_at);
            if (cursorDate < cutoff) {
                log("[scrapeIoeTuExamNotice] Cursor date is beyond cutoff – stopping", "info");
                break;
            }
        }

        pageUrl = `${TU_NOTICES_URL}?cursor=${encodeURIComponent(nextCursor)}`;
        await new Promise((r) => setTimeout(r, 1000)); // polite page delay
    }

    log(`[scrapeIoeTuExamNotice] Done – ${results.length} notice(s) within last ${MAX_AGE_DAYS} days.`, "info");
    return results;
}

/**
 * Scrapes Pulchowk Campus notices.
 * @returns {Promise<Array<object>>}
 */
export async function scrapePcampusNotice() {
    const listUrl = "http://pcampus.edu.np/";
    log(`[scrapePcampusNotice] Scraping ${listUrl}`, "info");

    try {
        const listData = await fetchWithRetry(listUrl);
        const $list    = cheerio.load(listData);
        const noticeItems = $list("#recent-posts-2 ul li");

        if (noticeItems.length === 0) {
            log("[scrapePcampusNotice] No notices found in widget.", "warn");
            return [];
        }

        const noticeDetailPromises = [];

        noticeItems.each((_, el) => {
            const item        = $list(el);
            const titleEl     = item.find("a");
            const pageLink    = titleEl.attr("href");
            const title       = titleEl.text().trim();
            const date        = item.find(".post-date").text().trim();

            if (!pageLink) return;

            const detailPromise = (async () => {
                try {
                    const pageData = await fetchWithRetry(pageLink);
                    const $page    = cheerio.load(pageData);
                    const attachments = [];

                    $page(".entry-content a").each((_, a) => {
                        const href = $page(a).attr("href");
                        if (href?.includes("/wp-content/uploads/")) {
                            attachments.push(new URL(href, pageLink).href);
                        }
                    });

                    return {
                        title,
                        link:        pageLink,
                        attachments: [...new Set(attachments)],
                        date,
                        source:      "Pulchowk Campus",
                    };
                } catch (err) {
                    log(`[scrapePcampusNotice] Failed detail fetch for ${pageLink}: ${err.message}`, "error");
                    return null;
                }
            })();

            noticeDetailPromises.push(detailPromise);
        });

        const results = await Promise.all(noticeDetailPromises);
        return results.filter(Boolean);

    } catch (err) {
        log("[scrapePcampusNotice] Error:", "error", null, err, "error");
        return [];
    }
}

/**
 * Scrape and combine the latest notices from all sources.
 * @returns {Promise<Array<object>>}
 */
export async function scrapeLatestNotice() {
    log("Scraping latest notices from all sources...", "info");

    const [tu, pcampus] = await Promise.allSettled([
        scrapeIoeTuExamNotice(),
        scrapePcampusNotice(),
    ]);

    let combined = [];

    if (tu.status === "fulfilled" && tu.value) {
        combined = [...combined, ...tu.value];
    } else {
        log("[scrapeLatestNotice] TU Exam Notice scraping failed:", "error", null, tu.reason, "error");
    }

    if (pcampus.status === "fulfilled" && pcampus.value) {
        combined = [...combined, ...pcampus.value];
    } else {
        log("[scrapeLatestNotice] Pulchowk Campus Notice scraping failed:", "error", null, pcampus.reason, "error");
    }

    return combined;
}