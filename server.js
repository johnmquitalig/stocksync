// StockSync backend: Node.js (v22.5+) + built-in SQLite. No npm install needed.
// Run:  node server.js   then open http://localhost:3000
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const PORT = process.env.PORT || 3000;
const db = new DatabaseSync(path.join(__dirname, 'stocksync.db'));

db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS store(id INTEGER PRIMARY KEY CHECK(id=1), name TEXT, owner TEXT, address TEXT);
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, sku TEXT UNIQUE NOT NULL, size TEXT, color TEXT,
  qty INTEGER NOT NULL DEFAULT 0 CHECK(qty>=0), price REAL NOT NULL DEFAULT 0, thr INTEGER NOT NULL DEFAULT 10);
CREATE TABLE IF NOT EXISTS suppliers(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, contact TEXT, email TEXT, products TEXT);
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, total REAL NOT NULL);
CREATE TABLE IF NOT EXISTS order_items(id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id), product_id INTEGER NOT NULL, qty INTEGER NOT NULL, price REAL NOT NULL);
CREATE TABLE IF NOT EXISTS activity(id INTEGER PRIMARY KEY AUTOINCREMENT, msg TEXT, sub TEXT, ts INTEGER);
`);

const bad = (m, s = 400) => { throw Object.assign(new Error(m), { status: s }); };
const tx = fn => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
const hash = (p, salt) => crypto.scryptSync(p, salt, 32).toString('hex');
const log = (msg, sub = '') => db.prepare('INSERT INTO activity(msg,sub,ts) VALUES(?,?,?)').run(msg, sub, Date.now());
const num = (v, min = 0) => { v = Number(v); if (!Number.isFinite(v) || v < min) bad('Please enter valid numbers.'); return v; };
const str = (v, req = true) => { v = String(v ?? '').trim(); if (req && !v) bad('Please fill in all required fields.'); return v; };

function setUser(email, pass) {
  const salt = crypto.randomBytes(16).toString('hex');
  db.exec('DELETE FROM users');
  db.prepare('INSERT INTO users(email,salt,hash) VALUES(?,?,?)').run(email.toLowerCase(), salt, hash(pass, salt));
}

function seed() {
  tx(() => {
    ['order_items', 'orders', 'products', 'suppliers', 'activity', 'store'].forEach(t => db.exec('DELETE FROM ' + t));
    db.exec("DELETE FROM sqlite_sequence");
    setUser('john@stocksync.com', 'tsm3b');
    db.prepare('INSERT INTO store VALUES(1,?,?,?)').run('John Michael', 'John Michael', 'Tarlac City');
    const P = [['Linen Blend Shirt', 'LBS-001', 'M', 'Sage', 3, 38, 10], ['Tailored Sand Blazer', 'TSB-012', 'L', 'Sand', 5, 120, 10],
      ['Classic Shoulder Bag', 'CSB-042', 'One size', 'Tan', 8, 65, 10], ['Classic Cotton Tee', 'CCT-100', 'M', 'White', 86, 18, 15],
      ['Denim Jacket', 'DNJ-210', 'L', 'Blue', 24, 75, 8], ['Pleated Midi Skirt', 'PMS-330', 'S', 'Black', 17, 42, 8],
      ['Wool Beanie', 'WBN-401', 'One size', 'Gray', 40, 15, 10], ['Cargo Pants', 'CGP-515', '32', 'Olive', 12, 55, 8]];
    const ins = db.prepare('INSERT INTO products(name,sku,size,color,qty,price,thr) VALUES(?,?,?,?,?,?,?)');
    const prods = P.map(p => ({ id: Number(ins.run(...p).lastInsertRowid), price: p[5] }));
    const sup = db.prepare('INSERT INTO suppliers(name,contact,email,products) VALUES(?,?,?,?)');
    sup.run('Evergreen Textiles', 'Ana Reyes', 'ana@evergreen.ph', 'Linen, cotton fabrics');
    sup.run('Urban Thread Co.', 'Marco Dela Cruz', 'marco@urbanthread.ph', 'Denim, cargo pants');
    let s = 7; const r = () => (s = (s * 9301 + 49297) % 233280) / 233280;
    const io = db.prepare('INSERT INTO orders(id,created_at,total) VALUES(?,?,?)'), ii = db.prepare('INSERT INTO order_items(order_id,product_id,qty,price) VALUES(?,?,?,?)');
    let n = 1001;
    for (let d = 13; d >= 0; d--) for (let k = 0, c = 2 + Math.floor(r() * 3); k < c; k++) {
      const items = [], m = 1 + Math.floor(r() * 2);
      for (let j = 0; j < m; j++) items.push({ p: prods[Math.floor(r() * r() * 8)], qty: 1 + Math.floor(r() * 3) });
      const dt = new Date(); dt.setDate(dt.getDate() - d); dt.setHours(9 + k * 3, 0, 0, 0);
      io.run(n, dt.toISOString(), items.reduce((t, i) => t + i.qty * i.p.price, 0));
      items.forEach(i => ii.run(n, i.p.id, i.qty, i.p.price)); n++;
    }
    log('Welcome to StockSync', 'Demo data loaded');
  });
}
if (!db.prepare('SELECT 1 FROM users').get()) seed();
// Existing databases still holding the old default login get the new one
if (db.prepare("SELECT 1 FROM users WHERE email='maya@stocksync.com'").get()) setUser('john@stocksync.com', 'tsm3b');
db.exec("UPDATE store SET name='John Michael', owner='John Michael' WHERE name='Maya Boutique'");

const state = () => {
  const items = {};
  db.prepare('SELECT * FROM order_items').all().forEach(i => (items[i.order_id] ??= []).push({ pid: String(i.product_id), qty: i.qty }));
  return {
    user: { email: db.prepare('SELECT email FROM users').get().email },
    store: { ...db.prepare('SELECT name,owner,address FROM store WHERE id=1').get() },
    products: db.prepare('SELECT * FROM products ORDER BY id').all().map(p => ({ ...p, id: String(p.id) })),
    orders: db.prepare('SELECT * FROM orders ORDER BY id').all().map(o => ({ id: o.id, date: o.created_at, total: o.total, items: items[o.id] || [] })),
    suppliers: db.prepare('SELECT * FROM suppliers ORDER BY id').all().map(s => ({ ...s, id: String(s.id) })),
    activity: db.prepare('SELECT msg,sub,ts AS t FROM activity ORDER BY id DESC LIMIT 30').all().map(a => ({ ...a })),
  };
};

const sessions = new Set();
const getSid = req => (req.headers.cookie || '').split(';').map(c => c.trim()).find(c => c.startsWith('sid='))?.slice(4);

function handle(req, body, res) {
  const m = req.method, p = new URL(req.url, 'http://x').pathname.replace(/^\/api/, ''); let x;
  if (m === 'POST' && p === '/login') {
    const u = db.prepare('SELECT * FROM users WHERE email=?').get(str(body.email).toLowerCase());
    const ok = u && crypto.timingSafeEqual(Buffer.from(hash(String(body.password ?? ''), u.salt)), Buffer.from(u.hash));
    if (!ok) bad('Incorrect email or password.', 401);
    const sid = crypto.randomBytes(24).toString('hex'); sessions.add(sid);
    res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; SameSite=Strict; Path=/`);
    return { ok: true };
  }
  if (m === 'POST' && p === '/logout') { sessions.delete(getSid(req)); res.setHeader('Set-Cookie', 'sid=; Max-Age=0; Path=/'); return { ok: true }; }
  if (!sessions.has(getSid(req))) bad('Not logged in.', 401);

  if (m === 'GET' && p === '/state') return state();
  if (m === 'POST' && p === '/products') {
    const v = [str(body.name), str(body.sku), str(body.size, false), str(body.color, false), Math.floor(num(body.qty)), num(body.price), Math.floor(num(body.thr))];
    if (db.prepare('SELECT 1 FROM products WHERE lower(sku)=lower(?) AND id IS NOT ?').get(v[1], body.id ? Number(body.id) : null)) bad('That SKU already exists.');
    if (body.id) { db.prepare('UPDATE products SET name=?,sku=?,size=?,color=?,qty=?,price=?,thr=? WHERE id=?').run(...v, Number(body.id)); log('Product updated', v[0]); }
    else { db.prepare('INSERT INTO products(name,sku,size,color,qty,price,thr) VALUES(?,?,?,?,?,?,?)').run(...v); log('Product added', v[0]); }
    return state();
  }
  if ((x = p.match(/^\/products\/(\d+)(\/restock)?$/))) {
    const pr = db.prepare('SELECT * FROM products WHERE id=?').get(+x[1]); if (!pr) bad('Product not found.', 404);
    if (m === 'POST' && x[2]) { db.prepare('UPDATE products SET qty=qty+10 WHERE id=?').run(pr.id); log('Stock count updated', pr.name + ' · +10'); return state(); }
    if (m === 'DELETE') { db.prepare('DELETE FROM products WHERE id=?').run(pr.id); log('Product removed', pr.name); return state(); }
  }
  if (m === 'POST' && p === '/orders') {
    const need = {};
    (Array.isArray(body.items) ? body.items : []).forEach(i => { const q = Math.floor(num(i.qty, 1)); need[i.pid] = (need[i.pid] || 0) + q; });
    if (!Object.keys(need).length) bad('Add at least one item.');
    tx(() => {
      let total = 0, units = 0; const lines = [];
      for (const pid in need) {
        const pr = db.prepare('SELECT * FROM products WHERE id=?').get(Number(pid)); if (!pr) bad('Product not found.');
        if (need[pid] > pr.qty) bad(`Not enough stock for ${pr.name} (only ${pr.qty} left).`);
        lines.push([pr, need[pid]]); total += need[pid] * pr.price; units += need[pid];
      }
      const oid = Number(db.prepare('INSERT INTO orders(created_at,total) VALUES(?,?)').run(new Date().toISOString(), total).lastInsertRowid);
      for (const [pr, q] of lines) {
        db.prepare('UPDATE products SET qty=qty-? WHERE id=?').run(q, pr.id);
        db.prepare('INSERT INTO order_items(order_id,product_id,qty,price) VALUES(?,?,?,?)').run(oid, pr.id, q, pr.price);
      }
      log(`Order #${oid} completed`, `${units} items · ₱${total.toLocaleString()}`);
    });
    return state();
  }
  if (m === 'POST' && p === '/suppliers') {
    const v = [str(body.name), str(body.contact, false), str(body.email, false), str(body.products, false)];
    if (body.id) db.prepare('UPDATE suppliers SET name=?,contact=?,email=?,products=? WHERE id=?').run(...v, Number(body.id));
    else { db.prepare('INSERT INTO suppliers(name,contact,email,products) VALUES(?,?,?,?)').run(...v); log('New supplier added', v[0]); }
    return state();
  }
  if (m === 'DELETE' && (x = p.match(/^\/suppliers\/(\d+)$/))) { db.prepare('DELETE FROM suppliers WHERE id=?').run(+x[1]); return state(); }
  if (m === 'POST' && p === '/settings') { db.prepare('UPDATE store SET name=?,owner=?,address=? WHERE id=1').run(str(body.name), str(body.owner), str(body.address, false)); return state(); }
  if (m === 'POST' && p === '/account') {
    const e = str(body.email), pw = String(body.pass || ''); if (pw.length < 6) bad('Password must be at least 6 characters.');
    setUser(e, pw); return state();
  }
  if (m === 'POST' && p === '/reset') { seed(); return state(); }
  bad('Not found.', 404);
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith('/api')) {
    if (req.method === 'GET') { // any non-API page path serves the app
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
    }
    res.writeHead(404); return res.end('Not found');
  }
  let raw = '';
  req.on('data', c => { raw += c; if (raw.length > 1e6) req.destroy(); });
  req.on('end', () => {
    let out, status = 200;
    try { out = handle(req, raw ? JSON.parse(raw) : {}, res); }
    catch (e) { status = e.status || (e.message?.includes('UNIQUE') ? 400 : 500); out = { error: e.status ? e.message : e.message?.includes('UNIQUE') ? 'That value already exists.' : 'Server error.' }; if (status === 500) console.error(e); }
    res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out));
  });
}).listen(PORT, () => console.log(`StockSync running → http://localhost:${PORT}`));
