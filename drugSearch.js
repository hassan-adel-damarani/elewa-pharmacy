const axios = require('axios');
const https = require('https');
const qs = require('querystring');
const cheerio = require('cheerio');

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

async function searchDrugEye(query) {
  try {
    const get = await axios.get(
      'https://drugeye.pharorg.com/drugeyeapp/android-search/drugeye-android-live-go.aspx',
      { headers: { 'User-Agent': 'Mozilla/5.0' }, httpsAgent, timeout: 10000 }
    );

    const $1 = cheerio.load(get.data);
    const vs  = $1('#__VIEWSTATE').val();
    const vsg = $1('#__VIEWSTATEGENERATOR').val();
    const ev  = $1('#__EVENTVALIDATION').val();
    const cookies = get.headers['set-cookie'] || [];

    const post = await axios.post(
      `https://drugeye.pharorg.com/drugeyeapp/android-search/drugeye-android-live-go.aspx?search=${encodeURIComponent(query)}`,
      qs.stringify({ '__VIEWSTATE': vs, '__VIEWSTATEGENERATOR': vsg, '__EVENTVALIDATION': ev, 'ttt': query, 'b1': 'search' }),
      {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': cookies.join(';'),
          'Referer': 'https://drugeye.pharorg.com/drugeyeapp/android-search/drugeye-android-live-go.aspx'
        },
        httpsAgent,
        timeout: 15000
      }
    );

    const $2 = cheerio.load(post.data);
    const results = [];
    let current = null;

    $2('#MyTable tr').each((i, row) => {
      const tds = $2(row).find('td');
      if (!tds.length) return;

      const firstTd = $2(tds[0]);
      const style = firstTd.attr('style') || '';
      const colspan = firstTd.attr('colspan') || '1';

      // اسم الدواء — أزرق + colspan=1
      if (style.includes('color:Blue') && tds.length > 1) {
        if (current) results.push(current);
        current = {
          name: firstTd.text().trim(),
          price: $2(tds[1]).text().trim(),
          generic: null,
          category: null,
          company: null
        };
      }
      // اسم علمي — أسود
      else if (style.includes('color:Black') && current) {
        current.generic = firstTd.text().trim();
      }
      // تصنيف — أخضر
      else if (style.includes('color:Green') && current) {
        current.category = firstTd.text().trim();
      }
      // شركة — بنفسجي
      else if (style.includes('color:BlueViolet') && current) {
        current.company = firstTd.text().trim();
      }
    });

    if (current) results.push(current);
    return results;

  } catch (err) {
    console.error('DrugEye error:', err.message);
    return [];
  }
}

module.exports = { searchDrugEye };