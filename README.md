# Hair Style by Tiffany 💇🏾

A full-featured salon website with online booking, admin panel, and shop — built for **Hair Style by Tiffany** at 942 SE 28th St, Topeka, KS.

## ✨ Features

- **5-page website**: Home, Services, About, Portfolio, Contact
- **Online booking**: Interactive calendar with 3 stylists (Tiffany, Michelle, Keisha)
- **Admin panel**: Dashboard stats, manage bookings, services, settings
- **Shop**: Product listings with cart
- **Real database**: SQLite, persists across restarts (on Render: per-deployment)

## 🚀 Deploy on Render (Free)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)

### Manual steps:

1. **Push to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/hairstylebytiffany.git
   git push -u origin main
   ```

2. **On [Render.com](https://render.com):**
   - Click **New +** → **Web Service**
   - Connect your GitHub repo
   - Use these settings:
     - **Runtime**: Node
     - **Build Command**: `npm install`
     - **Start Command**: `npm start`
     - **Plan**: Free
   - Add environment variable: `RENDER = true`
   - Click **Create Web Service**

3. **Done!** Your URL will be `https://hairstylebytiffany.onrender.com`

## 🔐 Admin Access

- **URL**: `/admin` (click the ⚙️ icon bottom-right)
- **Username**: `admin`
- **Password**: `admin123`

## 🛠️ Local Development

```bash
npm install
npm start
```

Open `http://localhost:3033` in your browser.

## 📁 Project Structure

```
├── server.js          # Express API + static files
├── database.js        # SQLite schema + seed data
├── index.html         # Full SPA front-end (all 5 pages + booking + admin)
├── package.json
├── render.yaml        # Render deployment config
├── data/              # SQLite database (auto-created)
└── README.md
```

## 🧱 Tech Stack

- **Frontend**: HTML, Tailwind CSS, Vanilla JS (SPA)
- **Backend**: Node.js, Express 5
- **Database**: SQLite (better-sqlite3)
- **Auth**: bcryptjs + JWT