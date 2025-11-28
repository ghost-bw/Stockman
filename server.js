require('dotenv').config();
console.log("Loaded API Key:", process.env.COMPANY_API_KEY);

const express = require("express");
const axios = require("axios");
const cors = require("cors");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");
const bcrypt = require("bcrypt");
const session = require("express-session");
const { promisify } = require("util");
require("dotenv").config();

const app = express();
const saltRounds = 10;
const FINNHUB_API_KEY =
  process.env.FINNHUB_API_KEY || "d4bod39r01qoua30pi80d4bod39r01qoua30pi8g";

// --- middlewares ---
app.use(cors());
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Add request logger middleware
app.use((req, res, next) => {
  console.log(`📨 ${req.method} ${req.path}`);
  next();
});

app.use(
  session({
    secret: "supersecretkey123",
    resave: false,
    saveUninitialized: false,
  })
);



// --- SQLite setup ---
const dbPath = path.join(__dirname, "portfolio.db");
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error("Failed to open DB:", err);
  else console.log("Connected to SQLite database:", dbPath);
});
db.run("PRAGMA foreign_keys = ON");

// promisified helpers
const dbGet = promisify(db.get.bind(db));
const dbAll = promisify(db.all.bind(db));
const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });

// --- apply schema.sql if exists ---
const schemaPath = path.join(__dirname, "schema.sql");
if (fs.existsSync(schemaPath)) {
  const schemaSql = fs.readFileSync(schemaPath, "utf8");
  db.exec(schemaSql, (err) => {
    if (err) console.error("Error applying schema.sql:", err);
    else console.log("schema.sql applied (or already applied).");
  });
} else {
  console.log("No schema.sql found — ensure DB already has tables (portfolio.db).");
}

// ---------- seed demo user/account if missing ----------
(async () => {
  try {
    const demoEmail = "test@example.com";
    const demoUser = await dbGet(`SELECT * FROM User WHERE email = ?`, [
      demoEmail,
    ]);
    if (!demoUser) {
      const hashed = await bcrypt.hash("password", saltRounds);
      const insertUser = await dbRun(
        `INSERT INTO User (username, email, password_hash) VALUES (?, ?, ?)`,
        ["testuser", demoEmail, hashed]
      );
      const userId = insertUser.lastID;
      console.log("Inserted demo user id=", userId);

      await dbRun(
        `INSERT INTO Account (user_id, cash, equity) VALUES (?, ?, ?)`,
        [userId, 100000.0, 100000.0]
      );
      console.log("Inserted demo account for user", userId);
    } else {
      console.log("Demo user exists:", demoUser.email);
      const acct = await dbGet(
        `SELECT * FROM Account WHERE user_id = ?`,
        [demoUser.user_id]
      );
      if (!acct) {
        await dbRun(
          `INSERT INTO Account (user_id, cash, equity) VALUES (?, ?, ?)`,
          [demoUser.user_id, 100000.0, 100000.0]
        );
        console.log("Inserted missing account for demo user.");
      }
    }
  } catch (e) {
    console.error("Demo seed error:", e);
  }
})();


// ---------- helpers ----------
async function fetchFinnhub(url) {
  try {
    const { data } = await axios.get(url);
    return data;
  } catch (e) {
    console.warn("Finnhub fetch error:", e.message);
    return null;
  }
}

// ---------- routes ----------

//market page
const NEWS_API_KEY = process.env.NEWS_API_KEY;

// MARKET NEWS ROUTE
app.get('/api/market-news', async (req, res) => {
  try {
    const url = `https://newsapi.org/v2/top-headlines?category=business&language=en&apiKey=${NEWS_API_KEY}`;
    
    const response = await axios.get(url);
    res.json(response.data.articles);
  } catch (error) {
    console.error("Error fetching news:", error.message);
    res.status(500).json({ error: "Failed to load news" });
  }
});

// Serve login page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Serve registration page
app.get("/register", (req, res) => {
  res.sendFile(path.join(__dirname, "registration.html"));
});

// REGISTER
app.post("/register", async (req, res) => {
  try {
    const { email, username, password } = req.body;
    if (!email || !username || !password)
      return res.status(400).send("Missing fields");

    const existing = await dbGet(`SELECT * FROM User WHERE email = ?`, [email]);
    if (existing) return res.status(400).send("Email already registered");

    const hashed = await bcrypt.hash(password, saltRounds);
    const result = await dbRun(
      `INSERT INTO User (email, username, password_hash) VALUES (?, ?, ?)`,
      [email, username, hashed]
    );
    const userId = result.lastID;
    await dbRun(
      `INSERT INTO Account (user_id, cash, equity) VALUES (?, ?, ?)`,
      [userId, 100000.0, 100000.0]
    );
    return res.status(201).send("Registered. You can now log in.");
  } catch (e) {
    console.error("Register error:", e);
    return res.status(500).send("Server error during register");
  }
});

// LOGIN
app.post("/page1.html", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.redirect("/");

    const user = await dbGet(`SELECT * FROM User WHERE email = ?`, [email]);
    if (!user) {
      return res
        .status(401)
        .send("No account with that email found. Please register.");
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).send("Incorrect password.");

    req.session.user_id = user.user_id;
    return res.sendFile(path.join(__dirname, "page1.html"));
  } catch (e) {
    console.error("Login error:", e);
    return res.status(500).send("Login error");
  }
});

// Serve portfolio (page1) only if logged in via session
app.get('/page1.html', (req, res) => {
  try {
    if (req.session && req.session.user_id) {
      return res.sendFile(path.join(__dirname, 'page1.html'));
    }
    // Not logged in -> send Login page
    return res.redirect('/Login.html');
  } catch (e) {
    console.error('Error serving page1:', e);
    return res.status(500).send('Server error');
  }
});

// LOGOUT
app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.sendStatus(200);
  });
});

// QUOTE (Finnhub)
app.get("/api/quote", async (req, res) => {
  const symbol = (req.query.symbol || "").toUpperCase();
  if (!symbol) return res.status(400).json({ error: "Missing symbol" });

  const url = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_API_KEY}`;

  try {
    const data = await fetchFinnhub(url);
    if (!data) return res.status(500).json({ error: "Failed to fetch quote" });

    return res.json({
      price: data.c,
      change: data.d,
      changePercent: data.dp,
      high: data.h,
      low: data.l,
      open: data.o,
      previousClose: data.pc,
    });
  } catch (err) {
    console.error("Error fetching stock data:", err.message);
    return res.status(500).json({ error: "Failed to fetch stock data" });
  }
});

// Test Finnhub limit (optional)
app.get("/api/test-limit", async (req, res) => {
  const url = `https://finnhub.io/api/v1/quote?symbol=AAPL&token=${FINNHUB_API_KEY}`;
  try {
    const data = await fetchFinnhub(url);
    if (data && data.error) {
      return res.status(429).json({ limit: true, message: "Rate limit exceeded" });
    }
    return res.json({ limit: false, data });
  } catch (err) {
    console.log("Error testing API:", err.message);
    return res.status(500).json({ error: "API limit check failed" });
  }
});

/* -------------------------
   Additional API endpoints
   ------------------------- */

// 1) SEARCH
app.get("/api/search", async (req, res) => {
  try {
    const q = (req.query.query || "").trim();
    if (!q) return res.json([]);
    const url = `https://finnhub.io/api/v1/search?q=${encodeURIComponent(
      q
    )}&token=${FINNHUB_API_KEY}`;
    const data = await fetchFinnhub(url);
    const results =
      data && data.result
        ? data.result.map((r) => ({
            symbol: r.symbol,
            name: r.description || r.displaySymbol || r.symbol,
            type: r.type || null,
          }))
        : [];
    return res.json(results);
  } catch (err) {
    console.error("Search error:", err);
    return res.status(500).json({ error: "Search failed" });
  }
});

// 2) TIMESERIES
app.get("/api/timeseries", async (req, res) => {
  try {
    const symbol = (req.query.symbol || "").trim().toUpperCase();
    if (!symbol) return res.status(400).json({ error: "Missing symbol" });

    const range = req.query.range || "1m";
    const now = Math.floor(Date.now() / 1000);
    let from;

    if (range === "3m") from = now - 90 * 24 * 3600;
    else if (range === "6m") from = now - 180 * 24 * 3600;
    else if (range === "1y") from = now - 365 * 24 * 3600;
    else from = now - 30 * 24 * 3600;

    const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(
      symbol
    )}&resolution=D&from=${from}&to=${now}&token=${FINNHUB_API_KEY}`;

    const data = await fetchFinnhub(url);
    let points = [];

    if (data && data.s === "ok" && Array.isArray(data.t)) {
      points = data.t.map((ts, i) => ({
        date: new Date(ts * 1000).toISOString().slice(0, 10),
        open: data.o[i],
        high: data.h[i],
        low: data.l[i],
        close: data.c[i],
        volume: data.v[i],
      }));
    } else {
      console.warn("Timeseries fallback for", symbol, "raw:", data);

      const q = await fetchFinnhub(
        `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(
          symbol
        )}&token=${FINNHUB_API_KEY}`
      );
      const basePrice = Number(q?.c || q?.pc || 100);

      const days = 10;
      const today = new Date();

      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);

        const noiseFactor = 1 + (Math.random() - 0.5) * 0.06; // -3%..+3%
        const close = +(basePrice * noiseFactor).toFixed(2);

        points.push({
          date: d.toISOString().slice(0, 10),
          open: close,
          high: close,
          low: close,
          close,
          volume: 0,
        });
      }
    }

    return res.json(points);
  } catch (err) {
    console.error("Timeseries error:", err);
    return res.status(500).json({ error: "Timeseries failed" });
  }
});

// 3) PORTFOLIO snapshot
app.get("/api/portfolio", async (req, res) => {
  try {
    const userId = req.session && req.session.user_id;
    if (!userId) return res.status(401).json({ error: "Not logged in" });

    const account = await dbGet(`SELECT * FROM Account WHERE user_id = ?`, [
      userId,
    ]);
    if (!account) return res.status(404).json({ error: "Account not found" });

    const positions = await dbAll(
      `SELECT * FROM Position WHERE account_id = ?`,
      [account.account_id]
    );

    const holdings = positions.map((p) => {
      const qty = Number(p.qty || 0);
      const avg_cost = Number(p.avg_cost || 0);
      const last_price = Number(p.last_price || 0) || avg_cost;
      const realized_pnl = Number(p.realized_pnl || 0);

      const market_value = last_price * qty;
      const unrealized_pl = (last_price - avg_cost) * qty;

      return {
        symbol: p.symbol,
        name: p.name || null,
        qty,
        avg_cost: +avg_cost.toFixed(2),
        last_price: +last_price.toFixed(2),
        market_value: +market_value.toFixed(2),
        unrealized_pl: +unrealized_pl.toFixed(2),
        realized_pnl: +realized_pnl.toFixed(2),
      };
    });

    const holdingsValue = holdings.reduce(
      (s, h) => s + (h.market_value || 0),
      0
    );
    const total_realized = holdings.reduce(
      (s, h) => s + (h.realized_pnl || 0),
      0
    );
    const total_unrealized = holdings.reduce(
      (s, h) => s + (h.unrealized_pl || 0),
      0
    );

    const cash = Number(account.cash || 0);
    const net_worth = +(cash + holdingsValue).toFixed(2);
    const baseline = Number(account.equity || 100000);

    // overall gains = how far you are from starting equity
    const overall_gains = +(net_worth - baseline).toFixed(2);
    const overall_returns_pct = +(
      (overall_gains / (baseline || 1)) *
      100
    ).toFixed(2);

    return res.json({
      userId,
      account: {
        account_id: account.account_id,
        cash,
        buying_power: cash,
        net_worth,
        baseline,
        overall_gains,
        overall_returns_pct,
        realized_pnl_total: +total_realized.toFixed(2),
        unrealized_pnl_total: +total_unrealized.toFixed(2),
      },
      holdings,
    });
  } catch (err) {
    console.error("Portfolio error:", err);
    return res.status(500).json({ error: "Portfolio fetch failed" });
  }
});

// 4) BUY
app.post("/api/buy", async (req, res) => {
  try {
    const userId = req.session && req.session.user_id;
    if (!userId) return res.status(401).json({ error: "Not logged in" });

    let { symbol, qty, price } = req.body;
    symbol = (symbol || "").trim().toUpperCase();
    qty = Math.floor(Number(qty) || 0);

    if (!symbol || qty <= 0)
      return res.status(400).json({ error: "Invalid symbol or quantity" });

    const account = await dbGet(`SELECT * FROM Account WHERE user_id = ?`, [
      userId,
    ]);
    if (!account) return res.status(404).json({ error: "Account not found" });

    if (!price) {
      try {
        const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(
          symbol
        )}&token=${FINNHUB_API_KEY}`;
        const data = await fetchFinnhub(url);
        price = Number(data?.c || 0);
      } catch (e) {
        console.warn("Price fetch failed:", e && e.message);
        price = 0;
      }
    } else {
      price = Number(price);
    }

    if (!price || isNaN(price) || price <= 0) {
      return res.status(500).json({ error: "Failed to determine price" });
    }

    const totalCost = +(price * qty);
    console.log(
      `BUY user=${userId} symbol=${symbol} qty=${qty} price=${price} total=${totalCost} (cash=${account.cash})`
    );

    if (Number(account.cash) < totalCost) {
      return res.status(400).json({ error: "Insufficient funds" });
    }

    await dbRun("BEGIN TRANSACTION");
    try {
      const pos = await dbGet(
        `SELECT qty, avg_cost FROM Position WHERE account_id = ? AND symbol = ?`,
        [account.account_id, symbol]
      );

      if (pos) {
        const oldQty = Number(pos.qty || 0);
        const oldAvg = Number(pos.avg_cost || 0);
        const newQty = oldQty + qty;
        const newAvg = (oldQty * oldAvg + qty * price) / newQty;

        await dbRun(
          `UPDATE Position
           SET qty = ?, avg_cost = ?, last_price = ?, updated_at = strftime('%s','now')
           WHERE account_id = ? AND symbol = ?`,
          [newQty, newAvg, price, account.account_id, symbol]
        );
      } else {
        await dbRun(
          `INSERT INTO Position (account_id, symbol, qty, avg_cost, realized_pnl, updated_at, last_price)
           VALUES (?, ?, ?, ?, ?, strftime('%s','now'), ?)`,
          [account.account_id, symbol, qty, price, 0.0, price]
        );
      }

      const newCash = +(Number(account.cash) - totalCost).toFixed(2);
      await dbRun(
        `UPDATE Account SET cash = ?, updated_at = strftime('%s','now') WHERE account_id = ?`,
        [newCash, account.account_id]
      );

      await dbRun("COMMIT");
    } catch (txErr) {
      console.error("Buy TX error, rolling back:", txErr);
      await dbRun("ROLLBACK");
      return res.status(500).json({ error: "Failed to process buy" });
    }

    const snapshot = await dbGet(`SELECT * FROM Account WHERE user_id = ?`, [
      userId,
    ]);
    const holdings = await dbAll(
      `SELECT * FROM Position WHERE account_id = ?`,
      [snapshot.account_id]
    );

    return res.json({ success: true, account: snapshot, holdings });
  } catch (err) {
    console.error("Buy error:", err);
    return res.status(500).json({ error: "Server error on buy" });
  }
});

// 4b) SELL
app.post("/api/sell", async (req, res) => {
  try {
    const userId = req.session && req.session.user_id;
    if (!userId) return res.status(401).json({ error: "Not logged in" });

    let { symbol, qty, price } = req.body;
    symbol = (symbol || "").trim().toUpperCase();
    qty = Math.floor(Number(qty) || 0);

    if (!symbol || qty <= 0) {
      return res.status(400).json({ error: "Invalid symbol or quantity" });
    }

    const account = await dbGet(`SELECT * FROM Account WHERE user_id = ?`, [
      userId,
    ]);
    if (!account) return res.status(404).json({ error: "Account not found" });

    const pos = await dbGet(
      `SELECT * FROM Position WHERE account_id = ? AND symbol = ?`,
      [account.account_id, symbol]
    );
    if (!pos) {
      return res.status(400).json({ error: "No position in that symbol" });
    }

    const oldQty = Number(pos.qty || 0);
    const avgCost = Number(pos.avg_cost || 0);
    const oldReal = Number(pos.realized_pnl || 0);

    if (oldQty < qty) {
      return res.status(400).json({ error: "Not enough shares to sell" });
    }

    if (!price) {
      try {
        const q = await fetchFinnhub(
          `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(
            symbol
          )}&token=${FINNHUB_API_KEY}`
        );
        price = Number(q?.c || 0);
      } catch (e) {
        console.warn("Sell price fetch failed:", e?.message);
        price = 0;
      }
    } else {
      price = Number(price);
    }

    if (!price || isNaN(price) || price <= 0) {
      return res.status(500).json({ error: "Failed to determine price" });
    }

    const proceeds = +(price * qty);
    const pnlThisTrade = (price - avgCost) * qty;
    const newRealized = oldReal + pnlThisTrade;
    const newQty = oldQty - qty;

    console.log(
      `SELL user=${userId} ${qty}x${symbol} @ ${price} pnl=${pnlThisTrade}`
    );

    await dbRun("BEGIN TRANSACTION");
    try {
      if (newQty > 0) {
        await dbRun(
          `UPDATE Position
           SET qty = ?, realized_pnl = ?, last_price = ?, updated_at = strftime('%s','now')
           WHERE account_id = ? AND symbol = ?`,
          [newQty, newRealized, price, account.account_id, symbol]
        );
      } else {
        await dbRun(
          `DELETE FROM Position
           WHERE account_id = ? AND symbol = ?`,
          [account.account_id, symbol]
        );
      }

      const newCash = +(Number(account.cash) + proceeds).toFixed(2);
      await dbRun(
        `UPDATE Account
         SET cash = ?, updated_at = strftime('%s','now')
         WHERE account_id = ?`,
        [newCash, account.account_id]
      );

      await dbRun("COMMIT");
    } catch (txErr) {
      console.error("Sell TX error, rolling back:", txErr);
      await dbRun("ROLLBACK");
      return res.status(500).json({ error: "Failed to process sell" });
    }

    const snapshot = await dbGet(`SELECT * FROM Account WHERE user_id = ?`, [
      userId,
    ]);
    const holdings = await dbAll(
      `SELECT * FROM Position WHERE account_id = ?`,
      [snapshot.account_id]
    );

    return res.json({ success: true, account: snapshot, holdings });
  } catch (err) {
    console.error("Sell error:", err);
    return res.status(500).json({ error: "Server error on sell" });
  }
});

// 5) Refresh prices – SIMPLE DEMO VERSION (no Finnhub)
// This randomly moves last_price around avg_cost to create visible P/L.
// 5) Refresh prices (DEMO: random gains/losses around avg_cost)
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

app.get("/api/refresh-prices", async (req, res) => {
  try {
    const userId = req.session && req.session.user_id;
    if (!userId) return res.status(401).json({ error: "Not logged in" });

    const account = await dbGet(
      `SELECT * FROM Account WHERE user_id = ?`,
      [userId]
    );
    if (!account) return res.status(404).json({ error: "Account not found" });

    // We use avg_cost as base and generate a fake last_price around it
    const positions = await dbAll(
      `SELECT symbol, avg_cost FROM Position WHERE account_id = ?`,
      [account.account_id]
    );

    const results = [];

    for (const p of positions) {
      const base = Number(p.avg_cost || 100);

      // 👇 random factor between 0.95 and 1.05  (-5% to +5%)
      const factor = 0.95 + Math.random() * 0.10;
      const price = +(base * factor).toFixed(2);

      await dbRun(
        `UPDATE Position
         SET last_price = ?, updated_at = strftime('%s','now')
         WHERE account_id = ? AND symbol = ?`,
        [price, account.account_id, p.symbol]
      );

      results.push({ symbol: p.symbol, price });
      await sleep(5);
    }

    return res.json({ updated: results });
  } catch (err) {
    console.error("refresh-prices error:", err);
    return res.status(500).json({ error: "Failed to refresh" });
  }
});
// 6) COMPANY NEWS
app.get("/company-news/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  console.log(`🔵 /company-news/:symbol route hit for symbol: ${symbol}`);
  const NEWS_API_KEY = process.env.NEWS_API_KEY;

  // Query NewsAPI (everything) for company symbol or name. If NEWS_API_KEY missing or request fails,
  // return demo data.
  try {
    if (!NEWS_API_KEY) {
      console.warn("NEWS_API_KEY not set, returning demo news");
      throw new Error('No NEWS_API_KEY');
    }

  const q = encodeURIComponent(symbol);
  // Request English articles only
  const url = `https://newsapi.org/v2/everything?q=${q}&language=en&pageSize=10&sortBy=publishedAt&apiKey=${NEWS_API_KEY}`;
    console.log(`📡 Fetching company news from NewsAPI: ${url}`);

    const response = await axios.get(url, { timeout: 10000 });
    const data = response.data;

    if (!data || !Array.isArray(data.articles) || data.articles.length === 0) {
      console.log("NewsAPI returned no articles, falling back to demo news");
      throw new Error('No articles');
    }

    // Normalize articles to the frontend shape
    const articles = data.articles.map(a => ({
      title: a.title,
      text: a.description || a.content || '',
      url: a.url,
      site: a.source?.name || a.source || 'NewsAPI',
      publishedAt: a.publishedAt
    }));

    return res.json({ news: articles });
  } catch (err) {
    console.error("Error fetching company news:", err.message, {
      status: err.response?.status,
      body: err.response?.data,
    });
    // Demo fallback
    const demoNews = [
      {
        title: `${symbol} - Market Update`,
        text: "Unable to fetch live news; showing demo items.",
        url: "#",
        site: "Demo",
        publishedAt: new Date().toISOString()
      },
      {
        title: `${symbol} Market Analysis`,
        text: `Demo analysis for ${symbol}. Replace with NewsAPI results by setting NEWS_API_KEY in .env.`,
        url: "#",
        site: "Demo",
        publishedAt: new Date().toISOString()
      }
    ];
    return res.json({ news: demoNews });
  }
});

app.get("/company-chart/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  console.log(`🔵 /company-chart/:symbol route hit for symbol: ${symbol}`);
  const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;

  try {
    if (!FINNHUB_API_KEY) {
      console.warn('FINNHUB_API_KEY not set, returning demo chart and quote');
      throw new Error('No FINNHUB_API_KEY');
    }

  // 1) Fetch quote (latest) from Finnhub using fetchFinnhub helper
  const quoteUrl = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_API_KEY}`;
  console.log(`📡 Fetching quote from Finnhub: ${quoteUrl}`);
  const quote = await fetchFinnhub(quoteUrl) || {};

  // 2) Fetch historical candles (daily) from Finnhub using fetchFinnhub helper
  const now = Math.floor(Date.now() / 1000);
  const from = now - 30 * 24 * 60 * 60; // last 30 days
  const candleUrl = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${from}&to=${now}&token=${FINNHUB_API_KEY}`;
  console.log(`📡 Fetching candles from Finnhub: ${candleUrl}`);
  const candleData = await fetchFinnhub(candleUrl) || {};

    let chart = [];
    if (candleData && candleData.s === 'ok' && Array.isArray(candleData.t)) {
      for (let i = 0; i < candleData.t.length; i++) {
        const ts = candleData.t[i];
        chart.push({
          date: new Date(ts * 1000).toISOString().split('T')[0],
          open: candleData.o[i],
          high: candleData.h[i],
          low: candleData.l[i],
          close: candleData.c[i],
          volume: candleData.v[i]
        });
      }
    } else {
      console.log('Finnhub candles returned no data or error, generating small demo chart', candleData);
      // fallback demo chart
      let price = (quote.c && Number(quote.c)) || 100 + Math.random() * 50;
      for (let i = 10; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        price = +(price * (0.98 + Math.random() * 0.04)).toFixed(2);
        chart.push({ date: date.toISOString().split('T')[0], close: price, open: price * 0.99, high: price * 1.01, low: price * 0.98, volume: 0 });
      }
    }

    // Normalize quote fields expected by frontend
    const normalizedQuote = {
      price: quote.c ?? null,
      change: quote.d ?? null,
      changePercent: quote.dp ?? null,
      high: quote.h ?? null,
      low: quote.l ?? null,
      open: quote.o ?? null,
      previousClose: quote.pc ?? null
    };

    // If quote fields are missing, try the internal /api/quote endpoint as a fallback
    if (normalizedQuote.price == null) {
      try {
        console.log('Normalized quote missing — trying internal /api/quote fallback');
        const internal = await axios.get(`http://localhost:${process.env.PORT || 3000}/api/quote?symbol=${encodeURIComponent(symbol)}`, { timeout: 5000 });
        const q = internal.data || {};
        if (q && q.price != null) {
          normalizedQuote.price = q.price;
          normalizedQuote.change = q.change ?? normalizedQuote.change;
          normalizedQuote.changePercent = q.changePercent ?? normalizedQuote.changePercent;
          normalizedQuote.high = q.high ?? normalizedQuote.high;
          normalizedQuote.low = q.low ?? normalizedQuote.low;
          normalizedQuote.open = q.open ?? normalizedQuote.open;
          normalizedQuote.previousClose = q.previousClose ?? normalizedQuote.previousClose;
          console.log('Internal /api/quote fallback succeeded');
        }
      } catch (e) {
        console.warn('Internal /api/quote fallback failed:', e.message);
      }
    }

    return res.json({ chart, quote: normalizedQuote });
  } catch (err) {
    console.error("Error fetching company chart or quote:", err.message, {
      status: err.response?.status,
      body: err.response?.data,
    });

    // Demo fallback: simple chart + null quote
    const demoChart = [];
    let price = 100 + Math.random() * 50;
    for (let i = 10; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      price = +(price * (0.98 + Math.random() * 0.04)).toFixed(2);
      demoChart.push({ date: date.toISOString().split('T')[0], close: price, open: price * 0.99, high: price * 1.01, low: price * 0.98, volume: 0 });
    }

    return res.json({ chart: demoChart, quote: { price: null, change: null, changePercent: null, high: null, low: null, open: null, previousClose: null } });
  }
});

// -----------------------------
// Game Rooms API (mirror main portfolio logic)
// Paste this below your other API routes and before app.use(express.static(__dirname));
// -----------------------------

// Helper: get participant row for current session user
async function getGameParticipantOrFail(roomId, userId) {
  if (!userId) return null;
  return await dbGet(
    `SELECT * FROM GameRoomParticipant WHERE room_id = ? AND user_id = ?`,
    [roomId, userId]
  );
}

// Helper: compute holdings summary for game participant (same formulas as /api/portfolio)
function computeGameHoldingsSummary(participantRow, positions) {
  const holdings = positions.map((p) => {
    const qty = Number(p.qty || 0);
    const avg_cost = Number(p.avg_cost || 0);
    const last_price = Number(p.last_price || 0) || avg_cost;
    const realized_pnl = Number(p.realized_pnl || 0);

    const market_value = +(last_price * qty);
    const unrealized_pl = +((last_price - avg_cost) * qty);

    return {
      symbol: p.symbol,
      name: p.name || null,
      qty,
      avg_cost: +avg_cost.toFixed(2),
      last_price: +last_price.toFixed(2),
      market_value: +market_value.toFixed(2),
      unrealized_pl: +unrealized_pl.toFixed(2),
      realized_pnl: +realized_pnl.toFixed(2),
    };
  });

  const holdingsValue = holdings.reduce((s, h) => s + (h.market_value || 0), 0);
  const total_realized = holdings.reduce((s, h) => s + (h.realized_pnl || 0), 0);
  const total_unrealized = holdings.reduce((s, h) => s + (h.unrealized_pl || 0), 0);

  const cash = Number(participantRow.cash || 0);
  const net_worth = +(cash + holdingsValue).toFixed(2);
  const baseline = Number(participantRow.starting_principal || 0);

  const overall_gains = +(net_worth - baseline).toFixed(2);
  const overall_returns_pct = +(((overall_gains) / (baseline || 1)) * 100).toFixed(2);

  return {
    account: {
      room_id: participantRow.room_id,
      user_id: participantRow.user_id,
      starting_principal: baseline,
      cash,
      net_worth,
      baseline,
      overall_gains,
      overall_returns_pct,
      realized_pnl_total: +total_realized.toFixed(2),
      unrealized_pnl_total: +total_unrealized.toFixed(2),
    },
    holdings,
  };
}

/* -------------------------
   Rooms list / create / delete
   Routes expected by game-rooms.html
   ------------------------- */

// GET /api/game-rooms  -> list rooms and participant counts + whether current user is owner
app.get('/api/game-rooms', async (req, res) => {
  try {
    const userId = req.session && req.session.user_id;
    if (!userId) return res.status(401).json({ error: 'Not logged in' });

    const rooms = await dbAll(`
      SELECT g.room_id, g.name, g.base_amount, g.created_by,
             u.username AS created_by_name,
             (SELECT COUNT(*) FROM GameRoomParticipant p WHERE p.room_id = g.room_id) AS participants,
             (g.created_by = ?) AS is_owner
      FROM GameRoom g
      LEFT JOIN User u ON u.user_id = g.created_by
      ORDER BY g.created_at DESC
    `, [userId]);

    return res.json(rooms);
  } catch (err) {
    console.error('GET /api/game-rooms error:', err);
    return res.status(500).json({ error: 'Failed to list game rooms' });
  }
});

// POST /api/game-rooms  -> create a room (auto-join creator)
app.post('/api/game-rooms', async (req, res) => {
  try {
    const userId = req.session && req.session.user_id;
    if (!userId) return res.status(401).json({ error: 'Not logged in' });

    const { name, base_amount } = req.body;
    if (!name || !base_amount) return res.status(400).json({ error: 'Missing name or base_amount' });

    await dbRun("BEGIN TRANSACTION");
    try {
      const r = await dbRun(
        `INSERT INTO GameRoom (name, base_amount, created_by) VALUES (?, ?, ?)`,
        [name, Number(base_amount), userId]
      );
      const roomId = r.lastID;

      // Creator auto-joins
      await dbRun(
        `INSERT INTO GameRoomParticipant (room_id, user_id, starting_principal, cash, equity) VALUES (?, ?, ?, ?, ?)`,
        [roomId, userId, Number(base_amount), Number(base_amount), Number(base_amount)]
      );

      await dbRun("COMMIT");
      return res.status(201).json({ room_id: roomId, name, base_amount });
    } catch (txErr) {
      await dbRun("ROLLBACK");
      throw txErr;
    }
  } catch (err) {
    console.error('POST /api/game-rooms error:', err);
    return res.status(500).json({ error: 'Failed to create room' });
  }
});

// DELETE /api/game-rooms/:roomId -> delete room (only owner)
app.delete('/api/game-rooms/:roomId', async (req, res) => {
  try {
    const userId = req.session && req.session.user_id;
    if (!userId) return res.status(401).json({ error: 'Not logged in' });

    const roomId = Number(req.params.roomId);
    const room = await dbGet(`SELECT * FROM GameRoom WHERE room_id = ?`, [roomId]);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (room.created_by !== userId) return res.status(403).json({ error: 'Only owner can delete room' });

    await dbRun(`DELETE FROM GameRoom WHERE room_id = ?`, [roomId]);
    return res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/game-rooms/:roomId error:', err);
    return res.status(500).json({ error: 'Failed to delete room' });
  }
});

// POST /api/game-rooms/:roomId/join -> join room
app.post('/api/game-rooms/:roomId/join', async (req, res) => {
  try {
    const userId = req.session && req.session.user_id;
    if (!userId) return res.status(401).json({ error: 'Not logged in' });

    const roomId = Number(req.params.roomId);
    const room = await dbGet(`SELECT * FROM GameRoom WHERE room_id = ?`, [roomId]);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const existing = await dbGet(
      `SELECT * FROM GameRoomParticipant WHERE room_id = ? AND user_id = ?`,
      [roomId, userId]
    );
    if (existing) return res.status(400).json({ error: 'Already joined' });

    await dbRun(
      `INSERT INTO GameRoomParticipant (room_id, user_id, starting_principal, cash, equity) VALUES (?, ?, ?, ?, ?)`,
      [roomId, userId, Number(room.base_amount), Number(room.base_amount), Number(room.base_amount)]
    );

    return res.json({ success: true });
  } catch (err) {
    console.error('POST /api/game-rooms/:roomId/join error:', err);
    return res.status(500).json({ error: 'Failed to join room' });
  }
});

// POST /api/game-rooms/:roomId/leave -> leave room (removes participant but keeps historical records)
app.post('/api/game-rooms/:roomId/leave', async (req, res) => {
  try {
    const userId = req.session && req.session.user_id;
    if (!userId) return res.status(401).json({ error: 'Not logged in' });

    const roomId = Number(req.params.roomId);
    await dbRun(`DELETE FROM GameRoomParticipant WHERE room_id = ? AND user_id = ?`, [roomId, userId]);
    // Note: GameRoomPosition rows are cascade-deleted if there is FK ON DELETE CASCADE on participant — schema uses composite FK
    return res.json({ success: true });
  } catch (err) {
    console.error('POST /api/game-rooms/:roomId/leave error:', err);
    return res.status(500).json({ error: 'Failed to leave room' });
  }
});

/* -------------------------
   Leaderboard & Portfolio routes (for a room)
   ------------------------- */

// GET /api/game-rooms/:roomId/leaderboard?sort=
app.get('/api/game-rooms/:roomId/leaderboard', async (req, res) => {
  try {
    const roomId = Number(req.params.roomId);
    const sort = req.query.sort || 'assets';

    // For each participant compute net_worth = cash + SUM(last_price*qty) (fallback to avg_cost)
    const participants = await dbAll(
      `SELECT p.room_id, p.user_id, p.starting_principal, p.cash, u.username
       FROM GameRoomParticipant p
       LEFT JOIN User u ON u.user_id = p.user_id
       WHERE p.room_id = ?`,
      [roomId]
    );

    // compute net worth per participant
    const rows = [];
    for (const part of participants) {
      const positions = await dbAll(
        `SELECT symbol, qty, avg_cost, last_price FROM GameRoomPosition WHERE room_id = ? AND user_id = ?`,
        [roomId, part.user_id]
      );

      let holdingsValue = 0;
      for (const pos of positions) {
        const last = Number(pos.last_price) || Number(pos.avg_cost) || 0;
        holdingsValue += (Number(pos.qty) || 0) * last;
      }
      const net_worth = +(Number(part.cash || 0) + holdingsValue).toFixed(2);
      const gains = +(net_worth - Number(part.starting_principal || 0)).toFixed(2);

      rows.push({
        room_id: part.room_id,
        user_id: part.user_id,
        username: part.username,
        starting_principal: Number(part.starting_principal || 0),
        cash: Number(part.cash || 0),
        net_worth,
        gains
      });
    }

    if (sort === 'gains') {
      rows.sort((a,b) => b.gains - a.gains);
    } else {
      rows.sort((a,b) => b.net_worth - a.net_worth);
    }

    return res.json(rows);
  } catch (err) {
    console.error('GET /api/game-rooms/:roomId/leaderboard error:', err);
    return res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

// GET /api/game-rooms/:roomId/portfolio -> portfolio snapshot for current user in room
app.get('/api/game-rooms/:roomId/portfolio', async (req, res) => {
  try {
    const userId = req.session && req.session.user_id;
    if (!userId) return res.status(401).json({ error: 'Not logged in' });

    const roomId = Number(req.params.roomId);
    const participant = await getGameParticipantOrFail(roomId, userId);
    if (!participant) return res.status(404).json({ error: 'Not a participant / room not found' });

    const positions = await dbAll(
      `SELECT * FROM GameRoomPosition WHERE room_id = ? AND user_id = ?`,
      [roomId, userId]
    );

    const summary = computeGameHoldingsSummary(participant, positions);
    // attach holdings array as summary.holdings for frontend expectations
    return res.json({ account: { ...summary.account, starting_principal: participant.starting_principal }, holdings: summary.holdings });
  } catch (err) {
    console.error('GET /api/game-rooms/:roomId/portfolio error:', err);
    return res.status(500).json({ error: 'Failed to fetch portfolio' });
  }
});

/* -------------------------
   BUY / SELL routes (mirror main buy/sell but for GameRoomPosition and GameRoomParticipant)
   POST /api/game-rooms/:roomId/buy
   POST /api/game-rooms/:roomId/sell
   ------------------------- */

app.post('/api/game-rooms/:roomId/buy', async (req, res) => {
  try {
    const userId = req.session && req.session.user_id;
    if (!userId) return res.status(401).json({ error: 'Not logged in' });

    const roomId = Number(req.params.roomId);
    let { symbol, qty, price } = req.body;
    symbol = (symbol || '').trim().toUpperCase();
    qty = Math.floor(Number(qty) || 0);

    if (!symbol || qty <= 0) return res.status(400).json({ error: 'Invalid symbol or qty' });

    const participant = await getGameParticipantOrFail(roomId, userId);
    if (!participant) return res.status(404).json({ error: 'Participant not found' });

    // Resolve price if missing using Finnhub
    if (!price) {
      try {
        const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_API_KEY}`;
        const q = await fetchFinnhub(url);
        price = Number(q?.c || 0);
      } catch (e) {
        price = 0;
      }
    } else {
      price = Number(price);
    }

    if (!price || isNaN(price) || price <= 0) return res.status(500).json({ error: 'Failed to determine price' });

    const totalCost = +(price * qty);

    if (Number(participant.cash) < totalCost) return res.status(400).json({ error: 'Insufficient game cash' });

    await dbRun("BEGIN TRANSACTION");
    try {
      const pos = await dbGet(
        `SELECT qty, avg_cost FROM GameRoomPosition WHERE room_id = ? AND user_id = ? AND symbol = ?`,
        [roomId, userId, symbol]
      );

      if (pos) {
        const oldQty = Number(pos.qty || 0);
        const oldAvg = Number(pos.avg_cost || 0);
        const newQty = oldQty + qty;
        const newAvg = (oldQty * oldAvg + qty * price) / newQty;

        await dbRun(
          `UPDATE GameRoomPosition
           SET qty = ?, avg_cost = ?, last_price = ?, updated_at = strftime('%s','now')
           WHERE room_id = ? AND user_id = ? AND symbol = ?`,
          [newQty, newAvg, price, roomId, userId, symbol]
        );
      } else {
        await dbRun(
          `INSERT INTO GameRoomPosition (room_id, user_id, symbol, qty, avg_cost, realized_pnl, last_price, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, strftime('%s','now'), ?)`,
          [roomId, userId, symbol, qty, price, 0.0, price]
        );
      }

      const newCash = +(Number(participant.cash) - totalCost).toFixed(2);
      await dbRun(
        `UPDATE GameRoomParticipant SET cash = ?, equity = ?, joined_at = joined_at WHERE room_id = ? AND user_id = ?`,
        [newCash, Number(participant.equity || 0), roomId, userId]
      );

      await dbRun("COMMIT");
    } catch (txErr) {
      console.error('Buy TX error, rolling back:', txErr);
      await dbRun("ROLLBACK");
      return res.status(500).json({ error: 'Failed to process buy' });
    }

    // return fresh snapshot
    const refreshedParticipant = await dbGet(`SELECT * FROM GameRoomParticipant WHERE room_id = ? AND user_id = ?`, [roomId, userId]);
    const positions = await dbAll(`SELECT * FROM GameRoomPosition WHERE room_id = ? AND user_id = ?`, [roomId, userId]);
    const summary = computeGameHoldingsSummary(refreshedParticipant, positions);

    return res.json({ success: true, account: summary.account, holdings: summary.holdings });
  } catch (err) {
    console.error('POST /api/game-rooms/:roomId/buy error:', err);
    return res.status(500).json({ error: 'Server error on buy' });
  }
});

app.post('/api/game-rooms/:roomId/sell', async (req, res) => {
  try {
    const userId = req.session && req.session.user_id;
    if (!userId) return res.status(401).json({ error: 'Not logged in' });

    const roomId = Number(req.params.roomId);
    let { symbol, qty, price } = req.body;
    symbol = (symbol || '').trim().toUpperCase();
    qty = Math.floor(Number(qty) || 0);

    if (!symbol || qty <= 0) return res.status(400).json({ error: 'Invalid symbol or qty' });

    const participant = await getGameParticipantOrFail(roomId, userId);
    if (!participant) return res.status(404).json({ error: 'Participant not found' });

    const pos = await dbGet(`SELECT * FROM GameRoomPosition WHERE room_id = ? AND user_id = ? AND symbol = ?`, [roomId, userId, symbol]);
    if (!pos) return res.status(400).json({ error: 'No position in that symbol' });

    const oldQty = Number(pos.qty || 0);
    const avgCost = Number(pos.avg_cost || 0);
    const oldReal = Number(pos.realized_pnl || 0);

    if (oldQty < qty) return res.status(400).json({ error: 'Not enough shares to sell' });

    if (!price) {
      try {
        const q = await fetchFinnhub(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_API_KEY}`);
        price = Number(q?.c || 0);
      } catch (e) {
        price = 0;
      }
    } else {
      price = Number(price);
    }

    if (!price || isNaN(price) || price <= 0) return res.status(500).json({ error: 'Failed to determine price' });

    const proceeds = +(price * qty);
    const pnlThisTrade = (price - avgCost) * qty;
    const newRealized = oldReal + pnlThisTrade;
    const newQty = oldQty - qty;

    await dbRun("BEGIN TRANSACTION");
    try {
      if (newQty > 0) {
        await dbRun(
          `UPDATE GameRoomPosition
           SET qty = ?, realized_pnl = ?, last_price = ?, updated_at = strftime('%s','now')
           WHERE room_id = ? AND user_id = ? AND symbol = ?`,
          [newQty, newRealized, price, roomId, userId, symbol]
        );
      } else {
        await dbRun(
          `DELETE FROM GameRoomPosition WHERE room_id = ? AND user_id = ? AND symbol = ?`,
          [roomId, userId, symbol]
        );
      }

      const newCash = +(Number(participant.cash) + proceeds).toFixed(2);
      await dbRun(
        `UPDATE GameRoomParticipant SET cash = ?, equity = ?, joined_at = joined_at WHERE room_id = ? AND user_id = ?`,
        [newCash, Number(participant.equity || 0), roomId, userId]
      );

      await dbRun("COMMIT");
    } catch (txErr) {
      console.error('Sell TX error, rolling back:', txErr);
      await dbRun("ROLLBACK");
      return res.status(500).json({ error: 'Failed to process sell' });
    }

    // return fresh snapshot
    const refreshedParticipant = await dbGet(`SELECT * FROM GameRoomParticipant WHERE room_id = ? AND user_id = ?`, [roomId, userId]);
    const positions = await dbAll(`SELECT * FROM GameRoomPosition WHERE room_id = ? AND user_id = ?`, [roomId, userId]);
    const summary = computeGameHoldingsSummary(refreshedParticipant, positions);

    return res.json({ success: true, account: summary.account, holdings: summary.holdings });
  } catch (err) {
    console.error('POST /api/game-rooms/:roomId/sell error:', err);
    return res.status(500).json({ error: 'Server error on sell' });
  }
});

/* -------------------------
   Refresh prices for room (DEMO randomizer)
   POST /api/game-rooms/:roomId/refresh-prices
   ------------------------- */
app.post('/api/game-rooms/:roomId/refresh-prices', async (req, res) => {
  try {
    const userId = req.session && req.session.user_id;
    if (!userId) return res.status(401).json({ error: 'Not logged in' });

    const roomId = Number(req.params.roomId);
    const participant = await getGameParticipantOrFail(roomId, userId);
    if (!participant) return res.status(404).json({ error: 'Participant not found' });

    // Get ALL positions in the room (for all symbols across all users)
    // This ensures price updates are consistent for everyone
    const allPositions = await dbAll(`
      SELECT DISTINCT symbol, avg_cost FROM GameRoomPosition WHERE room_id = ?
    `, [roomId]);

    const results = [];

    await dbRun("BEGIN TRANSACTION");
    try {
      // Map to track unique symbols and their new prices
      const priceUpdates = {};

      for (const p of allPositions) {
        const base = Number(p.avg_cost || 100);
        const factor = 0.95 + Math.random() * 0.10; // -5%..+5%
        const price = +(base * factor).toFixed(2);
        
        priceUpdates[p.symbol] = price;

        // Update ALL positions with this symbol in the room to the same price
        await dbRun(
          `UPDATE GameRoomPosition SET last_price = ?, updated_at = strftime('%s','now') 
           WHERE room_id = ? AND symbol = ?`,
          [price, roomId, p.symbol]
        );

        results.push({ symbol: p.symbol, price });
        // light throttle
        await sleep(2);
      }
      await dbRun("COMMIT");
    } catch (txErr) {
      await dbRun("ROLLBACK");
      console.error('refresh-prices TX error:', txErr);
      return res.status(500).json({ error: 'Failed to refresh game prices' });
    }

    return res.json({ updated: results });
  } catch (err) {
    console.error('POST /api/game-rooms/:roomId/refresh-prices error:', err);
    return res.status(500).json({ error: 'Failed to refresh prices' });
  }
});

/* -------------------------
   History / record history
   GET /api/game-rooms/:roomId/history?limit=
   POST /api/game-rooms/:roomId/record-history
   ------------------------- */

// POST /api/game-rooms/:roomId/record-history -> insert GameRoomHistory entry for current user
app.post('/api/game-rooms/:roomId/record-history', async (req, res) => {
  try {
    const userId = req.session && req.session.user_id;
    if (!userId) return res.status(401).json({ error: 'Not logged in' });

    const roomId = Number(req.params.roomId);
    const participant = await getGameParticipantOrFail(roomId, userId);
    if (!participant) return res.status(404).json({ error: 'Participant not found' });

    // compute current net worth
    const positions = await dbAll(`SELECT symbol, qty, avg_cost, last_price FROM GameRoomPosition WHERE room_id = ? AND user_id = ?`, [roomId, userId]);
    let holdingsValue = 0;
    for (const pos of positions) {
      const last = Number(pos.last_price) || Number(pos.avg_cost) || 0;
      holdingsValue += (Number(pos.qty) || 0) * last;
    }
    const net_worth = +(Number(participant.cash || 0) + holdingsValue).toFixed(2);

    await dbRun(
      `INSERT INTO GameRoomHistory (room_id, user_id, ts, net_worth) VALUES (?, ?, strftime('%s','now'), ?)`,
      [roomId, userId, net_worth]
    );

    return res.json({ success: true, net_worth });
  } catch (err) {
    console.error('POST /api/game-rooms/:roomId/record-history error:', err);
    return res.status(500).json({ error: 'Failed to record history' });
  }
});

// GET /api/game-rooms/:roomId/history?limit=
app.get('/api/game-rooms/:roomId/history', async (req, res) => {
  try {
    const roomId = Number(req.params.roomId);
    const limit = Math.min(1000, Number(req.query.limit) || 200);

    // Return history for current user (frontend expects participant's history)
    const userId = req.session && req.session.user_id;
    if (!userId) return res.status(401).json({ error: 'Not logged in' });

    const history = await dbAll(
      `SELECT room_id, user_id, ts, net_worth FROM GameRoomHistory
       WHERE room_id = ? AND user_id = ?
       ORDER BY ts ASC
       LIMIT ?`,
      [roomId, userId, limit]
    );

    return res.json({ history });
  } catch (err) {
    console.error('GET /api/game-rooms/:roomId/history error:', err);
    return res.status(500).json({ error: 'Failed to fetch history' });
  }
});




// Serve static files AFTER all API routes
app.use(express.static(__dirname));

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
