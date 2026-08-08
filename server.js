const express = require('express');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const db = require('./database');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3033;
const JWT_SECRET = 'hsbt-whitelabel-secret-2025';

// Upload dir
const UPLOAD_DIR = process.env.RENDER ? '/tmp/uploads' : path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '-'))
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    cb(null, allowed.includes(file.mimetype));
  }
});

app.use(cors());
app.use(express.json());

// ===== TENANT RESOLVER =====
app.use((req, res, next) => {
  const host = req.headers.host || '';
  const match = host.match(/^([a-z0-9-]+)\./);
  const subdomain = match ? match[1] : null;
  if (!subdomain || subdomain === 'www' || subdomain === 'app' || subdomain === 'api') {
    req.tenant = null;
    return next();
  }
  const tenant = db.prepare('SELECT * FROM tenants WHERE subdomain = ? AND is_active = 1').get(subdomain);
  if (!tenant && !req.path.startsWith('/api')) {
    req.tenant = null;
    return next();
  }
  req.tenant = tenant;
  next();
});

// ===== MIDDLEWARE =====
function superAdminAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
    req.adminId = decoded.id;
    next();
  } catch (e) { return res.status(401).json({ error: 'Invalid token' }); }
}

function tenantAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.tenantAuth = decoded;
    next();
  } catch (e) { return res.status(401).json({ error: 'Invalid token' }); }
}

// ===== SUPER ADMIN AUTH =====
app.post('/api/superadmin/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM admin_users WHERE username = ? AND role = ?').get(username, 'superadmin');
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ id: user.id, username: user.username, role: 'superadmin' }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, username: user.username, role: 'superadmin' });
});

// ===== TENANT AUTH =====
app.post('/api/tenant/login', (req, res) => {
  const { username, password, tenant_id } = req.body;
  const admin = db.prepare('SELECT * FROM tenant_admins WHERE tenant_id = ? AND username = ?').get(tenant_id, username);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenant_id);
  const token = jwt.sign({
    id: admin.id, username: admin.username,
    tenant_id: admin.tenant_id, role: 'tenant_admin',
    subdomain: tenant?.subdomain
  }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, username: admin.username, role: 'tenant_admin', tenant });
});

// ===== SUPER ADMIN: TENANTS =====
app.get('/api/superadmin/tenants', superAdminAuth, (req, res) => {
  const tenants = db.prepare(`
    SELECT t.*, tp.plan, tp.status as plan_status,
    (SELECT COUNT(*) FROM bookings b WHERE b.tenant_id = t.id) as total_bookings
    FROM tenants t LEFT JOIN tenant_plans tp ON tp.tenant_id = t.id ORDER BY t.created_at DESC
  `).all();
  res.json(tenants);
});

app.post('/api/superadmin/tenants', superAdminAuth, (req, res) => {
  const { subdomain, business_name, owner_name, owner_email, owner_phone, address, password } = req.body;
  if (!subdomain || !business_name || !owner_email || !password) {
    return res.status(400).json({ error: 'subdomain, business_name, owner_email, password required' });
  }
  if (db.prepare('SELECT id FROM tenants WHERE subdomain = ?').get(subdomain)) {
    return res.status(409).json({ error: 'Subdomain taken' });
  }
  const r = db.prepare('INSERT INTO tenants (subdomain, business_name, owner_name, owner_email, owner_phone, address) VALUES (?, ?, ?, ?, ?, ?)')
    .run(subdomain, business_name, owner_name, owner_email, owner_phone, address);
  const tid = r.lastInsertRowid;
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO tenant_admins (tenant_id, username, password_hash) VALUES (?, ?, ?)').run(tid, 'admin', hash);
  db.prepare('INSERT INTO tenant_plans (tenant_id, plan, status) VALUES (?, ?, ?)').run(tid, 'free', 'active');
  db.prepare('INSERT INTO stylists (tenant_id, name, bio) VALUES (?, ?, ?)').run(tid, owner_name || business_name, 'Owner & stylist');
  const ins = db.prepare('INSERT INTO services (tenant_id, name, category, price_min, price_max, duration_min) VALUES (?, ?, ?, ?, ?, ?)');
  ins.run(tid, 'Box Braids', 'Braids', 160, 220, 180);
  ins.run(tid, 'Cornrows', 'Cornrows', 90, 130, 90);
  ins.run(tid, 'Twists', 'Twists', 170, 220, 180);
  res.json({ id: tid, subdomain, message: 'Tenant created!' });
});

app.put('/api/superadmin/tenants/:id', superAdminAuth, (req, res) => {
  const { business_name, owner_name, owner_email, subdomain, is_active } = req.body;
  db.prepare('UPDATE tenants SET business_name=?, owner_name=?, owner_email=?, subdomain=?, is_active=? WHERE id=?')
    .run(business_name, owner_name, owner_email, subdomain, is_active ?? 1, req.params.id);
  res.json({ success: true });
});

app.put('/api/superadmin/tenants/:id/plan', superAdminAuth, (req, res) => {
  const { plan, status } = req.body;
  db.prepare('UPDATE tenant_plans SET plan=?, status=? WHERE tenant_id=?').run(plan, status, req.params.id);
  res.json({ success: true });
});

// ===== PUBLIC TENANT API =====
app.get('/api/tenant-by-subdomain/:subdomain', (req, res) => {
  const tenant = db.prepare('SELECT id, subdomain, business_name, address, hours, logo_url, hero_color FROM tenants WHERE subdomain = ? AND is_active = 1').get(req.params.subdomain);
  if (!tenant) return res.status(404).json({ error: 'Not found' });
  const stylists = db.prepare('SELECT id, name, bio FROM stylists WHERE tenant_id = ? AND active = 1').all(tenant.id);
  const services = db.prepare('SELECT id, name, category, description, price_min, price_max, duration_min FROM services WHERE tenant_id = ? AND active = 1').all(tenant.id);
  const portfolio = db.prepare('SELECT id, url, category, caption FROM portfolio_images WHERE tenant_id = ? ORDER BY created_at DESC').all(tenant.id);
  res.json({ tenant, stylists, services, portfolio });
});

app.get('/api/tenant/:tenantId/services', (req, res) => {
  res.json(db.prepare('SELECT * FROM services WHERE tenant_id = ? AND active = 1').all(req.params.tenantId));
});

app.get('/api/tenant/:tenantId/stylists', (req, res) => {
  res.json(db.prepare('SELECT * FROM stylists WHERE tenant_id = ? AND active = 1').all(req.params.tenantId));
});

app.get('/api/tenant/:tenantId/availability', (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'Date required' });
  const tid = req.params.tenantId;
  const stylists = db.prepare('SELECT * FROM stylists WHERE tenant_id = ? AND active = 1').all(tid);
  const booked = db.prepare('SELECT stylist_id, booking_time FROM bookings WHERE tenant_id = ? AND booking_date = ? AND status = ?').all(tid, date, 'confirmed');
  const result = stylists.map(stylist => {
    const taken = booked.filter(b => b.stylist_id === stylist.id).map(b => b.booking_time);
    const slots = [];
    for (let h = 9; h < 18; h++) {
      const time = `${String(h).padStart(2,'0')}:00`;
      const display = `${h > 12 ? h-12 : h || 12}:00 ${h >= 12 ? 'PM' : 'AM'}`;
      if (!taken.includes(time)) slots.push({ time, display });
    }
    return { id: stylist.id, name: stylist.name, slots };
  });
  res.json(result);
});

app.post('/api/tenant/:tenantId/bookings', (req, res) => {
  const tid = req.params.tenantId;
  const { stylist_id, service_id, client_name, client_email, client_phone, booking_date, booking_time, notes } = req.body;
  if (db.prepare('SELECT id FROM bookings WHERE tenant_id = ? AND stylist_id = ? AND booking_date = ? AND booking_time = ? AND status = ?').get(tid, stylist_id, booking_date, booking_time, 'confirmed')) {
    return res.status(409).json({ error: 'Time slot taken' });
  }
  const r = db.prepare('INSERT INTO bookings (tenant_id, stylist_id, service_id, client_name, client_email, client_phone, booking_date, booking_time, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(tid, stylist_id, service_id, client_name, client_email, client_phone, booking_date, booking_time, notes || null);
  res.json({ id: r.lastInsertRowid, message: 'Booking confirmed!' });
});

// ===== TENANT ADMIN API =====
app.get('/api/tenant-admin/settings', tenantAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM tenants WHERE id = ?').get(req.tenantAuth.tenant_id));
});

app.put('/api/tenant-admin/settings', tenantAuth, (req, res) => {
  const { business_name, address, hours, opening_time, closing_time, slot_interval, logo_url, hero_color, owner_name, owner_phone } = req.body;
  db.prepare('UPDATE tenants SET business_name=?, address=?, hours=?, opening_time=?, closing_time=?, slot_interval=?, logo_url=?, hero_color=?, owner_name=?, owner_phone=? WHERE id=?')
    .run(business_name, address, hours, opening_time, closing_time, slot_interval, logo_url, hero_color, owner_name, owner_phone, req.tenantAuth.tenant_id);
  res.json({ success: true });
});

app.get('/api/tenant-admin/stylists', tenantAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM stylists WHERE tenant_id = ?').all(req.tenantAuth.tenant_id));
});
app.post('/api/tenant-admin/stylists', tenantAuth, (req, res) => {
  const { name, email, phone, bio } = req.body;
  const r = db.prepare('INSERT INTO stylists (tenant_id, name, email, phone, bio) VALUES (?, ?, ?, ?, ?)').run(req.tenantAuth.tenant_id, name, email, phone, bio);
  res.json({ id: r.lastInsertRowid });
});
app.put('/api/tenant-admin/stylists/:id', tenantAuth, (req, res) => {
  const { name, email, phone, bio, active } = req.body;
  db.prepare('UPDATE stylists SET name=?, email=?, phone=?, bio=?, active=? WHERE id=? AND tenant_id=?')
    .run(name, email, phone, bio, active ?? 1, req.params.id, req.tenantAuth.tenant_id);
  res.json({ success: true });
});

app.get('/api/tenant-admin/services', tenantAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM services WHERE tenant_id = ?').all(req.tenantAuth.tenant_id));
});
app.post('/api/tenant-admin/services', tenantAuth, (req, res) => {
  const { name, category, description, price_min, price_max, duration_min } = req.body;
  const r = db.prepare('INSERT INTO services (tenant_id, name, category, description, price_min, price_max, duration_min) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(req.tenantAuth.tenant_id, name, category, description, price_min, price_max, duration_min);
  res.json({ id: r.lastInsertRowid });
});
app.put('/api/tenant-admin/services/:id', tenantAuth, (req, res) => {
  const { name, category, description, price_min, price_max, duration_min, active } = req.body;
  db.prepare('UPDATE services SET name=?, category=?, description=?, price_min=?, price_max=?, duration_min=?, active=? WHERE id=? AND tenant_id=?')
    .run(name, category, description, price_min, price_max, duration_min, active ?? 1, req.params.id, req.tenantAuth.tenant_id);
  res.json({ success: true });
});
app.delete('/api/tenant-admin/services/:id', tenantAuth, (req, res) => {
  db.prepare('UPDATE services SET active = 0 WHERE id = ? AND tenant_id = ?').run(req.params.id, req.tenantAuth.tenant_id);
  res.json({ success: true });
});

app.get('/api/tenant-admin/bookings', tenantAuth, (req, res) => {
  res.json(db.prepare(`
    SELECT b.*, s.name as stylist_name, sv.name as service_name
    FROM bookings b LEFT JOIN stylists s ON b.stylist_id = s.id LEFT JOIN services sv ON b.service_id = sv.id
    WHERE b.tenant_id = ? ORDER BY b.booking_date DESC
  `).all(req.tenantAuth.tenant_id));
});
app.put('/api/tenant-admin/bookings/:id/status', tenantAuth, (req, res) => {
  const { status } = req.body;
  db.prepare('UPDATE bookings SET status = ? WHERE id = ? AND tenant_id = ?').run(status, req.params.id, req.tenantAuth.tenant_id);
  res.json({ success: true });
});

app.get('/api/tenant-admin/stats', tenantAuth, (req, res) => {
  const tid = req.tenantAuth.tenant_id;
  const today = db.prepare("SELECT COUNT(*) as c FROM bookings WHERE tenant_id = ? AND booking_date = date('now') AND status = 'confirmed'").get(tid);
  const week = db.prepare("SELECT COUNT(*) as c FROM bookings WHERE tenant_id = ? AND booking_date >= date('now', '-7 days') AND status = 'confirmed'").get(tid);
  const month = db.prepare("SELECT COUNT(*) as c FROM bookings WHERE tenant_id = ? AND strftime('%Y-%m', booking_date) = strftime('%Y-%m', 'now') AND status = 'confirmed'").get(tid);
  const clients = db.prepare("SELECT COUNT(DISTINCT client_email) as c FROM bookings WHERE tenant_id = ?").get(tid);
  res.json({ today: today.c, week: week.c, month: month.c, totalClients: clients.c });
});

// ===== MEDIA =====
app.post('/api/tenant-admin/upload', tenantAuth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const url = '/uploads/' + req.file.filename;
  const { category, caption } = req.body;
  const r = db.prepare('INSERT INTO portfolio_images (tenant_id, url, category, caption) VALUES (?, ?, ?, ?)').run(req.tenantAuth.tenant_id, url, category || 'braids', caption || '');
  res.json({ id: r.lastInsertRowid, url });
});
app.get('/api/tenant-admin/portfolio', tenantAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM portfolio_images WHERE tenant_id = ? ORDER BY created_at DESC').all(req.tenantAuth.tenant_id));
});
app.delete('/api/tenant-admin/portfolio/:id', tenantAuth, (req, res) => {
  const img = db.prepare('SELECT * FROM portfolio_images WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantAuth.tenant_id);
  if (img) {
    const fp = path.join(UPLOAD_DIR, path.basename(img.url));
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    db.prepare('DELETE FROM portfolio_images WHERE id = ? AND tenant_id = ?').run(req.params.id, req.tenantAuth.tenant_id);
  }
  res.json({ success: true });
});

// ===== SHOP =====
app.get('/api/tenant-admin/products', tenantAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM shop_products WHERE tenant_id = ? AND active = 1').all(req.tenantAuth.tenant_id));
});
app.post('/api/tenant-admin/products', tenantAuth, (req, res) => {
  const { name, description, price, category, image_url } = req.body;
  const r = db.prepare('INSERT INTO shop_products (tenant_id, name, description, price, category, image_url) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.tenantAuth.tenant_id, name, description, price, category, image_url);
  res.json({ id: r.lastInsertRowid });
});

// ===== STATIC FILES & SPA =====
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname)));

// Catch-all: serve index.html for SPA routes
app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API route not found' });
  }
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ===== START =====
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Hair Style by Tiffany — White Label Platform`);
  console.log(`   Server: http://0.0.0.0:${PORT}`);
  console.log(`   Super Admin: /#superadmin — admin / admin123`);
  console.log(`   Demo tenant: tiffany — admin / salon123`);
});