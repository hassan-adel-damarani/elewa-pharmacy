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
const JWT_SECRET = 'elewa-pharmacy-2024';

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
`);

// Default data
db.prepare(`INSERT OR IGNORE INTO categories (id,name,name_en,icon) VALUES (?,?,?,?)`).run(1,'أدوية','Medicines','fa-pills');
db.prepare(`INSERT OR IGNORE INTO categories (id,name,name_en,icon) VALUES (?,?,?,?)`).run(2,'شراب','Syrups','fa-tint');
db.prepare(`INSERT OR IGNORE INTO categories (id,name,name_en,icon) VALUES (?,?,?,?)`).run(3,'أقراص','Tablets','fa-circle');
db.prepare(`INSERT OR IGNORE INTO categories (id,name,name_en,icon) VALUES (?,?,?,?)`).run(4,'حقن','Injections','fa-syringe');
db.prepare(`INSERT OR IGNORE INTO categories (id,name,name_en,icon) VALUES (?,?,?,?)`).run(5,'قطرات','Drops','fa-eye-dropper');
db.prepare(`INSERT OR IGNORE INTO categories (id,name,name_en,icon) VALUES (?,?,?,?)`).run(6,'تجميل','Cosmetics','fa-spa');

const hash = bcrypt.hashSync('admin123', 10);
db.prepare(`INSERT OR IGNORE INTO admins (username,password) VALUES (?,?)`).run('admin', hash);

db.prepare(`INSERT OR IGNORE INTO products (id,name,category_id,price,old_price,description,stock,badge) VALUES (?,?,?,?,?,?,?,?)`).run(1,'باراسيتامول 500mg',3,12,null,'مسكن للألم وخافض للحرارة','in',null);
db.prepare(`INSERT OR IGNORE INTO products (id,name,category_id,price,old_price,description,stock,badge) VALUES (?,?,?,?,?,?,?,?)`).run(2,'أموكسيسيلين 250mg',1,35,45,'مضاد حيوي واسع الطيف','in','sale');
db.prepare(`INSERT OR IGNORE INTO products (id,name,category_id,price,old_price,description,stock,badge) VALUES (?,?,?,?,?,?,?,?)`).run(3,'شراب فيتامين C',2,28,38,'شراب مقوي للمناعة','in','sale');
db.prepare(`INSERT OR IGNORE INTO products (id,name,category_id,price,old_price,description,stock,badge) VALUES (?,?,?,?,?,?,?,?)`).run(4,'قطرة أنف أوتريفين',5,19,null,'قطرة لفتح الاحتقان','in',null);
db.prepare(`INSERT OR IGNORE INTO products (id,name,category_id,price,old_price,description,stock,badge) VALUES (?,?,?,?,?,?,?,?)`).run(5,'كريم نيفيا',6,45,60,'كريم مرطب للبشرة','in','sale');
db.prepare(`INSERT OR IGNORE INTO products (id,name,category_id,price,old_price,description,stock,badge) VALUES (?,?,?,?,?,?,?,?)`).run(6,'بروفين 400mg',3,18,null,'مضاد للالتهابات ومسكن','in',null);

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
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const admin = db.prepare('SELECT * FROM admins WHERE username=?').get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password))
    return res.status(401).json({ error: 'بيانات خاطئة' });
  const token = jwt.sign({ id: admin.id }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token });
});

// Categories
app.get('/api/categories', (req, res) => {
  const rows = db.prepare('SELECT * FROM categories').all();
  res.json(rows);
});

// Products
app.get('/api/products', (req, res) => {
  const { category, search } = req.query;
  let sql = `SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id=c.id WHERE 1=1`;
  const params = [];
  if (category && category !== 'all') { sql += ' AND p.category_id=?'; params.push(category); }
  if (search) { sql += ' AND p.name LIKE ?'; params.push(`%${search}%`); }
  sql += ' ORDER BY p.created_at DESC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
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

// Offers
app.get('/api/offers', (req, res) => {
  const rows = db.prepare('SELECT * FROM offers WHERE active=1').all();
  res.json(rows);
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

// Orders
app.post('/api/orders', (req, res) => {
  const { customer_name, customer_phone, notes } = req.body;
  const result = db.prepare('INSERT INTO orders (customer_name,customer_phone,notes) VALUES (?,?,?)').run(customer_name, customer_phone, notes);
  res.json({ id: result.lastInsertRowid });
});

app.get('/api/orders', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
  res.json(rows);
});

// Stats
app.get('/api/stats', auth, (req, res) => {
  const products = db.prepare('SELECT COUNT(*) as c FROM products').get().c;
  const orders = db.prepare('SELECT COUNT(*) as c FROM orders').get().c;
  const in_stock = db.prepare("SELECT COUNT(*) as c FROM products WHERE stock='in'").get().c;
  res.json({ products, orders, in_stock });
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});