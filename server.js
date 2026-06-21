require('dotenv').config();

const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const db = new Database('./pharmacy.db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

const JWT_SECRET = process.env.JWT_SECRET;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!JWT_SECRET) {
  console.error('❌ JWT_SECRET غير موجود في .env');
  process.exit(1);
}
if (!GEMINI_API_KEY) {
  console.warn('⚠️ GEMINI_API_KEY غير موجود — البحث الذكي بالـ AI لن يعمل');
}

app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
if (!fs.existsSync('uploads/tmp')) fs.mkdirSync('uploads/tmp', { recursive: true });

// =====================================================================
// DATABASE SETUP
// =====================================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    name_en TEXT,
    icon TEXT DEFAULT 'fa-pills'
  );

  CREATE TABLE IF NOT EXISTS products (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    category_id INTEGER,
    price       REAL    NOT NULL DEFAULT 0,
    old_price   REAL,
    description TEXT,
    image       TEXT,
    barcode     TEXT,
    quantity    INTEGER NOT NULL DEFAULT 50,
    manual_disabled INTEGER NOT NULL DEFAULT 0,
    badge       TEXT,
    featured    INTEGER NOT NULL DEFAULT 0,
    drug_eye_id TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS offers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT,
    discount    INTEGER DEFAULT 0,
    active      INTEGER DEFAULT 1,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS admins (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role     TEXT NOT NULL DEFAULT 'admin'
  );

  CREATE TABLE IF NOT EXISTS orders (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name   TEXT,
    customer_phone  TEXT,
    notes           TEXT,
    status          TEXT DEFAULT 'pending',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS site_settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS sales_invoices (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name  TEXT,
    customer_phone TEXT,
    customer_address TEXT,
    total_amount   REAL NOT NULL DEFAULT 0,
    status         TEXT NOT NULL DEFAULT 'pending',
    source         TEXT NOT NULL DEFAULT 'website',
    notes          TEXT,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sales_invoice_items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id   INTEGER NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
    product_id   INTEGER REFERENCES products(id),
    product_name TEXT NOT NULL,
    unit_price   REAL NOT NULL,
    quantity     INTEGER NOT NULL,
    subtotal     REAL NOT NULL
  );
`);

// =====================================================================
// MIGRATIONS — أعمدة جديدة على جداول موجودة (آمن لو تشغّل أكتر من مرة)
// =====================================================================
const migrateColumn = (table, column, definition) => {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
    console.log(`✅ Migration: added ${table}.${column}`);
  }
};

migrateColumn('products', 'barcode',         'TEXT');
migrateColumn('products', 'quantity',         'INTEGER NOT NULL DEFAULT 50');
migrateColumn('products', 'manual_disabled',  'INTEGER NOT NULL DEFAULT 0');
migrateColumn('admins',   'role',             "TEXT NOT NULL DEFAULT 'admin'");

// قفل المنتجات القديمة اللي كانت stock='out' يدوياً
db.prepare(`UPDATE products SET manual_disabled=1 WHERE stock='out' AND manual_disabled=0`).run();

// =====================================================================
// DEFAULT DATA
// =====================================================================
const insertCat = db.prepare(`INSERT OR IGNORE INTO categories (id,name,name_en,icon) VALUES (?,?,?,?)`);
[
  [1,'أدوية','Medicines','fa-pills'],
  [2,'شراب','Syrups','fa-tint'],
  [3,'أقراص','Tablets','fa-circle'],
  [4,'حقن','Injections','fa-syringe'],
  [5,'قطرات','Drops','fa-eye-dropper'],
  [6,'تجميل','Cosmetics','fa-spa'],
].forEach(r => insertCat.run(...r));

const hash = bcrypt.hashSync('admin123', 10);
db.prepare(`INSERT OR IGNORE INTO admins (username,password,role) VALUES (?,?,'admin')`).run('admin', hash);

const insertSetting = db.prepare(`INSERT OR IGNORE INTO site_settings (key,value) VALUES (?,?)`);
[
  ['pharmacy_name',    'صيدلية عليوة'],
  ['pharmacy_name_en', 'Elewa Pharmacy'],
  ['phone',            '+20 123 456 7890'],
  ['whatsapp',         '201026354290'],
  ['facebook',         'https://www.facebook.com/share/1ELkoj5dxn/'],
  ['address',          'شارع الجمهورية، القاهرة، مصر'],
  ['hours',            'مفتوح 24 ساعة'],
  ['hero_title',       'صحتك تهمنا'],
  ['hero_subtitle',    'في صيدلية عليوة'],
  ['hero_pharmacy_name',    'صيدلية عليوة'],
  ['hero_pharmacy_name_en', 'Elewa Pharmacy'],
  ['hero_desc',        'نقدم لك أفضل الأدوية والمستحضرات الطبية بأسعار منافسة.'],
  ['footer_desc',      'نهدف إلى تقديم أفضل الخدمات الصحية والمنتجات الطبية بجودة عالية.'],
].forEach(([k,v]) => insertSetting.run(k, v));

// Default products (quantity=50, manual_disabled=0)
const insertProd = db.prepare(`
  INSERT OR IGNORE INTO products
    (id,name,category_id,price,old_price,description,quantity,manual_disabled,badge)
  VALUES (?,?,?,?,?,?,50,0,?)
`);
[
  [1,'باراسيتامول 500mg',3,12,null,'مسكن للألم وخافض للحرارة',null],
  [2,'أموكسيسيلين 250mg',1,35,45,'مضاد حيوي واسع الطيف','sale'],
  [3,'شراب فيتامين C',2,28,38,'شراب مقوي للمناعة','sale'],
  [4,'قطرة أنف أوتريفين',5,19,null,'قطرة لفتح الاحتقان',null],
  [5,'كريم نيفيا',6,45,60,'كريم مرطب للبشرة','sale'],
  [6,'بروفين 400mg',3,18,null,'مضاد للالتهابات ومسكن',null],
].forEach(r => insertProd.run(...r));

// =====================================================================
// HELPER — حساب stock من quantity + manual_disabled
// =====================================================================
function computeStock(quantity, manual_disabled) {
  if (manual_disabled) return 'out';
  if (quantity <= 0)   return 'out';
  if (quantity <= 5)   return 'low';
  return 'in';
}

function enrichProduct(p) {
  return {
    ...p,
    stock: computeStock(p.quantity, p.manual_disabled),
  };
}

// =====================================================================
// AUTH MIDDLEWARE
// =====================================================================
const auth = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
};

// =====================================================================
// UPLOAD
// =====================================================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename:    (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)),
});
const upload      = multer({ storage });
const xlsxUpload  = multer({ dest: 'uploads/tmp/' });

// =====================================================================
// ROUTES — AUTH
// =====================================================================
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const admin = db.prepare('SELECT * FROM admins WHERE username=?').get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password))
    return res.status(401).json({ error: 'بيانات خاطئة' });
  const token = jwt.sign({ id: admin.id, role: admin.role }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, role: admin.role });
});

app.put('/api/change-password', auth, (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password)
    return res.status(400).json({ error: 'أدخل كلمة المرور الحالية والجديدة' });
  if (new_password.length < 6)
    return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
  const admin = db.prepare('SELECT * FROM admins WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(current_password, admin.password))
    return res.status(401).json({ error: 'كلمة المرور الحالية غير صحيحة' });
  db.prepare('UPDATE admins SET password=? WHERE id=?').run(bcrypt.hashSync(new_password, 10), req.user.id);
  res.json({ success: true });
});

app.put('/api/change-username', auth, (req, res) => {
  const { new_username, password } = req.body;
  if (!new_username || !password)
    return res.status(400).json({ error: 'أدخل اسم المستخدم الجديد وكلمة المرور' });
  const admin = db.prepare('SELECT * FROM admins WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(password, admin.password))
    return res.status(401).json({ error: 'كلمة المرور غير صحيحة' });
  const exists = db.prepare('SELECT id FROM admins WHERE username=? AND id!=?').get(new_username, req.user.id);
  if (exists) return res.status(409).json({ error: 'اسم المستخدم مستخدم بالفعل' });
  db.prepare('UPDATE admins SET username=? WHERE id=?').run(new_username, req.user.id);
  res.json({ success: true });
});

// =====================================================================
// ROUTES — CATEGORIES
// =====================================================================
app.get('/api/categories', (req, res) => {
  res.json(db.prepare('SELECT * FROM categories').all());
});

// =====================================================================
// ROUTES — PRODUCTS
// =====================================================================
app.get('/api/products', (req, res) => {
  const { category, search } = req.query;
  let sql = `
    SELECT p.*, c.name as category_name
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE 1=1
  `;
  const params = [];
  if (category && category !== 'all') { sql += ' AND p.category_id=?'; params.push(category); }
  if (search) { sql += ' AND (p.name LIKE ? OR p.barcode LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  sql += ' ORDER BY p.created_at DESC';
  res.json(db.prepare(sql).all(...params).map(enrichProduct));
});

app.get('/api/products/:id', (req, res) => {
  const row = db.prepare(`
    SELECT p.*, c.name as category_name
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.id=?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(enrichProduct(row));
});

app.post('/api/products', auth, upload.single('image'), (req, res) => {
  const { name, category_id, price, old_price, description, badge, barcode, quantity, manual_disabled } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : null;
  const qty = parseInt(quantity ?? 50);
  const disabled = parseInt(manual_disabled ?? 0);
  const result = db.prepare(`
    INSERT INTO products
      (name,category_id,price,old_price,description,image,barcode,quantity,manual_disabled,badge)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(name, category_id, price, old_price || null, description, image, barcode || null, qty, disabled, badge || null);
  res.json({ id: result.lastInsertRowid });
});

app.put('/api/products/:id', auth, upload.single('image'), (req, res) => {
  const { name, category_id, price, old_price, description, badge, barcode, quantity, manual_disabled } = req.body;
  const row = db.prepare('SELECT image FROM products WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const image = req.file ? `/uploads/${req.file.filename}` : row.image;
  const qty = parseInt(quantity ?? 50);
  const disabled = parseInt(manual_disabled ?? 0);
  db.prepare(`
    UPDATE products
    SET name=?,category_id=?,price=?,old_price=?,description=?,image=?,barcode=?,quantity=?,manual_disabled=?,badge=?
    WHERE id=?
  `).run(name, category_id, price, old_price || null, description, image, barcode || null, qty, disabled, badge || null, req.params.id);
  res.json({ success: true });
});

// تبديل القفل اليدوي فقط (بدون إرسال الملف كله)
app.patch('/api/products/:id/toggle-disabled', auth, (req, res) => {
  const row = db.prepare('SELECT manual_disabled FROM products WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const newVal = row.manual_disabled ? 0 : 1;
  db.prepare('UPDATE products SET manual_disabled=? WHERE id=?').run(newVal, req.params.id);
  res.json({ success: true, manual_disabled: newVal });
});

app.delete('/api/products/:id', auth, (req, res) => {
  db.prepare('DELETE FROM products WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// =====================================================================
// ROUTES — EXCEL IMPORT (B.Connect)
// =====================================================================
app.post('/api/import-excel', auth, xlsxUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'لم يتم رفع ملف' });
  try {
    const XLSX = require('xlsx');
    const wb = XLSX.readFile(req.file.path);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    let updated = 0, added = 0, errors = 0;

    const importTx = db.transaction(() => {
      for (const row of rows) {
        // دعم أعمدة B.Connect المختلفة
        const name    = String(row['اسم الصنف'] || row['Item Name'] || row['Name'] || row['name'] || '').trim();
        const barcode = String(row['باركود'] || row['Barcode'] || row['barcode'] || '').trim();
        const price   = parseFloat(row['السعر'] || row['Price'] || row['price'] || 0) || 0;
        const qty     = parseInt(row['الكمية'] || row['Quantity'] || row['qty'] || row['Qty'] || 0) || 0;

        if (!name && !barcode) { errors++; continue; }

        // أول حاجة: ابحث بالباركود (أدق)
        let existing = null;
        if (barcode) {
          existing = db.prepare('SELECT id FROM products WHERE barcode=?').get(barcode);
        }
        // احتياطي: ابحث بالاسم
        if (!existing && name) {
          existing = db.prepare('SELECT id FROM products WHERE name=?').get(name)
                  || db.prepare('SELECT id FROM products WHERE name LIKE ?').get(`%${name}%`);
        }

        if (existing) {
          // تحديث السعر والكمية
          // لو الكمية > 0 → ارفع القفل اليدوي تلقائياً (الاستيراد = تجديد)
          db.prepare(`
            UPDATE products
            SET price=?, quantity=?, manual_disabled=?
            WHERE id=?
          `).run(
            price || db.prepare('SELECT price FROM products WHERE id=?').get(existing.id).price,
            qty,
            qty > 0 ? 0 : 1,   // كمية > 0 → افتح / كمية 0 → اقفل
            existing.id
          );
          updated++;
        } else {
          // صنف جديد → أضفه
          db.prepare(`
            INSERT INTO products (name, barcode, price, quantity, manual_disabled, category_id)
            VALUES (?, ?, ?, ?, ?, 1)
          `).run(name || barcode, barcode || null, price, qty, qty > 0 ? 0 : 1);
          added++;
        }
      }
    });

    importTx();
    fs.unlinkSync(req.file.path);

    res.json({ success: true, updated, added, errors, total: rows.length });
  } catch (e) {
    console.error(e);
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: 'خطأ في قراءة الملف: ' + e.message });
  }
});

// =====================================================================
// ROUTES — OFFERS
// =====================================================================
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

// =====================================================================
// ROUTES — SALES INVOICES (Cart Checkout)
// =====================================================================

// إنشاء فاتورة بيع جديدة (من الموقع أو من الأدمن)
app.post('/api/invoices', (req, res) => {
  const { customer_name, customer_phone, customer_address, notes, items, source } = req.body;

  if (!items || !items.length)
    return res.status(400).json({ error: 'لا توجد منتجات في الطلب' });

  try {
    let invoiceId;

    const createInvoice = db.transaction(() => {
      // تحقق من توفر الكميات أولاً
      for (const item of items) {
        const prod = db.prepare('SELECT id, name, quantity, manual_disabled, price FROM products WHERE id=?').get(item.product_id);
        if (!prod) throw new Error(`المنتج رقم ${item.product_id} غير موجود`);
        if (prod.manual_disabled) throw new Error(`المنتج "${prod.name}" مُعطَّل يدوياً`);
        if (prod.quantity < item.quantity) throw new Error(`الكمية المتاحة من "${prod.name}" هي ${prod.quantity} فقط`);
      }

      // احسب الإجمالي
      let total = 0;
      const enrichedItems = items.map(item => {
        const prod = db.prepare('SELECT price, name FROM products WHERE id=?').get(item.product_id);
        const unitPrice = item.unit_price ?? prod.price;
        const subtotal  = unitPrice * item.quantity;
        total += subtotal;
        return { ...item, unit_price: unitPrice, product_name: prod.name, subtotal };
      });

      // أنشئ الفاتورة
      const inv = db.prepare(`
        INSERT INTO sales_invoices (customer_name, customer_phone, customer_address, total_amount, source, notes, status)
        VALUES (?, ?, ?, ?, ?, ?, 'pending')
      `).run(customer_name, customer_phone, customer_address || '', total, source || 'website', notes || '');

      invoiceId = inv.lastInsertRowid;

      // أضف الأصناف وانقص الكمية
      for (const item of enrichedItems) {
        db.prepare(`
          INSERT INTO sales_invoice_items (invoice_id, product_id, product_name, unit_price, quantity, subtotal)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(invoiceId, item.product_id, item.product_name, item.unit_price, item.quantity, item.subtotal);

        // انقص الكمية الفعلية
        db.prepare(`
          UPDATE products
          SET quantity = quantity - ?,
              manual_disabled = CASE WHEN quantity - ? <= 0 THEN 1 ELSE manual_disabled END
          WHERE id=?
        `).run(item.quantity, item.quantity, item.product_id);
      }
    });

    createInvoice();
    res.json({ success: true, invoice_id: invoiceId });

  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// قائمة الفواتير (للأدمن)
app.get('/api/invoices', auth, (req, res) => {
  const { status, from, to } = req.query;
  let sql = `SELECT * FROM sales_invoices WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND status=?'; params.push(status); }
  if (from)   { sql += ' AND DATE(created_at) >= ?'; params.push(from); }
  if (to)     { sql += ' AND DATE(created_at) <= ?'; params.push(to); }
  sql += ' ORDER BY created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

// تفاصيل فاتورة واحدة
app.get('/api/invoices/:id', auth, (req, res) => {
  const inv = db.prepare('SELECT * FROM sales_invoices WHERE id=?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Not found' });
  const items = db.prepare('SELECT * FROM sales_invoice_items WHERE invoice_id=?').all(req.params.id);
  res.json({ ...inv, items });
});

// تحديث حالة الفاتورة
app.patch('/api/invoices/:id/status', auth, (req, res) => {
  const { status } = req.body;
  const allowed = ['pending', 'confirmed', 'delivered', 'cancelled'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'حالة غير صالحة' });

  const inv = db.prepare('SELECT * FROM sales_invoices WHERE id=?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Not found' });

  // لو الفاتورة اتألغت → أرجع الكميات
  if (status === 'cancelled' && inv.status !== 'cancelled') {
    const items = db.prepare('SELECT * FROM sales_invoice_items WHERE invoice_id=?').all(req.params.id);
    const restoreTx = db.transaction(() => {
      for (const item of items) {
        db.prepare(`UPDATE products SET quantity = quantity + ?, manual_disabled = 0 WHERE id=?`)
          .run(item.quantity, item.product_id);
      }
    });
    restoreTx();
  }

  db.prepare('UPDATE sales_invoices SET status=? WHERE id=?').run(status, req.params.id);
  res.json({ success: true });
});

// =====================================================================
// ROUTES — REPORTS (مبنية على الفواتير الحقيقية)
// =====================================================================
app.get('/api/reports/summary', auth, (req, res) => {
  const { period } = req.query; // 'today' | 'week' | 'month'

  let dateFilter = '';
  if (period === 'today') dateFilter = `AND DATE(created_at) = DATE('now')`;
  else if (period === 'week') dateFilter = `AND created_at >= DATE('now', '-7 days')`;
  else if (period === 'month') dateFilter = `AND created_at >= DATE('now', '-30 days')`;

  const revenue = db.prepare(`
    SELECT COALESCE(SUM(total_amount), 0) as total
    FROM sales_invoices
    WHERE status != 'cancelled' ${dateFilter}
  `).get().total;

  const ordersCount = db.prepare(`
    SELECT COUNT(*) as c FROM sales_invoices WHERE 1=1 ${dateFilter}
  `).get().c;

  const topProducts = db.prepare(`
    SELECT sii.product_name, SUM(sii.quantity) as units_sold, SUM(sii.subtotal) as revenue
    FROM sales_invoice_items sii
    JOIN sales_invoices si ON si.id = sii.invoice_id
    WHERE si.status != 'cancelled' ${dateFilter}
    GROUP BY sii.product_name
    ORDER BY units_sold DESC
    LIMIT 10
  `).all();

  const dailySales = db.prepare(`
    SELECT DATE(created_at) as date, COUNT(*) as orders, SUM(total_amount) as revenue
    FROM sales_invoices
    WHERE status != 'cancelled' ${dateFilter}
    GROUP BY DATE(created_at)
    ORDER BY date DESC
    LIMIT 30
  `).all();

  res.json({ revenue, ordersCount, topProducts, dailySales });
});

// =====================================================================
// ROUTES — ORDERS (legacy — رسائل التواصل)
// =====================================================================
app.post('/api/orders', (req, res) => {
  const { customer_name, customer_phone, notes } = req.body;
  const result = db.prepare('INSERT INTO orders (customer_name,customer_phone,notes) VALUES (?,?,?)').run(customer_name, customer_phone, notes);
  res.json({ id: result.lastInsertRowid });
});

app.get('/api/orders', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all());
});

// =====================================================================
// ROUTES — STATS (dashboard cards)
// =====================================================================
app.get('/api/stats', auth, (req, res) => {
  const products    = db.prepare('SELECT COUNT(*) as c FROM products').get().c;
  const inStock     = db.prepare('SELECT COUNT(*) as c FROM products WHERE quantity > 0 AND manual_disabled = 0').get().c;
  const lowStock    = db.prepare('SELECT COUNT(*) as c FROM products WHERE quantity > 0 AND quantity <= 5 AND manual_disabled = 0').get().c;
  const outOfStock  = db.prepare('SELECT COUNT(*) as c FROM products WHERE quantity <= 0 OR manual_disabled = 1').get().c;
  const orders      = db.prepare('SELECT COUNT(*) as c FROM orders').get().c;
  const invoices    = db.prepare("SELECT COUNT(*) as c FROM sales_invoices WHERE status != 'cancelled'").get().c;
  const revenue     = db.prepare("SELECT COALESCE(SUM(total_amount),0) as t FROM sales_invoices WHERE status != 'cancelled'").get().t;
  res.json({ products, inStock, lowStock, outOfStock, orders, invoices, revenue });
});

// =====================================================================
// ROUTES — SITE SETTINGS
// =====================================================================
app.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM site_settings').all();
  const settings = {};
  rows.forEach(r => settings[r.key] = r.value);
  res.json(settings);
});

app.put('/api/settings', auth, (req, res) => {
  const stmt = db.prepare('INSERT OR REPLACE INTO site_settings (key,value) VALUES (?,?)');
  const tx = db.transaction((obj) => {
    for (const [key, value] of Object.entries(obj)) stmt.run(key, value);
  });
  tx(req.body);
  res.json({ success: true });
});

// =====================================================================
// ROUTES — SMART SEARCH
// =====================================================================
app.get('/api/smart-search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q || q.length < 2) return res.json({ local: [], drugs: [], ai_message: '' });

  const localResults = db.prepare(`
    SELECT p.*, c.name as category_name
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.name LIKE ? OR p.description LIKE ? OR p.barcode LIKE ?
    ORDER BY p.created_at DESC
  `).all(`%${q}%`, `%${q}%`, `%${q}%`).map(enrichProduct);

  let aiMessage = '', searchTerms = [q], aiDrugs = [];

  if (GEMINI_API_KEY) {
    try {
      const { getSearchTerms } = require('./aiSearch');
      const aiResult = await getSearchTerms(q);
      searchTerms = aiResult.terms || [q];
      aiMessage   = aiResult.message || '';
      aiDrugs     = aiResult.drugs || [];
    } catch (e) { console.error('AI error:', e.message); }
  }

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
  } catch (e) { console.error('DrugEye error:', e.message); }

  const drugEyeNames = new Set(drugEyeResults.map(r => r.name.toLowerCase()));
  for (const d of aiDrugs) {
    if (!drugEyeNames.has(d.en.toLowerCase())) {
      drugEyeResults.push({
        name: d.en, name_ar: d.ar, display_name: d.ar,
        price: 0, generic: d.desc, generic_ar: d.desc,
        description: d.desc, symptoms: d.symptoms || [],
        company: '', category: '', image: null,
        in_pharmacy: false, source: 'ai',
      });
    }
  }

  const localNames = new Set(localResults.map(r => r.name.toLowerCase()));
  const finalDrugs = drugEyeResults
    .filter(d => !localNames.has(d.name.toLowerCase()))
    .map(d => {
      const match = db.prepare(`SELECT id, price, quantity, manual_disabled FROM products WHERE name LIKE ? LIMIT 1`).get(`%${d.name.substring(0, 8)}%`);
      return {
        ...d,
        in_pharmacy:    !!match,
        pharmacy_price: match ? match.price : null,
        pharmacy_stock: match ? computeStock(match.quantity, match.manual_disabled) : null,
      };
    });

  res.json({ local: localResults, drugs: finalDrugs, ai_message: aiMessage });
});

// =====================================================================
// ROUTES — AUTOCOMPLETE
// =====================================================================
app.get('/api/autocomplete', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q || q.length < 2) return res.json([]);
  const results = db.prepare(`
    SELECT id, name, price, quantity, manual_disabled, image, category_id, barcode
    FROM products
    WHERE name LIKE ? OR description LIKE ? OR barcode LIKE ?
    ORDER BY CASE WHEN name LIKE ? THEN 0 ELSE 1 END, name
    LIMIT 8
  `).all(`%${q}%`, `%${q}%`, `%${q}%`, `${q}%`).map(enrichProduct);
  res.json(results);
});

// =====================================================================
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});