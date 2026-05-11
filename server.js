const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;
const JWT_SECRET = 'elewa-pharmacy-2024';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

// Database
const db = new sqlite3.Database('./pharmacy.db');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    name_en TEXT,
    icon TEXT DEFAULT 'fa-pills'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category_id INTEGER,
    price REAL NOT NULL,
    old_price REAL,
    description TEXT,
    image TEXT,
    stock TEXT DEFAULT 'in',
    badge TEXT,
    featured INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    discount INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT,
    customer_phone TEXT,
    notes TEXT,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Default categories
  db.run(`INSERT OR IGNORE INTO categories (id,name,name_en,icon) VALUES
    (1,'أدوية','Medicines','fa-pills'),
    (2,'شراب','Syrups','fa-tint'),
    (3,'أقراص','Tablets','fa-circle'),
    (4,'حقن','Injections','fa-syringe'),
    (5,'قطرات','Drops','fa-eye-dropper'),
    (6,'تجميل','Cosmetics','fa-spa')`);

  // Default admin
  const hash = bcrypt.hashSync('admin123', 10);
  db.run(`INSERT OR IGNORE INTO admins (username,password) VALUES ('admin','${hash}')`);

  // Sample products
  db.run(`INSERT OR IGNORE INTO products (id,name,category_id,price,old_price,description,stock,badge) VALUES
    (1,'باراسيتامول 500mg',3,12,null,'مسكن للألم وخافض للحرارة','in',null),
    (2,'أموكسيسيلين 250mg',1,35,45,'مضاد حيوي واسع الطيف','in','sale'),
    (3,'شراب فيتامين C',2,28,38,'شراب مقوي للمناعة','in','sale'),
    (4,'قطرة أنف أوتريفين',5,19,null,'قطرة لفتح الاحتقان','in',null),
    (5,'كريم نيفيا',6,45,60,'كريم مرطب للبشرة','in','sale'),
    (6,'بروفين 400mg',3,18,null,'مضاد للالتهابات ومسكن','in',null)`);
});

// Auth
const auth = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
};

// Upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// ===== ROUTES =====

// Login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  db.get('SELECT * FROM admins WHERE username=?', [username], (err, admin) => {
    if (!admin || !bcrypt.compareSync(password, admin.password))
      return res.status(401).json({ error: 'بيانات خاطئة' });
    const token = jwt.sign({ id: admin.id }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token });
  });
});

// Categories
app.get('/api/categories', (req, res) => {
  db.all('SELECT * FROM categories', [], (err, rows) => res.json(rows));
});

// Products
app.get('/api/products', (req, res) => {
  const { category, search } = req.query;
  let sql = `SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id=c.id WHERE 1=1`;
  const params = [];
  if (category && category !== 'all') { sql += ' AND p.category_id=?'; params.push(category); }
  if (search) { sql += ' AND p.name LIKE ?'; params.push(`%${search}%`); }
  sql += ' ORDER BY p.created_at DESC';
  db.all(sql, params, (err, rows) => res.json(rows));
});

app.get('/api/products/:id', (req, res) => {
  db.get(`SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id=c.id WHERE p.id=?`,
    [req.params.id], (err, row) => {
      if (!row) return res.status(404).json({ error: 'Not found' });
      res.json(row);
    });
});

app.post('/api/products', auth, upload.single('image'), (req, res) => {
  const { name, category_id, price, old_price, description, stock, badge } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : null;
  db.run(`INSERT INTO products (name,category_id,price,old_price,description,image,stock,badge) VALUES (?,?,?,?,?,?,?,?)`,
    [name, category_id, price, old_price || null, description, image, stock || 'in', badge || null],
    function(err) { res.json({ id: this.lastID }); });
});

app.put('/api/products/:id', auth, upload.single('image'), (req, res) => {
  const { name, category_id, price, old_price, description, stock, badge } = req.body;
  db.get('SELECT image FROM products WHERE id=?', [req.params.id], (err, row) => {
    const image = req.file ? `/uploads/${req.file.filename}` : row?.image;
    db.run(`UPDATE products SET name=?,category_id=?,price=?,old_price=?,description=?,image=?,stock=?,badge=? WHERE id=?`,
      [name, category_id, price, old_price || null, description, image, stock, badge, req.params.id],
      () => res.json({ success: true }));
  });
});

app.delete('/api/products/:id', auth, (req, res) => {
  db.run('DELETE FROM products WHERE id=?', [req.params.id], () => res.json({ success: true }));
});

// Offers
app.get('/api/offers', (req, res) => {
  db.all('SELECT * FROM offers WHERE active=1', [], (err, rows) => res.json(rows));
});

app.post('/api/offers', auth, (req, res) => {
  const { title, description, discount } = req.body;
  db.run('INSERT INTO offers (title,description,discount) VALUES (?,?,?)',
    [title, description, discount || 0], function(err) { res.json({ id: this.lastID }); });
});

app.delete('/api/offers/:id', auth, (req, res) => {
  db.run('DELETE FROM offers WHERE id=?', [req.params.id], () => res.json({ success: true }));
});

// Orders
app.post('/api/orders', (req, res) => {
  const { customer_name, customer_phone, notes } = req.body;
  db.run('INSERT INTO orders (customer_name,customer_phone,notes) VALUES (?,?,?)',
    [customer_name, customer_phone, notes], function(err) { res.json({ id: this.lastID }); });
});

app.get('/api/orders', auth, (req, res) => {
  db.all('SELECT * FROM orders ORDER BY created_at DESC', [], (err, rows) => res.json(rows));
});

// Stats
app.get('/api/stats', auth, (req, res) => {
  db.get('SELECT COUNT(*) as products FROM products', [], (err, p) => {
    db.get('SELECT COUNT(*) as orders FROM orders', [], (err, o) => {
      db.get("SELECT COUNT(*) as in_stock FROM products WHERE stock='in'", [], (err, s) => {
        res.json({ products: p.products, orders: o.orders, in_stock: s.in_stock });
      });
    });
  });
});

app.listen(PORT, () => {
  console.log(`✅ Server: http://localhost:${PORT}`);
  console.log(`✅ Admin:  http://localhost:${PORT}/admin.html`);
  console.log(`👤 Login:  admin / admin123`);
});