# StockSync (full stack)

**Stack:** HTML/CSS/JavaScript frontend, Node.js backend (REST API), SQLite database (built into Node, no installs).

## Run
1. Install Node.js 22.5 or newer (https://nodejs.org, LTS is fine). Check with `node -v`.
2. Put `server.js`, `index.html` and `package.json` in one folder.
3. In a terminal inside that folder: `node server.js`  (or `npm start`)
4. Open http://localhost:3000
5. Log in: `john@stocksync.com` / `tsm3b`

The database file `stocksync.db` is created automatically on first run with demo data.
Delete that file (or use Settings > Reset demo data) to start fresh.

## Database tables
users, store, products, suppliers, orders, order_items, activity

## API (all under /api, session cookie after login)
POST /login, POST /logout, GET /state
POST /products, POST /products/:id/restock, DELETE /products/:id
POST /orders (checks stock, deducts it inside a transaction)
POST /suppliers, DELETE /suppliers/:id
POST /settings, POST /account, POST /reset
