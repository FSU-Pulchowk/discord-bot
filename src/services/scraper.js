// updated_scraper.js
import axios from 'axios';
import * as cheerio from 'cheerio';

export async function scrapeIoeExamNotice() {
    const url = 'http://exam.ioe.edu.np/';
    try {
        const axiosInstance = axios.create({
            timeout: 5000, // 5 seconds
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                'Accept': 'text/html,application/xhtml+xml'
            }
        });
        const { data } = await axiosInstance.get(url);
        const $ = cheerio.load(data);
        const notices = [];

        $('#datatable tbody tr').each((i, el) => {
            const titleElement = $(el).find('td:nth-child(2) a');
            const downloadLinkElement = $(el).find('td:nth-child(4) a[target="_blank"]');
            const dateElement = $(el).find('td:nth-child(3)');

            if (titleElement.length && downloadLinkElement.length && dateElement.length) {
                const title = titleElement.text().trim();
                const relativePdfLink = downloadLinkElement.attr('href');
                const pdfLink = new URL(relativePdfLink, url).href;
                const date = dateElement.text().trim();

                notices.push({
                    title,
                    link: new URL(titleElement.attr('href'), url).href,
                    attachments: [pdfLink],
                    date,
                    source: 'IOE Exam Section'
                });
            }
        });
        return notices;
    } catch (err) {
        console.error('[Scraper] IOE Error:', err);
        return [];
    }
}

export async function scrapePcampusNotice() {
    const listUrl = 'https://pcampus.edu.np/category/general-notices/';
    try {
        const axiosInstance = axios.create({
            timeout: 5000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                'Accept': 'text/html,application/xhtml+xml'
            }
        });
        const { data: listData } = await axiosInstance.get(listUrl);
        const $list = cheerio.load(listData);
        const latestArticle = $list('article').first();

        const title = latestArticle.find('h2.entry-title a').text().trim();
        const pageLink = latestArticle.find('h2.entry-title a').attr('href');
        const date = latestArticle.find('time.entry-date').attr('datetime');
        const postId = latestArticle.attr('id');

        const { data: pageData } = await axiosInstance.get(pageLink);
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
            source: 'Pulchowk Campus'
        };
    } catch (err) {
        console.error('[Scraper] Pulchowk Error:', err);
        return null;
    }
}

export async function scrapeLatestNotice() {
    const [ioe, pcampus] = await Promise.all([
        scrapeIoeExamNotice(),
        scrapePcampusNotice()
    ]);
    return [...(ioe || []), ...(pcampus ? [pcampus] : [])];
}