import axios from "axios";
import * as cheerio from "cheerio";
import { HttpProxyAgent } from "http-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import puppeteer from "puppeteer";

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
async function fetchWithRetry(url, retries = 3, timeout = 60000) {
    const proxyUrl = process.env.PROXY_URL;
    const randomUserAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
        console.log(
            `[Axios Attempt ${attempt}/${retries}] Fetching ${url}` +
            (proxyUrl ? ` via proxy: ${proxyUrl}` : " directly")
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
            console.warn(`[Axios] Data for ${url} is too small or empty (${data ? data.length : 0} bytes). Triggering retry or Puppeteer fallback.`);
            throw new Error("Incomplete or empty data from Axios.");
        }
        console.log(`[Axios Success] Fetched ${url} with ${data.length} bytes.`);
        return data;
        } catch (err) {
        console.error(
            `[Axios Attempt ${attempt}] Failed to fetch ${url}. Error: ${err.message}`
        );
        if (err.response) {
            console.error(`[Axios] HTTP Status: ${err.response.status}, Response Data (first 200 chars): ${String(err.response.data).substring(0, 200)}`);
        } else if (err.request) {
            console.error(`[Axios] No response received. Request made but no data.`);
        } else {
            console.error(`[Axios] Error setting up request: ${err.message}`);
        }

        if (attempt < retries) {
            const waitTime = 5000 * attempt;
            console.warn(`Retrying Axios in ${waitTime / 1000}s...`);
            await new Promise((r) => setTimeout(r, waitTime));
        }
        }
    }

    console.log(`[Puppeteer Fallback] Axios failed after ${retries} attempts for ${url}. Launching Puppeteer...`);
    let browser;
    try {
        browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-gpu',
            '--disable-dev-shm-usage',
            '--single-process',
            ...(proxyUrl ? [`--proxy-server=${proxyUrl}`] : []),
        ],
        ignoreHTTPSErrors: true,
        });

        const page = await browser.newPage();
        await page.setUserAgent(randomUserAgent);

        page.on('console', msg => console.log(`[Browser Console] ${msg.text()}`));
        page.on('pageerror', err => console.error(`[Browser Page Error] ${err.message}`));
        page.on('requestfailed', request => console.error(`[Browser Request Failed] ${request.url()} ${request.failure().errorText}`));

        await page.goto(url, { waitUntil: 'networkidle0', timeout: timeout * 3 });

        const htmlContent = await page.content();
        console.log(`[Puppeteer Success] Fetched ${url} with Puppeteer. Content length: ${htmlContent.length} bytes.`);
        return htmlContent;
    } catch (puppeteerErr) {
        console.error(`[Puppeteer Fallback] Failed to fetch ${url} with Puppeteer. Error: ${puppeteerErr.message}`);
        throw new Error(`Failed to fetch ${url} after Axios retries and Puppeteer fallback: ${puppeteerErr.message}`);
    } finally {
        if (browser) {
        await browser.close();
        }
    }
}

/**
 * Scrapes the latest notices from the IOE Examination Control Division website.
 * @returns {Promise<Array<object>>} - A list of notice objects.
 */
export async function scrapeIoeExamNotice() {
    const url = "http://exam.ioe.edu.np/";
    try {
        const data = await fetchWithRetry(url);
        const $ = cheerio.load(data);
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

        if (
            titleElement.length &&
            dateElement.length &&
            viewLinkElement.length &&
            downloadLinkElement.length
        ) {
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

        return notices;
    } catch (err) {
        console.error("[scrapeIoeExamNotice] Error during scraping or parsing:", err.message);
        return [];
    }
}

/**
 * Scrapes the latest notice from the Pulchowk Campus website.
 * @returns {Promise<object|null>} - A single notice object or null on failure.
 */
export async function scrapePcampusNotice() {
    const listUrl = "https://pcampus.edu.np/category/general-notices/";
    try {
        const listData = await fetchWithRetry(listUrl);
        const $list = cheerio.load(listData);
        const latestArticle = $list("article").first();
        const title = latestArticle.find("h2.entry-title a").text().trim();
        const pageLink = latestArticle.find("h2.entry-title a").attr("href");
        const date = latestArticle.find("time.entry-date").attr("datetime");
        const postId = latestArticle.attr("id");

        if (!pageLink) {
        console.warn("[scrapePcampusNotice] No page link found in latest article.");
        return null;
        }

        const pageData = await fetchWithRetry(pageLink);
        const $page = cheerio.load(pageData);
        const attachments = [];

        $page(".entry-content a").each((_, el) => {
        const href = $page(el).attr("href");
        if (href?.includes("/wp-content/uploads/")) {
            attachments.push(new URL(href, pageLink).href);
        }
        });

        return {
        id: postId,
        title,
        link: pageLink,
        attachments: [...new Set(attachments)],
        date,
        source: "Pulchowk Campus",
        };
    } catch (err) {
        console.error("[scrapePcampusNotice] Error during scraping or parsing:", err.message);
        return null;
    }
}

/**
 * Scrapes and combines the latest notices from all sources.
 * @returns {Promise<Array<object>>} - A combined list of notice objects.
 */
export async function scrapeLatestNotice() {
    console.log("Scraping latest notices from all sources...");
    const [ioe, pcampus] = await Promise.allSettled([
        scrapeIoeExamNotice(),
        scrapePcampusNotice(),
    ]);

    let combinedNotices = [];

    if (ioe.status === 'fulfilled' && ioe.value) {
        combinedNotices = [...combinedNotices, ...ioe.value];
    } else {
        console.error("[scrapeLatestNotice] IOE Exam Notice scraping failed:", ioe.reason);
    }

    if (pcampus.status === 'fulfilled' && pcampus.value) {
        combinedNotices = [...combinedNotices, pcampus.value];
    } else {
        console.error("[scrapeLatestNotice] Pulchowk Campus Notice scraping failed:", pcampus.reason);
    }

    return combinedNotices;
}