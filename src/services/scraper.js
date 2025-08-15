import axios from "axios";
import * as cheerio from "cheerio";
import { HttpProxyAgent } from "http-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import puppeteer from "puppeteer";
// Import the new logging system
import { log } from '../utils/debug.js';

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0"
];

/**
 * Fetches a URL with a retry mechanism, proxy support, and rotating user-agents.
 * Includes a Puppeteer fallback if initial Axios fetch fails or returns incomplete data.
 * @param {string} url - The URL to fetch.
 * @param {number} [retries=3] - The number of times to retry on Axios failure.
 * @param {number} [timeout=60000] - The timeout for each request in milliseconds.
 * @returns {Promise<string>} - The HTML data from the URL.
 */
export async function fetchWithRetry(url, retries = 3, timeout = 60000) {
    const proxyUrl = process.env.PROXY_URL;
    const randomUserAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
        // Use the new log function
        log(
            `[Axios Attempt ${attempt}/${retries}] Fetching ${url}` +
            (proxyUrl ? ` via proxy: ${proxyUrl}` : " directly"), 'info'
        );

        const axiosInstance = axios.create({
            timeout,
            headers: {
            "User-Agent": randomUserAgent,
            Accept:
                "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate",
            "Connection": "keep-alive"
            },
            httpAgent: proxyUrl ? new HttpProxyAgent(proxyUrl) : undefined,
            httpsAgent: proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined,
        });

        const { data } = await axiosInstance.get(url);

        if (!data || data.length < 500) {
            // Use the new log function
            log(`[Axios] Data for ${url} is too small or empty (${data ? data.length : 0} bytes). Triggering retry or Puppeteer fallback.`, 'warn');
            throw new Error("Incomplete or empty data from Axios.");
        }
        // Use the new log function
        log(`[Axios Success] Fetched ${url} with ${data.length} bytes.`, 'info');
        return data;
        } catch (err) {
        // Use the new log function
        log(
            `[Axios Attempt ${attempt}] Failed to fetch ${url}. Error: ${err.message}`, 'error'
        );
        if (err.response) {
            log(`[Axios] HTTP Status: ${err.response.status}, Response Data (first 200 chars): ${String(err.response.data).substring(0, 200)}`, 'error');
        } else if (err.request) {
            log(`[Axios] No response received. Request made but no data.`, 'error');
        } else {
            log(`[Axios] Error setting up request: ${err.message}`, 'error');
        }
        if (attempt === retries) {
            log(`[Axios] All attempts failed. Initiating Puppeteer fallback.`, 'warn');
            break;
        }
        }
    }

    try {
        // Use the new log function
        log(`[Puppeteer] Starting Puppeteer fallback for ${url}`, 'info');

        const browser = await puppeteer.launch({
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
            headless: "new"
        });
        const page = await browser.newPage();
        await page.setUserAgent(randomUserAgent);
        await page.goto(url, { waitUntil: "networkidle2", timeout });
        const htmlContent = await page.content();
        await browser.close();

        if (!htmlContent || htmlContent.length < 500) {
            log(`[Puppeteer] Data for ${url} is too small or empty (${htmlContent ? htmlContent.length : 0} bytes).`, 'warn');
            throw new Error("Incomplete or empty data from Puppeteer.");
        }

        log(`[Puppeteer Success] Fetched ${url} with ${htmlContent.length} bytes.`, 'info');
        return htmlContent;
    } catch (err) {
        log(`[Puppeteer] Failed to fetch ${url} via Puppeteer: ${err.message}`, 'error');
        throw new Error(`Failed to fetch ${url} after multiple attempts.`);
    }
}

/**
 * Scrapes IOE Exam notices from the official website.
 * @returns {Promise<Array<object>>} - A list of notice objects.
 */
export async function scrapeIoeExamNotice() {
    // Reverted URL and selectors to the previous working version
    const url = "http://exam.ioe.edu.np/";
    log(`[scrapeIoeExamNotice] Scraping ${url}`, 'info');
    try {
        const html = await fetchWithRetry(url);
        const $ = cheerio.load(html);
        const notices = [];

        $("#datatable tbody tr").each((_, el) => {
            const row = $(el);
            const titleElement = row.find("td:nth-child(2) a");
            const dateElement = row.find("td:nth-child(3)");
            const viewLinkElement = row.find(
                'td:nth-child(4) a[href*="/Notice/Index/"]'
            );
            const downloadLinkElement = row.find(
                'td:nth-child(4) a[target="_blank"]'
            );

            if (titleElement.length && dateElement.length && viewLinkElement.length && downloadLinkElement.length) {
                const title = titleElement.text().trim();
                const date = dateElement.text().trim();
                const noticePageLink = new URL(viewLinkElement.attr("href"), url).href;
                const pdfLink = new URL(downloadLinkElement.attr("href"), url).href;

                notices.push({
                    title,
                    link: noticePageLink,
                    attachments: [pdfLink],
                    date,
                    source: "IOE Exam Section",
                });
            }
        });
        log(`[scrapeIoeExamNotice] Scraped ${notices.length} notices.`, 'info');
        return notices;
    } catch (err) {
        log("[scrapeIoeExamNotice] Error during scraping or parsing:", 'error', null, err, 'error');
        return [];
    }
}


/**
 * Scrapes Pulchowk Campus notices. This is a more complex scraper that handles pagination and dynamic content.
 * @returns {Promise<Array<object>>} - A list of notice objects.
 */
export async function scrapePcampusNotice() {
    // Reverted URL and selectors to the previous working version
    const listUrl = "https://pcampus.edu.np/";
    log(`[scrapePcampusNotice] Scraping ${listUrl}`, 'info');

    try {
        const listData = await fetchWithRetry(listUrl);
        const $list = cheerio.load(listData);
        const noticeItems = $list("#recent-posts-2 ul li"); 
        if (noticeItems.length === 0) {
            log("[scrapePcampusNotice] Could not find any notices in the widget.", 'warn');
            return []; 
        }
        const noticeDetailPromises = [];
        noticeItems.each((_, el) => {
            const item = $list(el);
            const titleElement = item.find("a");
            const pageLink = titleElement.attr("href");
            const title = titleElement.text().trim();
            const date = item.find(".post-date").text().trim(); 
            if (pageLink) {
                const detailPromise = (async () => {
                    try {
                        const pageData = await fetchWithRetry(pageLink);
                        const $page = cheerio.load(pageData);
                        const attachments = [];
                        $page(".entry-content a").each((_, a) => {
                            const href = $page(a).attr("href");
                            if (href?.includes("/wp-content/uploads/")) {
                                attachments.push(new URL(href, pageLink).href);
                            }
                        });
                        return { title, link: pageLink, attachments: [...new Set(attachments)], date, source: "Pulchowk Campus" };
                    } catch (err) {
                        log(`[scrapePcampusNotice] Failed to fetch details for ${pageLink}. Error: ${err.message}`, 'error');
                        return null; 
                    }
                })();
                noticeDetailPromises.push(detailPromise);
            }
        });
        const results = await Promise.all(noticeDetailPromises);
        return results.filter(notice => notice !== null);
    } catch (err) {
        log("[scrapePcampusNotice] Error during scraping or parsing:", 'error', null, err, 'error');
        return []; 
    }
}


/**
 * Scrapes and combines the latest notices from all sources.
 * @returns {Promise<Array<object>>} - A combined list of notice objects.
 */
export async function scrapeLatestNotice() {
    log("Scraping latest notices from all sources...", 'info');
    const [ioe, pcampus] = await Promise.allSettled([
        scrapeIoeExamNotice(),
        scrapePcampusNotice(),
    ]);

    let combinedNotices = [];

    if (ioe.status === 'fulfilled' && ioe.value) {
        combinedNotices = [...combinedNotices, ...ioe.value];
    } else {
        log("[scrapeLatestNotice] IOE Exam Notice scraping failed:", 'error', null, ioe.reason, 'error');
    }

    if (pcampus.status === 'fulfilled' && pcampus.value) {
        combinedNotices = [...combinedNotices, ...pcampus.value];
    } else {
        log("[scrapeLatestNotice] Pulchowk Campus Notice scraping failed:", 'error', null, pcampus.reason, 'error');
    }

    return combinedNotices;
}