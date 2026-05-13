const axios = require('axios');
const https = require('https');
const qs = require('querystring');
const cheerio = require('cheerio');

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

async function searchDrugEye(query) {
  try {
    // Step 1: GET page to get VIEWSTATE
    const get = await axios.get(
      'https://drugeye.pharorg.com/drugeyeapp/android-search/drugeye-android-live-go.aspx',
      {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        httpsAgent,
        timeout: 10000
      }
    );

    const $1 = cheerio.load(get.data);
    const vs  = $1('#__VIEWSTATE').val();
    const vsg = $1('#__VIEWSTATEGENERATOR').val();
    const ev  = $1('#__EVENTVALIDATION').val();
    const cookies = get.headers['set-cookie'] || [];

    // Step 2: POST with search query
    const post = await axios.post(
      `https://drugeye.pharorg.com/drugeyeapp/android-search/drugeye-android-live-go.aspx?search=${encodeURIComponent(query)}`,
      qs.stringify({
        '__VIEWSTATE': vs,
        '__VIEWSTATEGENERATOR': vsg,
        '__EVENTVALIDATION': ev,
        'ttt': query,
        'b1': 'search'
      }),
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

    // Step 3: Parse results
    const $2 = cheerio.load(post.data);
    const results = [];
    const rows = $2('#MyTable tr');
    let current = {};

    rows.each((i, row) => {
      const tds = $2(row).find('td');
      if (tds.length === 0) return;

      const firstTd = $2(tds[0]);
      const style = firstTd.attr('style') || '';

      // اسم الدواء (لون أزرق)
      if (style.includes('color:Blue')) {
        if (current.name) results.push(current);
        current = {
          name: firstTd.text().trim(),
          price: tds.length > 1 ? $2(tds[1]).text().trim() : null
        };
      }
      // الاسم العلمي (لون أسود)
      else if (style.includes('color:Black')) {
        current.generic = firstTd.text().trim();
      }
      // التصنيف (لون أخضر)
      else if (style.includes('color:Green')) {
        current.category = firstTd.text().trim();
      }
      // الشركة (لون بنفسجي)
      else if (style.includes('color:BlueViolet')) {
        current.company = firstTd.text().trim();
      }
    });

    if (current.name) results.push(current);
    return results;

  } catch (err) {
    console.error('DrugEye error:', err.message);
    return [];
  }
}

module.exports = { searchDrugEye };