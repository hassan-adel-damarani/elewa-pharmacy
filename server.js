const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const db = new Database('./pharmacy.db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'elewa-pharmacy-2024';

// ===== Gemini API Key — ضع الـ key بتاعك هنا =====
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'YOUR_GEMINI_KEY_HERE';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

// ===== DATABASE SETUP =====
db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, name_en TEXT, icon TEXT DEFAULT 'fa-pills'
  );
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, category_id INTEGER, price REAL NOT NULL,
    old_price REAL, description TEXT, image TEXT,
    stock TEXT DEFAULT 'in', badge TEXT, featured INTEGER DEFAULT 0,
    drug_eye_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL, description TEXT, discount INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL, password TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT, customer_phone TEXT, notes TEXT,
    status TEXT DEFAULT 'pending', created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS site_settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Default data
const insertCat = db.prepare(`INSERT OR IGNORE INTO categories (id,name,name_en,icon) VALUES (?,?,?,?)`);
[[1,'أدوية','Medicines','fa-pills'],[2,'شراب','Syrups','fa-tint'],[3,'أقراص','Tablets','fa-circle'],
 [4,'حقن','Injections','fa-syringe'],[5,'قطرات','Drops','fa-eye-dropper'],[6,'تجميل','Cosmetics','fa-spa']]
.forEach(r => insertCat.run(...r));

const hash = bcrypt.hashSync('admin123', 10);
db.prepare(`INSERT OR IGNORE INTO admins (username,password) VALUES (?,?)`).run('admin', hash);

// Default site settings
const insertSetting = db.prepare(`INSERT OR IGNORE INTO site_settings (key,value) VALUES (?,?)`);
[
  ['pharmacy_name', 'صيدلية عليوة'],
  ['pharmacy_name_en', 'Elewa Pharmacy'],
  ['phone', '+20 123 456 7890'],
  ['whatsapp', '201026354290'],
  ['facebook', 'https://www.facebook.com/share/1ELkoj5dxn/'],
  ['address', 'شارع الجمهورية، القاهرة، مصر'],
  ['hours', 'مفتوح 24 ساعة'],
  ['hero_title', 'صحتك تهمنا'],
  ['hero_subtitle', 'في صيدلية عليوة'],
  ['hero_desc', 'نقدم لك أفضل الأدوية والمستحضرات الطبية بأسعار منافسة.'],
  ['footer_desc', 'نهدف إلى تقديم أفضل الخدمات الصحية والمنتجات الطبية بجودة عالية وأسعار منافسة.'],
  ['gemini_key', ''],
].forEach(([k,v]) => insertSetting.run(k, v));

// Default products
const insertProd = db.prepare(`INSERT OR IGNORE INTO products (id,name,category_id,price,old_price,description,stock,badge) VALUES (?,?,?,?,?,?,?,?)`);
[
  [1,'باراسيتامول 500mg',3,12,null,'مسكن للألم وخافض للحرارة','in',null],
  [2,'أموكسيسيلين 250mg',1,35,45,'مضاد حيوي واسع الطيف','in','sale'],
  [3,'شراب فيتامين C',2,28,38,'شراب مقوي للمناعة','in','sale'],
  [4,'قطرة أنف أوتريفين',5,19,null,'قطرة لفتح الاحتقان','in',null],
  [5,'كريم نيفيا',6,45,60,'كريم مرطب للبشرة','in','sale'],
  [6,'بروفين 400mg',3,18,null,'مضاد للالتهابات ومسكن','in',null],
].forEach(r => insertProd.run(...r));

// ===== AUTH =====
const auth = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
};

// ===== UPLOAD =====
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// ===== EXCEL UPLOAD =====
const xlsxUpload = multer({ dest: 'uploads/tmp/' });

// ===== ROUTES =====

// Login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const admin = db.prepare('SELECT * FROM admins WHERE username=?').get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password))
    return res.status(401).json({ error: 'بيانات خاطئة' });
  const token = jwt.sign({ id: admin.id }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token });
});

// Change credentials
app.put('/api/admin/credentials', auth, (req, res) => {
  const { username, old_password, new_password } = req.body;
  const admin = db.prepare('SELECT * FROM admins WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(old_password, admin.password))
    return res.status(401).json({ error: 'كلمة المرور القديمة غير صحيحة' });
  const hashed = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE admins SET username=?, password=? WHERE id=?').run(username || admin.username, hashed, req.user.id);
  res.json({ success: true });
});

// Categories
app.get('/api/categories', (req, res) => {
  res.json(db.prepare('SELECT * FROM categories').all());
});

// Products
app.get('/api/products', (req, res) => {
  const { category, search } = req.query;
  let sql = `SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id=c.id WHERE 1=1`;
  const params = [];
  if (category && category !== 'all') { sql += ' AND p.category_id=?'; params.push(category); }
  if (search) { sql += ' AND p.name LIKE ?'; params.push(`%${search}%`); }
  sql += ' ORDER BY p.created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

app.get('/api/products/:id', (req, res) => {
  const row = db.prepare(`SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id=c.id WHERE p.id=?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

app.post('/api/products', auth, upload.single('image'), (req, res) => {
  const { name, category_id, price, old_price, description, stock, badge } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : null;
  const result = db.prepare(`INSERT INTO products (name,category_id,price,old_price,description,image,stock,badge) VALUES (?,?,?,?,?,?,?,?)`)
    .run(name, category_id, price, old_price || null, description, image, stock || 'in', badge || null);
  res.json({ id: result.lastInsertRowid });
});

app.put('/api/products/:id', auth, upload.single('image'), (req, res) => {
  const { name, category_id, price, old_price, description, stock, badge } = req.body;
  const row = db.prepare('SELECT image FROM products WHERE id=?').get(req.params.id);
  const image = req.file ? `/uploads/${req.file.filename}` : row?.image;
  db.prepare(`UPDATE products SET name=?,category_id=?,price=?,old_price=?,description=?,image=?,stock=?,badge=? WHERE id=?`)
    .run(name, category_id, price, old_price || null, description, image, stock, badge, req.params.id);
  res.json({ success: true });
});

app.delete('/api/products/:id', auth, (req, res) => {
  db.prepare('DELETE FROM products WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ===== EXCEL IMPORT (B.Connect) =====
app.post('/api/import-excel', auth, xlsxUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'لم يتم رفع ملف' });
  try {
    const XLSX = require('xlsx');
    const wb = XLSX.readFile(req.file.path);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    let updated = 0, added = 0, errors = 0;

    for (const row of rows) {
      // دعم أعمدة B.Connect المختلفة
      const name = row['اسم الصنف'] || row['Item Name'] || row['Name'] || row['name'] || '';
      const price = parseFloat(row['السعر'] || row['Price'] || row['price'] || 0);
      const qty = parseInt(row['الكمية'] || row['Quantity'] || row['qty'] || row['Qty'] || 0);
      const stock = qty > 0 ? (qty <= 5 ? 'low' : 'in') : 'out';

      if (!name) { errors++; continue; }

      const existing = db.prepare('SELECT id FROM products WHERE name LIKE ?').get(`%${name}%`);
      if (existing) {
        db.prepare('UPDATE products SET stock=?, price=? WHERE id=?').run(stock, price || existing.price, existing.id);
        updated++;
      } else {
        db.prepare('INSERT INTO products (name, price, stock, category_id) VALUES (?,?,?,1)').run(name, price || 0, stock);
        added++;
      }
    }

    // حذف الملف المؤقت
    fs.unlinkSync(req.file.path);

    res.json({ success: true, updated, added, errors, total: rows.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'خطأ في قراءة الملف: ' + e.message });
  }
});

// ===== DRUG SEARCH (AI-powered) =====
app.get('/api/drug-search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ results: [], message: '' });

  // 1) ابحث في منتجات الصيدلية أولاً
  const localResults = db.prepare(
    `SELECT p.*, c.name as category_name FROM products p 
     LEFT JOIN categories c ON p.category_id=c.id 
     WHERE p.name LIKE ? OR p.description LIKE ?`
  ).all(`%${q}%`, `%${q}%`).map(p => ({
    name: p.name,
    price: p.price,
    generic: p.description || '',
    company: '',
    category: p.category_name || '',
    in_pharmacy: true,
    local_id: p.id
  }));

  // 2) اجيب AI message من Gemini لو في Key
  let aiMessage = '';
  const geminiKey = process.env.GEMINI_API_KEY ||
    db.prepare("SELECT value FROM site_settings WHERE key='gemini_key'").get()?.value || '';

  if (geminiKey && geminiKey.length > 10) {
    try {
      aiMessage = await askGemini(q, geminiKey);
    } catch (e) {
      console.error('Gemini error:', e.message);
    }
  }

  // 3) ابحث في Drug Eye
  let drugEyeResults = [];
  try {
    drugEyeResults = await searchDrugEye(q);
  } catch (e) {
    console.error('DrugEye error:', e.message);
  }

  // 4) دمج النتائج — الصيدلية أولاً
  const localNames = new Set(localResults.map(r => r.name.toLowerCase()));
  const mergedDrugEye = drugEyeResults.map(d => ({
    ...d,
    in_pharmacy: localNames.has(d.name.toLowerCase())
  }));

  // إزالة التكرار
  const finalDrugEye = mergedDrugEye.filter(d => !localNames.has(d.name.toLowerCase()));

  res.json({
    results: [...localResults, ...finalDrugEye],
    message: aiMessage
  });
});

// ===== Gemini AI =====
async function askGemini(query, apiKey) {
  return new Promise((resolve, reject) => {
    const prompt = `أنت مساعد صيدلاني مصري متخصص. المستخدم بحث عن: "${query}"
    
اكتب رداً قصيراً مفيداً بالعربية (جملة أو جملتين فقط) يشرح:
- إذا كان البحث عن عَرَض (مثل برد، صداع، ضغط) — اذكر أشهر أنواع أدويته
- إذا كان اسم دواء — اذكر استخدامه الرئيسي
- لا تذكر جرعات ولا توصيات طبية محددة

الرد يجب أن يكون مفيداً وبسيطاً للمستخدم العادي.`;

    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 150, temperature: 0.3 }
    });

    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };

    const req = https.request(options, r => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => {
        try {
          const json = JSON.parse(data);
          const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
          resolve(text.trim());
        } catch (e) { resolve(''); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ===== Drug Eye Scraper =====
async function searchDrugEye(query) {
  return new Promise((resolve) => {
    const url = `/api/v1/drugs/search?q=${encodeURIComponent(query)}&limit=12`;
    const options = {
      hostname: 'www.drugeye.net',
      path: url,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json, text/html, */*',
        'Accept-Language': 'ar,en;q=0.9',
        'Referer': 'https://www.drugeye.net/'
      }
    };

    const req = https.request(options, r => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => {
        try {
          // محاولة parse JSON
          const json = JSON.parse(data);
          if (Array.isArray(json)) {
            resolve(json.slice(0, 12).map(d => ({
              name: d.trade_name || d.name || d.tradeName || '',
              price: d.price || d.current_price || 0,
              generic: d.generic_name || d.genericName || '',
              company: d.company || d.manufacturer || '',
              category: d.category || d.atc_name || '',
              in_pharmacy: false
            })).filter(d => d.name));
          } else {
            resolve(parseHtmlDrugs(data, query));
          }
        } catch (e) {
          resolve(parseHtmlDrugs(data, query));
        }
      });
    });
    req.on('error', () => resolve([]));
    req.setTimeout(8000, () => { req.destroy(); resolve([]); });
    req.end();
  });
}

// HTML parser fallback
function parseHtmlDrugs(html, query) {
  const results = [];
  // استخراج بيانات من HTML بـ regex بسيط
  const itemRegex = /<div[^>]*class="[^"]*drug[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  const nameRegex = /class="[^"]*name[^"]*"[^>]*>([^<]+)</i;
  const priceRegex = /(\d+[\.,]?\d*)\s*(?:جنيه|ج\.م|EGP|LE)/i;

  let match;
  while ((match = itemRegex.exec(html)) !== null && results.length < 12) {
    const block = match[1];
    const nameMatch = nameRegex.exec(block);
    const priceMatch = priceRegex.exec(block);
    if (nameMatch) {
      results.push({
        name: nameMatch[1].trim(),
        price: priceMatch ? parseFloat(priceMatch[1]) : 0,
        generic: '',
        company: '',
        category: '',
        in_pharmacy: false
      });
    }
  }

  // لو مفيش نتائج، حاول تعمل بحث بـ endpoint تاني
  return results;
}

// ===== Offers =====
app.get('/api/offers', (req, res) => {
  res.json(db.prepare('SELECT * FROM offers WHERE active=1').all());
});

app.post('/api/offers', auth, (req, res) => {
  const { title, description, discount } = req.body;
  const result = db.prepare('INSERT INTO offers (title,description,discount) VALUES (?,?,?)').run(title, description, discount || 0);
  res.json({ id: result.lastInsertRowid });
});

app.delete('/api/offers/:id', auth, (req, res) => {
  db.prepare('DELETE FROM offers WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ===== Orders =====
app.post('/api/orders', (req, res) => {
  const { customer_name, customer_phone, notes } = req.body;
  const result = db.prepare('INSERT INTO orders (customer_name,customer_phone,notes) VALUES (?,?,?)').run(customer_name, customer_phone, notes);
  res.json({ id: result.lastInsertRowid });
});

app.get('/api/orders', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all());
});

// ===== Stats =====
app.get('/api/stats', auth, (req, res) => {
  const products = db.prepare('SELECT COUNT(*) as c FROM products').get().c;
  const orders = db.prepare('SELECT COUNT(*) as c FROM orders').get().c;
  const in_stock = db.prepare("SELECT COUNT(*) as c FROM products WHERE stock='in'").get().c;
  res.json({ products, orders, in_stock });
});

// ===== Site Settings =====
app.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM site_settings').all();
  const settings = {};
  rows.forEach(r => settings[r.key] = r.value);
  res.json(settings);
});

app.put('/api/settings', auth, (req, res) => {
  const updates = req.body;
  const stmt = db.prepare('INSERT OR REPLACE INTO site_settings (key,value) VALUES (?,?)');
  const updateMany = db.transaction((obj) => {
    for (const [key, value] of Object.entries(obj)) {
      stmt.run(key, value);
    }
  });
  updateMany(updates);
  res.json({ success: true });
});
// =====================================================================
// ضيف الكود ده في server.js
// قبل سطر app.listen في الآخر مباشرة
// =====================================================================

// ===== SMART SEARCH — البحث الموحد =====
app.get('/api/smart-search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q || q.length < 2) return res.json({ local: [], drugs: [], ai_message: '' });

  // 1) ابحث في منتجات الصيدلية
  const localResults = db.prepare(`
    SELECT p.*, c.name as category_name
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.name LIKE ? OR p.description LIKE ?
    ORDER BY p.created_at DESC
  `).all(`%${q}%`, `%${q}%`);

  // 2) AI + Drug Eye
  let aiMessage = '';
  let searchTerms = [q];
  let aiDrugs = [];

  const geminiKey = process.env.GEMINI_API_KEY ||
    db.prepare("SELECT value FROM site_settings WHERE key='gemini_key'").get()?.value || '';

  if (geminiKey && geminiKey.length > 10) {
    try {
      const { getSearchTerms } = require('./aiSearch');
      const aiResult = await getSearchTerms(q);
      searchTerms = aiResult.terms || [q];
      aiMessage = aiResult.message || '';
      aiDrugs = aiResult.drugs || [];
    } catch (e) {
      console.error('AI error:', e.message);
    }
  }

  // 3) Drug Eye
  let drugEyeResults = [];
  try {
    const { searchDrugEye } = require('./drugSearch');
    const seen = new Set();
    for (const term of searchTerms.slice(0, 3)) {
      const results = await searchDrugEye(term);
      for (const r of results) {
        if (!seen.has(r.name.toLowerCase())) {
          seen.add(r.name.toLowerCase());
          drugEyeResults.push(r);
        }
      }
    }
  } catch (e) {
    console.error('DrugEye error:', e.message);
  }

  // 4) دمج AI drugs مع Drug Eye
  const drugEyeNames = new Set(drugEyeResults.map(r => r.name.toLowerCase()));
  for (const d of aiDrugs) {
    if (!drugEyeNames.has(d.en.toLowerCase())) {
      drugEyeResults.push({
        name: d.en,
        name_ar: d.ar,
        display_name: d.ar,
        price: 0,
        generic: d.desc,
        generic_ar: d.desc,
        description: d.desc,
        symptoms: d.symptoms || [],
        company: '',
        category: '',
        image: null,
        in_pharmacy: false,
        source: 'ai'
      });
    }
  }

  // 5) علّم الأدوية المتوفرة في الصيدلية
  const localNames = new Set(localResults.map(r => r.name.toLowerCase()));
  const finalDrugs = drugEyeResults
    .filter(d => !localNames.has(d.name.toLowerCase()))
    .map(d => {
      const match = db.prepare(`
        SELECT id, price, stock FROM products
        WHERE name LIKE ? LIMIT 1
      `).get(`%${d.name.substring(0, 8)}%`);
      return {
        ...d,
        in_pharmacy: !!match,
        pharmacy_price: match ? match.price : null,
        pharmacy_stock: match ? match.stock : null,
      };
    });

  res.json({
    local: localResults,
    drugs: finalDrugs,
    ai_message: aiMessage
  });
});

// ===== AUTOCOMPLETE =====
app.get('/api/autocomplete', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q || q.length < 2) return res.json([]);
  const results = db.prepare(`
    SELECT id, name, price, stock, image, category_id
    FROM products
    WHERE name LIKE ? OR description LIKE ?
    ORDER BY CASE WHEN name LIKE ? THEN 0 ELSE 1 END, name
    LIMIT 8
  `).all(`%${q}%`, `%${q}%`, `${q}%`);
  res.json(results);
});
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});