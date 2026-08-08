const express = require('express');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3033;
const fs = require('fs');

// Upload directory for images
const UPLOAD_DIR = process.env.RENDER ? '/tmp/uploads' : path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Multer storage config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '-'))
});
const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only images allowed (jpg, png, webp, gif)'));
  }
});

// Render deployment — ensure data directory persists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const JWT_SECRET = 'hsbt-salon-secret-key-2025';

app.use(cors());
app.use(express.json());

// ===================== MIDDLEWARE =====================
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.adminId = decoded.id;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ===================== AUTH =====================
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, username: user.username });
});

// ===================== STYLISTS =====================
app.get('/api/stylists', (req, res) => {
  const stylists = db.prepare('SELECT * FROM stylists WHERE active = 1').all();
  res.json(stylists);
});

app.post('/api/stylists', authMiddleware, (req, res) => {
  const { name, email, phone, bio } = req.body;
  const result = db.prepare('INSERT INTO stylists (name, email, phone, bio) VALUES (?, ?, ?, ?)').run(name, email, phone, bio);
  res.json({ id: result.lastInsertRowid });
});

app.put('/api/stylists/:id', authMiddleware, (req, res) => {
  const { name, email, phone, bio, active } = req.body;
  db.prepare('UPDATE stylists SET name=?, email=?, phone=?, bio=?, active=? WHERE id=?')
    .run(name, email, phone, bio, active ?? 1, req.params.id);
  res.json({ success: true });
});

// ===================== SERVICES =====================
app.get('/api/services', (req, res) => {
  const services = db.prepare('SELECT * FROM services WHERE active = 1').all();
  res.json(services);
});

app.post('/api/services', authMiddleware, (req, res) => {
  const { name, category, description, price_min, price_max, duration_min } = req.body;
  const result = db.prepare('INSERT INTO services (name, category, description, price_min, price_max, duration_min) VALUES (?, ?, ?, ?, ?, ?)')
    .run(name, category, description, price_min || 0, price_max || 0, duration_min || 60);
  res.json({ id: result.lastInsertRowid });
});

app.put('/api/services/:id', authMiddleware, (req, res) => {
  const { name, category, description, price_min, price_max, duration_min, active } = req.body;
  db.prepare('UPDATE services SET name=?, category=?, description=?, price_min=?, price_max=?, duration_min=?, active=? WHERE id=?')
    .run(name, category, description, price_min, price_max, duration_min, active ?? 1, req.params.id);
  res.json({ success: true });
});

app.delete('/api/services/:id', authMiddleware, (req, res) => {
  db.prepare('UPDATE services SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ===================== IMAGE UPLOAD =====================
app.post('/api/upload', authMiddleware, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const url = '/uploads/' + req.file.filename;
  res.json({ url, filename: req.file.filename });
});

app.post('/api/upload/portfolio', authMiddleware, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { category, caption } = req.body;
  const url = '/uploads/' + req.file.filename;
  const result = db.prepare('INSERT INTO portfolio_images (url, category, caption) VALUES (?, ?, ?)').run(url, category || 'braids', caption || '');
  res.json({ id: result.lastInsertRowid, url, category, caption });
});

app.get('/api/portfolio', (req, res) => {
  const images = db.prepare('SELECT * FROM portfolio_images ORDER BY created_at DESC').all();
  res.json(images);
});

app.delete('/api/portfolio/:id', authMiddleware, (req, res) => {
  const img = db.prepare('SELECT * FROM portfolio_images WHERE id = ?').get(req.params.id);
  if (img) {
    const filePath = path.join(UPLOAD_DIR, path.basename(img.url));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    db.prepare('DELETE FROM portfolio_images WHERE id = ?').run(req.params.id);
  }
  res.json({ success: true });
});

// ===================== BOOKINGS =====================
app.get('/api/bookings', authMiddleware, (req, res) => {
  const bookings = db.prepare(`
    SELECT b.*, s.name as stylist_name, sv.name as service_name
    FROM bookings b
    LEFT JOIN stylists s ON b.stylist_id = s.id
    LEFT JOIN services sv ON b.service_id = sv.id
    ORDER BY b.booking_date DESC, b.booking_time DESC
  `).all();
  res.json(bookings);
});

app.get('/api/bookings/upcoming', authMiddleware, (req, res) => {
  const bookings = db.prepare(`
    SELECT b.*, s.name as stylist_name, sv.name as service_name
    FROM bookings b
    LEFT JOIN stylists s ON b.stylist_id = s.id
    LEFT JOIN services sv ON b.service_id = sv.id
    WHERE b.booking_date >= date('now') AND b.status = 'confirmed'
    ORDER BY b.booking_date ASC, b.booking_time ASC
  `).all();
  res.json(bookings);
});

// Public: check availability & create booking
app.get('/api/availability', (req, res) => {
  const { date, stylist_id } = req.query;
  if (!date) return res.status(400).json({ error: 'Date required' });

  const stylists = stylist_id
    ? db.prepare('SELECT * FROM stylists WHERE id = ? AND active = 1').all(stylist_id)
    : db.prepare('SELECT * FROM stylists WHERE active = 1').all();

  const opening = '09:00';
  const closing = '18:00';
  const slotInterval = 60; // minutes

  const bookedSlots = db.prepare(`
    SELECT stylist_id, booking_time FROM bookings
    WHERE booking_date = ? AND status = 'confirmed'
  `).all(date);

  const result = stylists.map(stylist => {
    const booked = bookedSlots.filter(b => b.stylist_id === stylist.id).map(b => b.booking_time);
    const slots = [];
    let [h, m] = opening.split(':').map(Number);
    const [closeH, closeM] = closing.split(':').map(Number);
    while (h < closeH || (h === closeH && m < closeM)) {
      const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      const display = `${h > 12 ? h - 12 : h || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
      if (!booked.includes(timeStr)) {
        slots.push({ time: timeStr, display });
      }
      m += slotInterval;
      if (m >= 60) { h++; m = 0; }
    }
    return { id: stylist.id, name: stylist.name, slots };
  });

  res.json(result);
});

app.post('/api/bookings', (req, res) => {
  const { stylist_id, service_id, client_name, client_email, client_phone, booking_date, booking_time, notes } = req.body;
  
  // Validate no double booking
  const existing = db.prepare('SELECT id FROM bookings WHERE stylist_id = ? AND booking_date = ? AND booking_time = ? AND status = ?')
    .get(stylist_id, booking_date, booking_time, 'confirmed');
  if (existing) return res.status(409).json({ error: 'This time slot is already booked' });

  const result = db.prepare(`
    INSERT INTO bookings (stylist_id, service_id, client_name, client_email, client_phone, booking_date, booking_time, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(stylist_id, service_id, client_name, client_email, client_phone, booking_date, booking_time, notes || null);

  res.json({ id: result.lastInsertRowid, message: 'Booking confirmed!' });
});

app.put('/api/bookings/:id/status', authMiddleware, (req, res) => {
  const { status } = req.body;
  db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ success: true });
});

// ===================== SHOP =====================
app.get('/api/products', (req, res) => {
  const products = db.prepare('SELECT * FROM shop_products WHERE active = 1').all();
  res.json(products);
});

app.post('/api/products', authMiddleware, (req, res) => {
  const { name, description, price, category, image_url } = req.body;
  const result = db.prepare('INSERT INTO shop_products (name, description, price, category, image_url) VALUES (?, ?, ?, ?, ?)')
    .run(name, description, price, category, image_url);
  res.json({ id: result.lastInsertRowid });
});

// ===================== DASHBOARD STATS =====================
app.get('/api/stats', authMiddleware, (req, res) => {
  const today = db.prepare(`SELECT COUNT(*) as count FROM bookings WHERE booking_date = date('now') AND status = 'confirmed'`).get();
  const week = db.prepare(`SELECT COUNT(*) as count FROM bookings WHERE booking_date >= date('now', '-7 days') AND status = 'confirmed'`).get();
  const month = db.prepare(`SELECT COUNT(*) as count FROM bookings WHERE strftime('%Y-%m', booking_date) = strftime('%Y-%m', 'now') AND status = 'confirmed'`).get();
  const totalClients = db.prepare(`SELECT COUNT(DISTINCT client_email) as count FROM bookings`).get();
  const totalRevenue = db.prepare(`
    SELECT COALESCE(SUM(sv.price_min), 0) as total FROM bookings b
    JOIN services sv ON b.service_id = sv.id
    WHERE b.status = 'confirmed'
  `).get();

  res.json({
    today: today.count,
    week: week.count,
    month: month.count,
    totalClients: totalClients.count,
    totalRevenue: totalRevenue.total
  });
});

// ===================== SETTINGS =====================
app.get('/api/settings', (req, res) => {
  const settings = db.prepare('SELECT * FROM business_settings').all();
  const obj = {};
  settings.forEach(s => { obj[s.key] = s.value; });
  res.json(obj);
});

app.put('/api/settings', authMiddleware, (req, res) => {
  const upsert = db.prepare('INSERT OR REPLACE INTO business_settings (key, value) VALUES (?, ?)');
  const transaction = db.transaction((settings) => {
    for (const [key, value] of Object.entries(settings)) {
      upsert.run(key, value);
    }
  });
  transaction(req.body);
  res.json({ success: true });
});

// ===================== STATIC FILES =====================
app.use(express.static(__dirname));
app.use('/uploads', express.static(UPLOAD_DIR));

// Serve index.html for all non-API routes (SPA fallback)
app.use((req, res, next) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(__dirname + '/index.html');
  } else {
    next();
  }
});

// ===================== START =====================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Hair Style by Tiffany — Server running on http://0.0.0.0:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/#admin`);
  console.log(`Login: admin / admin123`);
});