const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.RENDER ? '/tmp/salon.db' : path.join(__dirname, 'data', 'salon.db');

const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ===================== MULTI-TENANT SCHEMA =====================
db.exec(`
  -- Tenants (each salon is a tenant)
  CREATE TABLE IF NOT EXISTS tenants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subdomain TEXT UNIQUE NOT NULL,
    business_name TEXT NOT NULL DEFAULT 'My Salon',
    owner_name TEXT,
    owner_email TEXT UNIQUE,
    owner_phone TEXT,
    address TEXT,
    hours TEXT DEFAULT 'Mon-Fri 9am-6pm, Sat 9am-4pm, Sun Closed',
    opening_time TEXT DEFAULT '09:00',
    closing_time TEXT DEFAULT '18:00',
    slot_interval INTEGER DEFAULT 60,
    logo_url TEXT,
    hero_color TEXT DEFAULT '#b45309',
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- Plan / subscription tracking
  CREATE TABLE IF NOT EXISTS tenant_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    plan TEXT DEFAULT 'free',
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    status TEXT DEFAULT 'active',
    expires_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
  );

  -- Stylists (per tenant)
  CREATE TABLE IF NOT EXISTS stylists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    bio TEXT,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
  );

  -- Services (per tenant)
  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    category TEXT,
    description TEXT,
    price_min REAL,
    price_max REAL,
    duration_min INTEGER DEFAULT 60,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
  );

  -- Bookings (per tenant)
  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    stylist_id INTEGER,
    service_id INTEGER,
    client_name TEXT NOT NULL,
    client_email TEXT NOT NULL,
    client_phone TEXT,
    booking_date TEXT NOT NULL,
    booking_time TEXT NOT NULL,
    duration_min INTEGER DEFAULT 60,
    notes TEXT,
    status TEXT DEFAULT 'confirmed',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    FOREIGN KEY (stylist_id) REFERENCES stylists(id),
    FOREIGN KEY (service_id) REFERENCES services(id)
  );

  -- Admin users (super admin only — manages tenants)
  CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'superadmin',
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- Tenant admin access (each salon owner can log in to their own panel)
  CREATE TABLE IF NOT EXISTS tenant_admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
  );

  -- Shop products (per tenant)
  CREATE TABLE IF NOT EXISTS shop_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL,
    category TEXT,
    image_url TEXT,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
  );

  -- Portfolio images (per tenant)
  CREATE TABLE IF NOT EXISTS portfolio_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    url TEXT NOT NULL,
    category TEXT DEFAULT 'braids',
    caption TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
  );
`);

// ===================== SEED DATA =====================

// Create default super admin
const adminCount = db.prepare('SELECT COUNT(*) as c FROM admin_users').get();
if (adminCount.c === 0) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO admin_users (username, password_hash, role) VALUES (?, ?, ?)').run('admin', hash, 'superadmin');
}

// Create a demo tenant if none exist
const tenantCount = db.prepare('SELECT COUNT(*) as c FROM tenants').get();
if (tenantCount.c === 0) {
  const info = db.prepare('INSERT INTO tenants (subdomain, business_name, owner_name, owner_email, address, hours, opening_time, closing_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const result = info.run('tiffany', 'Hair Style by Tiffany', 'Tiffany', 'tiffany@hairstylebytiffany.com', '942 SE 28th St, Topeka, KS 66605', 'Mon-Fri 9am-6pm, Sat 9am-4pm, Sun Closed', '09:00', '18:00');
  const tenantId = result.lastInsertRowid;

  // Tenant admin login
  const hash = bcrypt.hashSync('salon123', 10);
  db.prepare('INSERT INTO tenant_admins (tenant_id, username, password_hash) VALUES (?, ?, ?)').run(tenantId, 'admin', hash);

  // Default stylists
  const insStylist = db.prepare('INSERT INTO stylists (tenant_id, name, email, phone, bio) VALUES (?, ?, ?, ?, ?)');
  insStylist.run(tenantId, 'Tiffany', 'tiffany@hairstylebytiffany.com', '(785) 555-0123', 'Owner & Lead Braider. 8+ years of experience.');
  insStylist.run(tenantId, 'Michelle', 'michelle@hairstylebytiffany.com', '(785) 555-0124', 'Senior stylist specializing in box braids and twists.');
  insStylist.run(tenantId, 'Keisha', 'keisha@hairstylebytiffany.com', '(785) 555-0125', 'Natural hair care specialist and loc retwist expert.');

  // Default services
  const insSvc = db.prepare('INSERT INTO services (tenant_id, name, category, description, price_min, price_max, duration_min) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const svcs = [
    ['Box Braids (Small)', 'Braids', 'Small box braids, waist-length', 200, 240, 240],
    ['Box Braids (Medium)', 'Braids', 'Medium box braids', 160, 200, 180],
    ['Box Braids (Jumbo)', 'Braids', 'Jumbo box braids', 140, 180, 120],
    ['Goddess Braids', 'Braids', 'With curly ends', 200, 260, 240],
    ['Feed-in Braids', 'Braids', 'Feed-in braiding technique', 130, 170, 150],
    ['Straight-back Cornrows', 'Cornrows', 'Classic straight-back cornrows', 90, 120, 90],
    ['Design Cornrows', 'Cornrows', 'Custom design cornrow patterns', 110, 150, 120],
    ['Senegalese Twists', 'Twists', 'Medium Senegalese twists', 170, 220, 180],
    ['Kinky Twists', 'Twists', 'Kinky twist installation', 160, 210, 180],
    ['Passion Twists', 'Twists', 'Passion twist style', 190, 240, 210],
    ['Butterfly Locs', 'Locs', 'Butterfly locs installation', 230, 280, 240],
    ['Loc Retwist', 'Locs', 'Retwist and style maintenance', 70, 100, 60],
    ['Silk Press', 'Natural Hair', 'Silk press with heat protectant', 60, 85, 60],
    ['Deep Conditioning', 'Natural Hair', 'Deep conditioning treatment', 35, 55, 45],
    ['Crochet Braids', 'Extensions', 'Crochet braid installation', 130, 170, 120],
    ['Faux Locs (Classic)', 'Extensions', 'Classic faux locs', 230, 280, 240],
  ];
  for (const s of svcs) insSvc.run(tenantId, ...s);

  // Default plan (free)
  db.prepare('INSERT INTO tenant_plans (tenant_id, plan, status) VALUES (?, ?, ?)').run(tenantId, 'free', 'active');

  console.log('Demo tenant created: tiffany (subdomain) — login: admin / salon123');
}

console.log('Multi-tenant database initialized successfully.');
module.exports = db;