const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'elewa-pharmacy-2024';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

// ===== DATABASE SETUP =====
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL, name_en TEXT, icon TEXT DEFAULT 'fa-pills'
    );
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL, category_id INTEGER, price REAL NOT NULL,
      old_price REAL, description TEXT, image TEXT,
      stock TEXT DEFAULT 'in', badge TEXT, featured INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS offers (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL, description TEXT, discount INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL, password TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      customer_name TEXT, customer_phone TEXT, notes TEXT,
      status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Default categories
  const cats = [
    [1,'أدوية','Medicines','fa-pills'],
    [2,'شراب','Syrups','fa-tint'],
    [3,'أقراص','Tablets','fa-circle'],
    [4,'حقن','Injections','fa-syringe'],
    [5,'قطرات','Drops','fa-eye-dropper'],
    [6,'تجميل','Cosmetics','fa-spa']
  ];
  for (const [id,name,name_en,icon] of cats) {
    await pool.query(`INSERT INTO categories (id,name,name_en,icon) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`, [id,name,name_en,icon]);
  }

  // Default admin
  const hash = bcrypt.hashSync('admin123', 10);
  await pool.query(`INSERT INTO admins (username,password) VALUES ($1,$2) ON CONFLICT (username) DO NOTHING`, ['admin', hash]);

  // Default products
  const prods = [
    [1,'باراسيتامول 500mg',3,12,null,'مسكن للألم وخافض للحرارة','in',null],
    [2,'أموكسيسيلين 250mg',1,35,45,'مضاد حيوي واسع الطيف','in','sale'],
    [3,'شراب فيتامين C',2,28,38,'شراب مقوي للمناعة','in','sale'],
    [4,'قطرة أنف أوتريفين',5,19,null,'قطرة لفتح الاحتقان','in',null],
    [5,'كريم نيفيا',6,45,60,'كريم مرطب للبشرة','in','sale'],
    [6,'بروفين 400mg',3,18,null,'مضاد للالتهابات ومسكن','in',null]
  ];
  for (const [id,name,cat,price,old,desc,stock,badge] of prods) {
    await pool.query(`INSERT INTO products (id,name,category_id,price,old_price,description,stock,badge) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
      [id,name,cat,price,old,desc,stock,badge]);
  }

  // Default settings
  const defaults = {
    pharmacy_name:'صيدلية عليوة', pharmacy_name_en:'Elewa Pharmacy',
    phone:'201026354290', whatsapp:'201026354290',
    facebook:'https://facebook.com',
    address:'شارع الجمهورية، أسيوط، مصر',
    working_hours:'السبت - الخميس: 9ص - 11م',
    hero_title:'صحتك تهمنا', hero_title_colored:'في صيدلية عليوة',
    hero_subtitle:'نقدم لك أفضل الأدوية والمستحضرات الطبية بأسعار منافسة.',
    hero_badge1:'منتجات أصلية', hero_badge2:'توصيل سريع',
    footer_about:'نهدف إلى تقديم أفضل الخدمات الصحية والمنتجات الطبية بجودة عالية وأسعار منافسة.'
  };
  for (const [key,value] of Object.entries(defaults)) {
    await pool.query(`INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING`, [key,value]);
  }

  console.log('✅ Database initialized');
}

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

// ===== ROUTES =====

// Login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const result = await pool.query('SELECT * FROM admins WHERE username=$1', [username]);
  const admin = result.rows[0];
  if (!admin || !bcrypt.compareSync(password, admin.password))
    return res.status(401).json({ error: 'بيانات خاطئة' });
  const token = jwt.sign({ id: admin.id }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token });
});

// Settings
app.get('/api/settings', async (req, res) => {
  const result = await pool.query('SELECT * FROM settings');
  const settings = {};
  result.rows.forEach(r => settings[r.key] = r.value);
  res.json(settings);
});

app.put('/api/settings', auth, async (req, res) => {
  const settings = req.body;
  for (const [key, value] of Object.entries(settings)) {
    await pool.query(`INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2`, [key, value]);
  }
  res.json({ success: true });
});

// Change password
app.put('/api/change-password', auth, async (req, res) => {
  const { current_password, new_password } = req.body;
  const result = await pool.query('SELECT * FROM admins WHERE id=$1', [req.user.id]);
  const admin = result.rows[0];
  if (!bcrypt.compareSync(current_password, admin.password))
    return res.status(401).json({ error: 'كلمة المرور الحالية غير صحيحة' });
  const newHash = bcrypt.hashSync(new_password, 10);
  await pool.query('UPDATE admins SET password=$1 WHERE id=$2', [newHash, req.user.id]);
  res.json({ success: true });
});

// Change username
app.put('/api/change-username', auth, async (req, res) => {
  const { new_username, password } = req.body;
  const result = await pool.query('SELECT * FROM admins WHERE id=$1', [req.user.id]);
  const admin = result.rows[0];
  if (!bcrypt.compareSync(password, admin.password))
    return res.status(401).json({ error: 'كلمة المرور غير صحيحة' });
  try {
    await pool.query('UPDATE admins SET username=$1 WHERE id=$2', [new_username, req.user.id]);
    res.json({ success: true });
  } catch(e) {
    res.status(400).json({ error: 'اسم المستخدم موجود بالفعل' });
  }
});

// Categories
app.get('/api/categories', async (req, res) => {
  const result = await pool.query('SELECT * FROM categories');
  res.json(result.rows);
});

// Products
app.get('/api/products', async (req, res) => {
  const { category, search } = req.query;
  let sql = `SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id=c.id WHERE 1=1`;
  const params = [];
  if (category && category !== 'all') { sql += ` AND p.category_id=$${params.length+1}`; params.push(category); }
  if (search) { sql += ` AND p.name ILIKE $${params.length+1}`; params.push(`%${search}%`); }
  sql += ' ORDER BY p.created_at DESC';
  const result = await pool.query(sql, params);
  res.json(result.rows);
});

app.get('/api/products/:id', async (req, res) => {
  const result = await pool.query(`SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id=c.id WHERE p.id=$1`, [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json(result.rows[0]);
});

app.post('/api/products', auth, upload.single('image'), async (req, res) => {
  const { name, category_id, price, old_price, description, stock, badge } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : null;
  const result = await pool.query(
    `INSERT INTO products (name,category_id,price,old_price,description,image,stock,badge) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [name, category_id, price, old_price||null, description, image, stock||'in', badge||null]
  );
  res.json({ id: result.rows[0].id });
});

app.put('/api/products/:id', auth, upload.single('image'), async (req, res) => {
  const { name, category_id, price, old_price, description, stock, badge } = req.body;
  const row = await pool.query('SELECT image FROM products WHERE id=$1', [req.params.id]);
  const image = req.file ? `/uploads/${req.file.filename}` : row.rows[0]?.image;
  await pool.query(
    `UPDATE products SET name=$1,category_id=$2,price=$3,old_price=$4,description=$5,image=$6,stock=$7,badge=$8 WHERE id=$9`,
    [name, category_id, price, old_price||null, description, image, stock, badge, req.params.id]
  );
  res.json({ success: true });
});

app.delete('/api/products/:id', auth, async (req, res) => {
  await pool.query('DELETE FROM products WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// Offers
app.get('/api/offers', async (req, res) => {
  const result = await pool.query('SELECT * FROM offers WHERE active=1');
  res.json(result.rows);
});

app.post('/api/offers', auth, async (req, res) => {
  const { title, description, discount } = req.body;
  const result = await pool.query(
    'INSERT INTO offers (title,description,discount) VALUES ($1,$2,$3) RETURNING id',
    [title, description, discount||0]
  );
  res.json({ id: result.rows[0].id });
});

app.delete('/api/offers/:id', auth, async (req, res) => {
  await pool.query('DELETE FROM offers WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// Orders
app.post('/api/orders', async (req, res) => {
  const { customer_name, customer_phone, notes } = req.body;
  const result = await pool.query(
    'INSERT INTO orders (customer_name,customer_phone,notes) VALUES ($1,$2,$3) RETURNING id',
    [customer_name, customer_phone, notes]
  );
  res.json({ id: result.rows[0].id });
});

app.get('/api/orders', auth, async (req, res) => {
  const result = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
  res.json(result.rows);
});

// Stats
app.get('/api/stats', auth, async (req, res) => {
  const products = await pool.query('SELECT COUNT(*) as c FROM products');
  const orders = await pool.query('SELECT COUNT(*) as c FROM orders');
  const in_stock = await pool.query(`SELECT COUNT(*) as c FROM products WHERE stock='in'`);
  res.json({
    products: products.rows[0].c,
    orders: orders.rows[0].c,
    in_stock: in_stock.rows[0].c
  });
});
// ===== SMART SEARCH — بحث موحد (محلي + Drug Eye + AI) =====
const { searchDrugEye } = require('./drugSearch');
const { getSearchTerms } = require('./aiSearch');

app.get('/api/smart-search', async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json({ local: [], drugs: [], ai_message: '' });

  try {
    // Step 1: AI يفهم الاستعلام ويحوله لـ terms
    const { terms, message: aiMessage } = await getSearchTerms(q);

    // Step 2: ابحث في المنتجات المحلية (بالعربي والإنجليزي)
    const localResults = await pool.query(`
      SELECT p.*, c.name as category_name 
      FROM products p 
      LEFT JOIN categories c ON p.category_id=c.id 
      WHERE p.name ILIKE $1 OR p.description ILIKE $1
      ORDER BY p.featured DESC, p.created_at DESC
      LIMIT 12
    `, [`%${q}%`]);

    // Step 3: ابحث في Drug Eye عن كل term
    const allDrugs = [];
    const seenDrugs = new Set();
    const drugPromises = terms.slice(0, 3).map(term => searchDrugEye(term));
    const drugResults = await Promise.all(drugPromises);

    for (const results of drugResults) {
      for (const drug of results) {
        if (!drug.name || seenDrugs.has(drug.name)) continue;
        seenDrugs.add(drug.name);
        allDrugs.push(drug);
      }
    }

    // Step 4: ربط الأدوية بالمخزن المحلي (fuzzy match)
    const pharmacyProducts = await pool.query(`SELECT id, name, price, stock, image FROM products`);
    
    const linkedDrugs = allDrugs.map(drug => {
      // Fuzzy match: لو الاسم المحلي يتضمن 6 حروف من اسم الدواء أو العكس
      const match = pharmacyProducts.rows.find(p => {
        const pName = p.name.toLowerCase();
        const dName = drug.name.toLowerCase();
        // match بالاسم أو بالgeneric
        return pName.includes(dName.substring(0, 8)) || 
               dName.includes(pName.substring(0, 8)) ||
               (drug.generic && pName.includes(drug.generic.toLowerCase().substring(0, 8)));
      });
      
      return {
        name: drug.name,
        price: drug.price,
        generic: drug.generic,
        category: drug.category,
        company: drug.company,
        image: drug.image || null,  // <-- صورة من Drug Eye
        in_pharmacy: !!match,
        pharmacy_id: match ? match.id : null,
        pharmacy_price: match ? match.price : null,
        pharmacy_stock: match ? match.stock : null
      };
    });

    res.json({
      local: localResults.rows,
      drugs: linkedDrugs.slice(0, 12),
      ai_message: aiMessage || '',
      terms: terms  // للـ debugging
    });

  } catch (err) {
    console.error('Smart search error:', err);
    // Fallback: بحث محلي بس
    try {
      const local = await pool.query(`
        SELECT p.*, c.name as category_name 
        FROM products p 
        LEFT JOIN categories c ON p.category_id=c.id 
        WHERE p.name ILIKE $1
        LIMIT 12
      `, [`%${q}%`]);
      res.json({ local: local.rows, drugs: [], ai_message: '', terms: [q] });
    } catch(e) {
      res.status(500).json({ local: [], drugs: [], ai_message: '', error: err.message });
    }
  }
});

// Route القديم للـ compatibility
app.get('/api/drug-search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json({ results: [], message: '' });
  try {
    const forwardRes = await fetch(`http://localhost:${PORT}/api/smart-search?q=${encodeURIComponent(q)}`);
    const data = await forwardRes.json();
    res.json({ results: data.drugs, message: data.ai_message });
  } catch(e) {
    res.status(500).json({ results: [], message: '' });
  }
});

// Start
initDB().then(() => {
  app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
}).catch(err => {
  console.error('❌ DB init failed:', err);
  process.exit(1);
});