import axios from 'axios';
import * as cheerio from 'cheerio';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';

/**
 * Fetches a URL with a retry mechanism and proxy support.
 * @param {string} url - The URL to fetch.
 * @param {number} [retries=3] - The number of times to retry on failure.
 * @param {number} [timeout=30000] - The timeout for each request in milliseconds.
 * @returns {Promise<string>} - The HTML data from the URL.
 */
async function fetchWithRetry(url, retries = 3, timeout = 30000) {
  const proxyUrl = process.env.PROXY_URL;

  const httpAgent = proxyUrl ? new HttpProxyAgent(proxyUrl) : undefined;
  const httpsAgent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;

  const axiosInstance = axios.create({
    timeout,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    httpAgent,
    httpsAgent,
  });

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[Attempt ${attempt}] Fetching ${url}` + (proxyUrl ? ' via proxy' : ''));
      const { data } = await axiosInstance.get(url);
      return data;
    } catch (err) {
      if (err.code === 'ECONNABORTED' && attempt < retries) {
        console.warn(`[Retry ${attempt}] Timeout fetching ${url}, retrying...`);
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      } else {
        console.error(`[Scraper] Failed to fetch ${url} on attempt ${attempt}. Error:`, err.message);
        if (attempt >= retries) {
          throw err; 
        }
      }
    }
  }
  throw new Error(`Failed to fetch ${url} after ${retries} attempts.`);
}

/**
 * Scrapes the latest notices from the IOE Examination Control Division website.
 * @returns {Promise<Array<object>>} - A list of notice objects.
 */
export async function scrapeIoeExamNotice() {
  const url = 'http://exam.ioe.edu.np/';
  try {
    const data = await fetchWithRetry(url);
    const $ = cheerio.load(data);
    const notices = [];

    $('#datatable tbody tr').each((_, el) => {
      const row = $(el);
      const titleElement = row.find('td:nth-child(2) a');
      const dateElement = row.find('td:nth-child(3)');
      const viewLinkElement = row.find('td:nth-child(4) a[href*="/Notice/Index/"]');
      
      const downloadLinkElement = row.find('td:nth-child(4) a[target="_blank"]');

      if (titleElement.length && dateElement.length && viewLinkElement.length && downloadLinkElement.length) {
        const title = titleElement.text().trim();
        const date = dateElement.text().trim();
        const noticePageLink = new URL(viewLinkElement.attr('href'), url).href;
        const pdfLink = new URL(downloadLinkElement.attr('href'), url).href;
        notices.push({
          title,
          link: noticePageLink,
          attachments: [pdfLink], 
          date,
          source: 'IOE Exam Section',
        });
      }
    });

    return notices;
  } catch (err) {
    return [];
  }
}

/**
 * Scrapes the latest notice from the Pulchowk Campus website.
 * @returns {Promise<object|null>} - A single notice object or null on failure.
 */
export async function scrapePcampusNotice() {
  const listUrl = 'https://pcampus.edu.np/category/general-notices/';
  try {
    const listData = await fetchWithRetry(listUrl);
    const $list = cheerio.load(listData);
    const latestArticle = $list('article').first();

    const title = latestArticle.find('h2.entry-title a').text().trim();
    const pageLink = latestArticle.find('h2.entry-title a').attr('href');
    const date = latestArticle.find('time.entry-date').attr('datetime');
    const postId = latestArticle.attr('id');

    if (!pageLink) throw new Error('No page link found in latest article.');

    const pageData = await fetchWithRetry(pageLink);
    const $page = cheerio.load(pageData);
    const attachments = [];

    $page('.entry-content a').each((_, el) => {
      const href = $page(el).attr('href');
      if (href?.includes('/wp-content/uploads/')) {
        attachments.push(new URL(href, pageLink).href);
      }
    });

    return {
      id: postId,
      title,
      link: pageLink,
      attachments: [...new Set(attachments)],
      date,
      source: 'Pulchowk Campus',
    };
  } catch (err) {
    return null;
  }
}

/**
 * Scrapes and combines the latest notices from all sources.
 * @returns {Promise<Array<object>>} - A combined list of notice objects.
 */
export async function scrapeLatestNotice() {
  const [ioe, pcampus] = await Promise.all([
    scrapeIoeExamNotice(),
    scrapePcampusNotice(),
  ]);
  return [...(ioe || []), ...(pcampus ? [pcampus] : [])];
}
