const axios = require('axios');
const https = require('https');
const qs = require('querystring');
const cheerio = require('cheerio');

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// صور افتراضية للأدوية الشائعة
const DRUG_IMAGES = {
  'paracetamol': 'https://www.drugs.com/images/pills/fio/paracetamol-500mg-1.jpg',
  'ibuprofen': 'https://www.drugs.com/images/pills/mmx/ibuprofen-200-mg-1.jpg',
  'amoxicillin': 'https://www.drugs.com/images/pills/mmx/amoxicillin-500-mg-1.jpg',
  'augmentin': 'https://www.drugs.com/images/pills/mmx/augmentin-875-125-mg-1.jpg',
  'cetirizine': 'https://www.drugs.com/images/pills/mmx/cetirizine-10-mg-1.jpg',
  'loratadine': 'https://www.drugs.com/images/pills/mmx/loratadine-10-mg-1.jpg',
  'aspirin': 'https://www.drugs.com/images/pills/mmx/aspirin-325-mg-1.jpg',
  'panadol': 'https://www.drugs.com/images/pills/fio/paracetamol-500mg-1.jpg',
  'brufen': 'https://www.drugs.com/images/pills/mmx/ibuprofen-400-mg-1.jpg',
  'advil': 'https://www.drugs.com/images/pills/mmx/ibuprofen-200-mg-1.jpg',
  'voltaren': 'https://www.drugs.com/images/pills/mmx/diclofenac-50-mg-1.jpg',
  'flagyl': 'https://www.drugs.com/images/pills/mmx/metronidazole-500-mg-1.jpg',
  'zithromax': 'https://www.drugs.com/images/pills/mmx/azithromycin-250-mg-1.jpg',
  'klaricid': 'https://www.drugs.com/images/pills/mmx/clarithromycin-500-mg-1.jpg',
  'augmentin': 'https://www.drugs.com/images/pills/mmx/augmentin-875-125-mg-1.jpg',
  'omnicef': 'https://www.drugs.com/images/pills/mmx/cefdinir-300-mg-1.jpg',
  'suprax': 'https://www.drugs.com/images/pills/mmx/cefixime-400-mg-1.jpg',
  'cipro': 'https://www.drugs.com/images/pills/mmx/ciprofloxacin-500-mg-1.jpg',
  'levaquin': 'https://www.drugs.com/images/pills/mmx/levofloxacin-500-mg-1.jpg',
  'avelox': 'https://www.drugs.com/images/pills/mmx/moxifloxacin-400-mg-1.jpg',
  'zyvox': 'https://www.drugs.com/images/pills/mmx/linezolid-600-mg-1.jpg',
  'vibramycin': 'https://www.drugs.com/images/pills/mmx/doxycycline-100-mg-1.jpg',
  'sumycin': 'https://www.drugs.com/images/pills/mmx/tetracycline-500-mg-1.jpg',
  'keflex': 'https://www.drugs.com/images/pills/mmx/cephalexin-500-mg-1.jpg',
  'duricef': 'https://www.drugs.com/images/pills/mmx/cefadroxil-500-mg-1.jpg',
  'ceftin': 'https://www.drugs.com/images/pills/mmx/cefuroxime-500-mg-1.jpg',
  'rocephin': 'https://www.drugs.com/images/pills/mmx/ceftriaxone-1-g-1.jpg',
  'fortaz': 'https://www.drugs.com/images/pills/mmx/ceftazidime-1-g-1.jpg',
  'maxipime': 'https://www.drugs.com/images/pills/mmx/cefepime-1-g-1.jpg',
  'primaxin': 'https://www.drugs.com/images/pills/mmx/imipenem-cilastatin-500-mg-1.jpg',
  'merrem': 'https://www.drugs.com/images/pills/mmx/meropenem-1-g-1.jpg',
  'invanz': 'https://www.drugs.com/images/pills/mmx/ertapenem-1-g-1.jpg',
  'zosyn': 'https://www.drugs.com/images/pills/mmx/piperacillin-tazobactam-3-375-g-1.jpg',
  'timentin': 'https://www.drugs.com/images/pills/mmx/ticarcillin-clavulanate-3-1-g-1.jpg',
  'unasyn': 'https://www.drugs.com/images/pills/mmx/ampicillin-sulbactam-1-5-g-1.jpg',
  'augmentin': 'https://www.drugs.com/images/pills/mmx/augmentin-875-125-mg-1.jpg',
};

function getDrugImage(drugName) {
  const name = drugName.toLowerCase();
  for (const [key, url] of Object.entries(DRUG_IMAGES)) {
    if (name.includes(key)) return url;
  }
  return `https://placehold.co/300x300/e2e8f0/64748b?text=${encodeURIComponent(drugName)}`;
}

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

      if (style.includes('color:Blue') && tds.length > 1) {
        if (current) results.push(current);
        
        const drugName = firstTd.text().trim();
        current = {
          name: drugName,
          name_ar: null,
          price: $2(tds[1]).text().trim(),
          generic: null,
          category: null,
          company: null,
          image: getDrugImage(drugName),
          description: null,
          symptoms: []
        };
      }
      else if (style.includes('color:Black') && current) {
        current.generic = firstTd.text().trim();
      }
      else if (style.includes('color:Green') && current) {
        current.category = firstTd.text().trim();
      }
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