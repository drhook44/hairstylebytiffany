const Database = require('better-sqlite3');
const path = require('path');

// Use /tmp for Render (ephemeral but writable), local dir otherwise
const DB_PATH = process.env.RENDER 
  ? '/tmp/salon.db' 
  : path.join(__dirname, 'data', 'salon.db');

// Ensure data directory exists
const fs = require('fs');
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS stylists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    phone TEXT,
    bio TEXT,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT,
    description TEXT,
    price_min REAL,
    price_max REAL,
    duration_min INTEGER DEFAULT 60,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    FOREIGN KEY (stylist_id) REFERENCES stylists(id),
    FOREIGN KEY (service_id) REFERENCES services(id)
  );

  CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS shop_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL,
    category TEXT,
    image_url TEXT,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS business_settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Insert default data if empty
const stylistCount = db.prepare('SELECT COUNT(*) as c FROM stylists').get();
if (stylistCount.c === 0) {
  const insertStylist = db.prepare('INSERT INTO stylists (name, email, phone, bio) VALUES (?, ?, ?, ?)');
  insertStylist.run('Tiffany', 'tiffany@hairstylebytiffany.com', '(785) 555-0123', 'Owner & Lead Braider. 8+ years of experience in protective styling.');
  insertStylist.run('Michelle', 'michelle@hairstylebytiffany.com', '(785) 555-0124', 'Senior stylist specializing in box braids and twists.');
  insertStylist.run('Keisha', 'keisha@hairstylebytiffany.com', '(785) 555-0125', 'Natural hair care specialist and loc retwist expert.');
}

const serviceCount = db.prepare('SELECT COUNT(*) as c FROM services').get();
if (serviceCount.c === 0) {
  const insertService = db.prepare('INSERT INTO services (name, category, description, price_min, price_max, duration_min) VALUES (?, ?, ?, ?, ?, ?)');
  insertService.run('Box Braids (Small)', 'Braids', 'Small box braids, waist-length', 200, 240, 240);
  insertService.run('Box Braids (Medium)', 'Braids', 'Medium box braids', 160, 200, 180);
  insertService.run('Box Braids (Jumbo)', 'Braids', 'Jumbo box braids', 140, 180, 120);
  insertService.run('Goddess Braids', 'Braids', 'With curly ends', 200, 260, 240);
  insertService.run('Feed-in Braids', 'Braids', 'Feed-in braiding technique', 130, 170, 150);
  insertService.run('Straight-back Cornrows', 'Cornrows', 'Classic straight-back cornrows', 90, 120, 90);
  insertService.run('Design Cornrows', 'Cornrows', 'Custom design cornrow patterns', 110, 150, 120);
  insertService.run('Senegalese Twists', 'Twists', 'Medium Senegalese twists', 170, 220, 180);
  insertService.run('Kinky Twists', 'Twists', 'Kinky twist installation', 160, 210, 180);
  insertService.run('Passion Twists', 'Twists', 'Passion twist style', 190, 240, 210);
  insertService.run('Butterfly Locs', 'Locs', 'Butterfly locs installation', 230, 280, 240);
  insertService.run('Loc Retwist', 'Locs', 'Retwist and style maintenance', 70, 100, 60);
  insertService.run('Loc Maintenance', 'Locs', 'Full loc maintenance service', 90, 130, 90);
  insertService.run('Silk Press', 'Natural Hair', 'Silk press with heat protectant', 60, 85, 60);
  insertService.run('Deep Conditioning', 'Natural Hair', 'Deep conditioning treatment', 35, 55, 45);
  insertService.run('Scalp Treatment', 'Natural Hair', 'Therapeutic scalp treatment', 30, 45, 30);
  insertService.run('Crochet Braids', 'Extensions', 'Crochet braid installation', 130, 170, 120);
  insertService.run('Faux Locs (Classic)', 'Extensions', 'Classic faux locs', 230, 280, 240);
  insertService.run('Faux Locs (Bohemian)', 'Extensions', 'Bohemian faux locs with curl', 250, 300, 270);
}

// Insert default admin user (admin / admin123)
const adminCount = db.prepare('SELECT COUNT(*) as c FROM admin_users').get();
if (adminCount.c === 0) {
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)').run('admin', hash);
}

// Default settings
const insertSetting = db.prepare('INSERT OR IGNORE INTO business_settings (key, value) VALUES (?, ?)');
insertSetting.run('business_name', 'Hair Style by Tiffany');
insertSetting.run('address', '942 SE 28th St, Topeka, KS 66605');
insertSetting.run('phone', '(785) 555-0123');
insertSetting.run('email', 'hello@hairstylebytiffany.com');
insertSetting.run('hours', 'Mon-Fri 9am-6pm, Sat 9am-4pm, Sun Closed');
insertSetting.run('opening_time', '09:00');
insertSetting.run('closing_time', '18:00');
insertSetting.run('slot_interval', '60');

console.log('Database initialized successfully.');
module.exports = db;