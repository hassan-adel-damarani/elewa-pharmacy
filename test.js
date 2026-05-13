const axios = require('axios');
const https = require('https');
const qs = require('querystring');
const cheerio = require('cheerio');

async function search() {
  // Step 1: GET the page first
  const get = await axios.get('https://drugeye.pharorg.com/drugeyeapp/android-search/drugeye-android-live-go.aspx', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    timeout: 10000
  });

  const $1 = cheerio.load(get.data);
  const vs  = $1('#__VIEWSTATE').val();
  const vsg = $1('#__VIEWSTATEGENERATOR').val();
  const ev  = $1('#__EVENTVALIDATION').val();
  const cookies = get.headers['set-cookie'] || [];
  console.log('VIEWSTATE:', vs ? 'OK' : 'MISSING');

  // Step 2: POST with search
  const post = await axios.post(
    'https://drugeye.pharorg.com/drugeyeapp/android-search/drugeye-android-live-go.aspx?search=paracetamol',
    qs.stringify({ '__VIEWSTATE': vs, '__VIEWSTATEGENERATOR': vsg, '__EVENTVALIDATION': ev, 'ttt': 'paracetamol', 'b1': 'search' }),
    {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookies.join(';'),
        'Referer': 'https://drugeye.pharorg.com/drugeyeapp/android-search/drugeye-android-live-go.aspx'
      },
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      timeout: 15000
    }
  );

  const $2 = cheerio.load(post.data);
  const table = $2('#MyTable').html();
  console.log('Table:', table ? table.substring(0, 3000) : 'EMPTY');
}

search().catch(console.error);
