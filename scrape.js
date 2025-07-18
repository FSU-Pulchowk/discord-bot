import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';

async function scrape() {
    const url = 'http://exam.ioe.edu.np/';
    try {
        const { data } = await axios.get(url, {
        headers: {
            'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        },
        });

        const $ = cheerio.load(data);
        const notices = [];

        $('#datatable tbody tr').each((_, el) => {
        const title = $(el).find('td:nth-child(2) a').text().trim();
        const date = $(el).find('td:nth-child(3)').text().trim();
        const link = new URL($(el).find('td:nth-child(2) a').attr('href'), url).href;
        const attachment = new URL($(el).find('td:nth-child(4) a').attr('href'), url).href;

        if (title && link && date) {
            notices.push({
            title,
            link,
            attachments: [attachment],
            date,
            source: 'IOE Exam Section',
            });
        }
        });

        fs.writeFileSync('notices.json', JSON.stringify(notices, null, 2));
        console.log('✅ Notices scraped and saved.');
    } catch (err) {
        console.error('❌ Failed to scrape:', err.message);
        process.exit(1);
    }
}

scrape();