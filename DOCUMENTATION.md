# nexbackend — Architecture & Onboarding

New-joiner guide for the **nexbackend** Core API. The exhaustive endpoint catalog lives in `README.md` — this document covers *how the system is wired together* and how to run it. Do not edit `README.md`.

---

## Zeu Platform — System Overview

| Component | Repository | Stack | Responsibility |
|-----------|------------|-------|----------------|
| Customer App | Zeu | React Native (Expo) | Customer shopping app |
| ZeuKeeper App | shopkeeper (ZeuKeeper) | React Native (Expo) | Merchant ops app |
| Admin Panel | admin-1 | React + Vite | Web console |
| Core API | nexbackend | Node/Express 5, PostgreSQL (Neon) via `pg` + ImageKit | Main REST + Socket.IO API: auth, users, shops, orders, inventory, subscriptions, notifications, recommendations, navigation |
| Global Inventory API | inventory-backend | Node/Express, PostgreSQL (Neon) | Product catalog & AI recommendations service |

Prod URLs: Core API `https://nexbackend.onrender.com`; Global Inventory API port `3001`; Chatbot `https://zeu-backend.onrender.com`. Cross-cutting: JWE JWT (jose) issued here, shared JWT_SECRET with inventory-backend; Socket.IO; FCM + Expo push.

---

## Architecture

### Request lifecycle
`server.js` mounts middleware in this order (Express 5 router):

1. **Security middleware** (`middleware/security.js`) — `securityHeaders` (CSP, HSTS in prod, strips `X-Powered-By`), then `requestSizeLimiter` (10 MB cap → 413).
2. **CORS** — `cors(securityMiddleware.corsConfig)`. In production origins are the three Vercel/Expo allow-list (`config/environment.js:corsOrigins`); dev allows all. See *Deploy / Render Notes*.
3. **Rate limit** (`middleware/validation.js:createRateLimiter`) — 1000 requests / 15 min per IP (in-memory `Map`). `trackingRateLimiter` = 30/min for tracking endpoints.
4. **Body parsing** — `express.json({limit:'10mb'})` + `urlencoded`.
5. **Sanitization + logging** — `sanitizeRequest` (trims query/params), `requestLogger`.
6. **`req.io` injection** — every request gets the Socket.IO server so routes can emit events.
7. **Inventory hooks** — `attachInventoryHooks` attaches `req.inventoryHooks` (order-created/cancelled/payment-failed/timeout/rejected stock handlers).
8. **Auth + routes** — JWT verification (`middleware/auth.js`) is applied *per-route*, not globally. Routes are mounted under `/api/*` (see *Full API Reference*).
9. **404 + error handler** — `notFoundHandler`, `errorHandler` (maps `ValidationError`/`UnauthorizedError`/etc. to codes; details only in non-prod).

Plain HTTP health routes (`/`, `/health`, `/api`, `/api/socket-status`, `/api/db-status`, `/api/debug-admin`) are registered **before** the API routes.

### Socket.IO
Mounted on the same HTTP server (`new Server(server, {cors...})` in `server.js:80`). Transports: websocket + polling; `pingTimeout 60s`, `pingInterval 25s`. Clients join rooms:
- `shop_<id>` (shopkeeper), `customer_<id>` (customer), `admin` (admin).
- `updateOrderStatus` from shopkeeper → broadcasts `orderStatusUpdate` to admin room + `customer_<id>` room.
- `notifyCustomer` / `notifyShopkeeper` / `broadcastToShopkeepers` / `broadcastToCustomers` for admin↔user messaging.
- `shopkeeperOnline/Offline` and `customerOnline/Offline` notify the admin room on connect/disconnect.

### Cron jobs
Started inside the `server.listen` callback (`server.js:518`):
- `startRestockCron()` → `cron/inventory.restock.cron.js`
- `startShoppingListCleanupCron()` → `cron/shoppingList.cleanup.cron.js` (guarded on `shopping_lists` table existing)
- `startSubscriptionStatusCron()` → `cron/subscription.status.cron.js`

All use `node-cron` and run against the shared `mysql2` pool (`config/db.js`).

### Firebase / FCM + Expo push
- **FCM**: `config/firebase.js` initializes the Firebase Admin SDK from `FIREBASE_SERVICE_ACCOUNT_KEY` (or `_SERVICE_ACCOUNT`), project `nexkirana-c9da5`. `sendFCMPush`/`sendFCMNotification` in `utils/fcmPush.js` send high-priority Android notifications.
- **Expo**: `utils/expoPush.js` uses `expo-server-sdk`, validates `Expo.isExpoPushToken`, chunk-sends, validates receipts, and auto-cleans invalid tokens from `users`/`shopkeepers` `expo_push_token` columns. Has a 30 s in-memory dedup window per `token:action:resourceId`.
- Routes decide FCM vs Expo per token (`fcmPush.isFCMToken`).

### Recommendations / inventory bridge to inventory-backend
- `services/recommendation.service.js` computes recommendations **locally** from this DB (co-purchase graph, Jaccard content similarity, category affinity, popularity) — no outbound HTTP call.
- The inventory-backend peer service is a separate Node/Express + PostgreSQL (Neon) app on port `3001`. The bridge is **not** an HTTP call from this repo; it is enabled by the **shared `JWT_SECRET`** so tokens minted here are verifiable there (token portability). `config/inventory.db.bridge.js` and `utils/inventory.service.bridge.js` operate on *this* Neon Postgres pool (`deductStockForOrder`, `restoreStockForOrder`, `syncAvailableStockStatus`, `handleAutoRestock`) — single `pg` Pool, no duplicate Sequelize. `global_products` (catalog) lives in this DB.

---

## Local Development

Requires **Node >= 18.17** (`package.json:engines`).

```bash
npm install                 # install deps (ESM, "type":"module")
cp .env.example .env        # then fill real values (see Env Vars)
npm run dev                 # nodemon server.js
npm start                   # production node server.js
npm test                    # jest --passWithNoTests
npm run lint                # eslint .
# extras
npm run test:watch
npm run test:service-status
npm run test:service-status:pbt
```

Configure a **Neon Postgres** DB and set `DATABASE_URL` (or `PGHOST/PGUSER/PGPASSWORD/PGDATABASE`) — legacy `DB_HOST/DB_USER/DB_PASS/DB_NAME` still works via compat layer but `DATABASE_URL` is preferred. Set `PGSSLMODE=require`. On boot the server self-heals schema: adds `users.wallet` and `orders.instant_discount` columns if missing, creates `stock_restoration_log`, initializes service-status tables from `migrations/001_create_service_status_tables.sql`, resets sequences to start at 1 (`migrations/007_reset_auto_increment_to_one.sql`), and starts the three crons. Fresh DB: run `psql $DATABASE_URL -f schema/nexkirana_postgres_schema.sql`.

---

## Environment Variables

Sourced from `.env.example`. Validation lives in `config/environment.js` (`requiredEnvVars` + `JWT_SECRET` ≥ 32 chars). `ALLOW_PARTIAL_ENV`/`RENDER=true` lets the server boot with missing vars (Render).

| Name | Required? | Default | Description | Where consumed |
|------|-----------|---------|-------------|----------------|
| `ADMIN_EMAIL` | No | `nexkirana@kirana.com` | Admin login email | `config/environment.js`, `adminRoute.js` |
| `ADMIN_PASSWORD` | No | `qwI41L5U47RwaI47DasA` | Admin login password | `config/environment.js`, `adminRoute.js` |
| `JWT_SECRET` | **Yes** | — | JWE key (≥32 chars); **shared with inventory-backend** | `utils/jweToken.js`, `config/environment.js` |
| `JWT_EXPIRES_IN` | No | `7d` | Token lifetime | `config/environment.js` |
| `DATABASE_URL` | **Yes** | — | Neon Postgres connection string `postgresql://...?sslmode=require` (preferred) | `config/db.js`, `config/environment.js` |
| `PGHOST` | No* | — | Neon host fallback | `config/db.js` |
| `PGUSER` | No* | — | Neon user | `config/db.js` |
| `PGPASSWORD` | No* | — | Neon password | `config/db.js` |
| `PGDATABASE` | No* | — | Neon database | `config/db.js` |
| `PGPORT` | No | `5432` | Neon port | `config/db.js` |
| `PGSSLMODE` | No | `require` | PG SSL mode | `config/db.js` |
| `DB_HOST` | No | — | Legacy TiDB host (deprecated, compatibility via `pg` translator) | `config/db.js` |
| `DB_USER` | No | — | Legacy user | `config/db.js` |
| `DB_PASS` | No | — | Legacy password | `config/db.js` |
| `DB_NAME` | No | — | Legacy database | `config/db.js` |
| `DB_PORT` | No | `5432` | Legacy port | `config/environment.js` |
| `DB_SSL` | No | `true` | Legacy SSL flag | `config/db.js`, `config/environment.js` |
| `DB_SSL_CA` | No | — | Path to CA cert (optional) | `config/environment.js` |
| `IMAGEKIT_PUBLIC_KEY` | **Yes** | — | ImageKit public key | `config/imagekit.js` |
| `IMAGEKIT_PRIVATE_KEY` | **Yes** | — | ImageKit private key | `config/imagekit.js` |
| `IMAGEKIT_URL_ENDPOINT` | **Yes** | — | ImageKit URL endpoint | `config/imagekit.js` |
| `CLOUDINARY_CLOUD_NAME` | No | — | Cloudinary cloud (deprecated shim → ImageKit) | `config/cloudinary.js` |
| `CLOUDINARY_API_KEY` | No | — | Cloudinary key (deprecated) | `config/cloudinary.js` |
| `CLOUDINARY_API_SECRET` | No | — | Cloudinary secret (deprecated) | `config/cloudinary.js` |
| `NODE_ENV` | No | `development` | Mode; toggles CORS/prod headers | `config/environment.js`, `security.js` |
| `PORT` | No | `5000` | Listen port | `server.js`, `config/environment.js` |
| `GOOGLE_CLIENT_ID` | No | — | Google OAuth web client ID | `utils/googleAuth.js`, `googleAuthRoute.js` |
| `GOOGLE_CLIENT_SECRET` | No | — | Google OAuth secret | `googleAuthRoute.js` |
| `GOOGLE_CALLBACK_URL` | No | — | Google OAuth redirect | `googleAuthRoute.js` |
| `RESEND_API_KEY` | No | — | Resend email key (prod email) | `config/email.resend.js` |
| `RESEND_FROM_EMAIL` | No | `noreply@reset.nexkirana.in` | From address | `config/email.resend.js` |
| `RESEND_FROM_NAME` | No | `Zeu` | From name | `config/email.resend.js` |
| `RESEND_TEMPLATE_PASSWORD_RESET` | No | — | Resend template id | `passwordResetRoute.js` |
| `RESET_REDIRECT_URL` | No | `https://nexbackend.onrender.com` | Password-reset deep link base | `deepLinkRedirect.js` |
| `EMAIL_USER` | No | — | Gmail SMTP user (dev only) | `config/email.js` |
| `EMAIL_PASSWORD` | No | — | Gmail app password (dev only) | `config/email.js` |
| `SMTP_HOST` | No | — | SMTP host (nodemailer) | `config/email.js` |
| `SMTP_PORT` | No | `587` | SMTP port | `config/email.js` |
| `SMTP_USER` | No | — | SMTP user | `config/email.js` |
| `SMTP_PASS` | No | — | SMTP pass | `config/email.js` |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | No | — | Firebase SA JSON (single line) | `config/firebase.js`, `utils/fcmPush.js` |
| `FIREBASE_SERVICE_ACCOUNT` | No | — | Alt Firebase SA key | `utils/fcmPush.js` |
| `ALLOW_PARTIAL_ENV` | No | `false` | Boot despite missing vars | `config/environment.js` |
| `RENDER` | No | `false` | Render deploy flag (same effect) | `config/environment.js`, `server.js` |
| `RESTOCK_CRON_SCHEDULE` | No | `0 0 * * *` | Inventory restock cron expr | `cron/inventory.restock.cron.js` |
| `STAGING_URL` | No | `https://staging-nexbackend.onrender.com` | Staging base URL | `config/environment.js` |
| `ENFORCE_SUBSCRIPTIONS` | No | `false` | Enable subscription blocking | `middleware/checkSubscription.js` |

Optional/future-use (placeholders in `.env.example`): `RAZORPAY_KEY_ID/SECRET`, `TWILIO_*`.

---

## Data Flow (key flows)

- **Signup / login (JWE):** client POSTs credentials → `authRoute.js`/`userRoute.js`/`shopkeeperRoute.js` verify with `bcryptjs` → `createJWEToken(payload,{id,role},'7d')` (`utils/jweToken.js`) → encrypted JWE (`dir` + `A256GCM`) returned as `Bearer` token. Apps store in Expo SecureStore.
- **Place order (transaction):** validate stock → create `orders` + `order_items` → `onOrderCreated` hook deducts stock (`deductStockForOrder`, sets `available_stock`, schedules `restockAt` if 0) → store credits / wallet adjustment → push notifications (FCM/Expo to shopkeeper + customer) → wellness points logic (`utils/wellnessPoints.js`). Cancellation/rejection/payment-failure/time-out → `restoreStockForOrder` + `stock_restoration_log`.
- **Shopkeeper verification → billing:** admin verifies shopkeeper (`adminRoute.js`) → sets `is_verified`; billing cycles managed via `billing_payments` + `payment_info`; `utils/revenue.js` computes platform fee tiers and generates bills.
- **Subscription cron lifecycle:** hourly `subscription.status.cron.js`: `active` → `grace_period` (payment overdue) → `suspended` (grace ended). `checkSubscription.js` blocks suspended shopkeepers (403) unless `ENFORCE_SUBSCRIPTIONS=false`. 15-day billing + 2-day grace (cron doc); `subscription.js` notes 30-day + 2-day — see gotcha.
- **Password reset deep link:** `passwordResetRoute.js` emails a link via Resend/SMTP → `deepLinkRedirect.js` (`/reset-password`) redirects into app with token; reset verifies JWE.
- **Navigation / delivery tracking:** `navigationRoute.js` calls OSRM + Nominatim for routing; live status + delivery timer (`order_timers`) pushed over Socket.IO (`updateOrderStatus`, `orderStatusUpdate`).

---

## Database Schema (summary)

**Neon Postgres** (migrated from MySQL/TiDB; `pg` pool, sequences start at 1 via `SERIAL`). Legacy MySQL schema kept at `schema/nexkirana_complete_schema.sql` with `AUTO_INCREMENT=1`. Fresh Postgres schema: `schema/nexkirana_postgres_schema.sql`. Main tables (`README.md#database-schema`):

| Table | Purpose |
|-------|---------|
| `users` | Customers: store_credits, google_id, push tokens, referral codes, wallet |
| `shopkeepers` | Merchants: subscription status, billing dates, shop scale, verification, geo-coordinates |
| `admins` | Admin accounts (single/admin auth) |
| `products` | Shop-specific products: stock, baselineQty, barcode, price, available_stock |
| `global_products` | Central catalog with shop_scales (JSON) |
| `orders` | Orders: user/shopkeeper refs, status, amounts, credits, delivery info, pickup codes |
| `order_items` | Line items per order |
| `billing_payments` | Subscription payment records with approval tracking |
| `payment_info` | Admin payment credentials (UPI, bank, QR) |
| `refer_transaction` | Referral reward transactions |
| `inventory_logs` | Inventory change audit trail |
| `price_history` | Product price change history |
| `stock_restoration_log` | Cancelled-order stock restoration audit |
| `service_status` | Current platform online/offline status |
| `service_status_history` | Status change history |
| `order_timers` | Active session-limit timers for pickup/Click & Collect |
| `inventory_alerts` | Low-stock alerts / system notifications |
| `barcode_scans` | Barcode lookup scan logs |
| `shopping_lists` | Customer persistent lists (items + Cloudinary images), 15-day retention |

---

## Auth Model

- **JWE tokens** via `jose` (`EncryptJWT`, `alg:dir`, `enc:A256GCM`). Secret = `JWT_SECRET` padded/truncated to 32 bytes in `getJWESecret()`. Payload carries `id`, `role`, `iat`, `exp`, `jti`.
- **Verification** (`middleware/auth.js`): requires `Bearer` header, decrypts, checks `exp`, checks in-memory **blacklist** (`blacklistToken`/`tokenBlacklist` Set — not shared across instances). Errors map to `NO_TOKEN`/`INVALID_FORMAT`/`TOKEN_EXPIRED`/`TOKEN_REVOKED`/`INVALID_TOKEN`.
- **X-New-Token refresh:** when `<24h` to expiry, `auth.js` (and `tokenRefresh.js`) set `X-New-Token`, `X-Token-Refresh:true`, `X-Token-Expires-In`, `X-Token-Type:JWE` response headers. Clients should swap to the new token.
- **Admin auth:** separate `adminAuth.js` verifies admin tokens (admin issued via `ADMIN_EMAIL`/`ADMIN_PASSWORD`).
- **Subscription enforcement:** `checkSubscription.js` (opt-in via `ENFORCE_SUBSCRIPTIONS`) blocks `suspended` shopkeepers. `checkPaymentStatus.js` is **disabled** (import commented out).

> Note: `jose` (JWE) is used here, while `jsonwebtoken` is also a dependency — inventory-backend must use the **same JWE scheme + shared `JWT_SECRET`**, otherwise `ERR_JWE_DECRYPTION_FAILED` → `MALFORMED_TOKEN`.

---

## Socket.IO Events

Server (`server.js:154`) rooms: `shop_<id>`, `customer_<id>`, `admin`.

| Event | Direction | Description |
|-------|-----------|-------------|
| `joinShop(shopkeeper_id)` | C→S | Shopkeeper joins shop room |
| `joinCustomer(user_id)` | C→S | Customer joins customer room |
| `joinAdmin(admin_id)` | C→S | Admin joins admin room |
| `updateOrderStatus(data)` | C→S | Shopkeeper updates status → broadcast to customer + admin |
| `notifyCustomer(data)` | C→S | Shopkeeper → customer message |
| `broadcastToShopkeepers(msg)` | C→S | Admin → all shopkeepers |
| `broadcastToCustomers(msg)` | C→S | Admin → all customers |
| `notifyShopkeeper(data)` | C→S | Admin → specific shopkeeper |
| `leaveRoom(room)` | C→S | Leave room |
| `disconnect` | C→S | Notifies admin of offline |
| `orderStatusUpdate` | S→C | Order status changed |
| `adminBroadcast` | S→C | Admin broadcast |
| `adminNotification` | S→C | Admin → shopkeeper notification |
| `shopkeeperOnline/Offline` | S→Admin | Shopkeeper connection status |
| `customerOnline/Offline` | S→Admin | Customer connection status |

---

## Cron Jobs

| Job | Schedule | Action |
|-----|----------|--------|
| `subscription.status.cron.js` | Hourly `0 * * * *` | `active`→`grace_period`→`suspended` by payment/grace dates; logs distribution |
| `inventory.restock.cron.js` | Daily `0 0 * * *` (override `RESTOCK_CRON_SCHEDULE`) | Restores `stock=0` products to `baselineQty` (skips `INVISIBLE`) |
| `shoppingList.cleanup.cron.js` | Daily `0 0 * * *` | Deletes `shopping_lists` > 15 days old + their ImageKit images (migrated from Cloudinary) |

---

## Deploy / Render Notes

- `RENDER=true` (or `ALLOW_PARTIAL_ENV=true`) lets the app boot even when required env vars are absent — used so Render can start before secret injection.
- **CORS per env:** production allow-list is hardcoded in `config/environment.js:corsOrigins` (`nexadminpanel.vercel.app`, `nexkirana-admin.vercel.app`, `nexkirana.vercel.app`); `security.js:corsConfig` also permits `exp://`/`exps://` Expo origins. Development = allow all. The Socket.IO CORS handler currently allows all origins in production as a fallback (see `server.js:99`).
- Set `NODE_ENV=production` for HSTS + redacted errors + prod CORS. Neon: `DATABASE_URL` with `?sslmode=require` or `PGSSLMODE=require` (legacy `DB_SSL=true` still honored). Sequences start at 1 via `migrations/007_reset_auto_increment_to_one.sql`.
- Health: `/health` and `/api/socket-status` are unauthenticated for uptime checks.

---

## Full API Reference

The complete endpoint catalog (auth, user, shopkeeper, admin, orders, inventory, notifications, recommendations, referral, shopping list, navigation, service status) is in `README.md`. Top-level route groups mounted in `server.js`:

| Base path | Router |
|-----------|--------|
| `/api/auth` | `authRoute.js`, `googleAuthRoute.js` |
| `/api/password-reset` | `passwordResetRoute.js` |
| `/reset-password` | `deepLinkRedirect.js` |
| `/api/service` | `serviceStatusRoute.js` (public) |
| `/api/user` | `userRoute.js` |
| `/api/shopkeeper` | `shopkeeperRoute.js`, `supportTicketRoute.js` |
| `/api/admin` | `adminRoute.js` |
| `/api/orders` | `ordersRoute.js` |
| `/api/prefetch` | `orderPrefetchRoute.js` |
| `/api/notifications` | `notificationRoute.js` |
| `/api/inventory` | `inventoryRoute.js` |
| `/api/user/recommendations`, `/api/recommendations` | `recommendationRoute.js` |
| `/api/refer` | `referralRoute.js` |
| `/api/shopping-list` | `shoppingListRoute.js` |
| `/api/inventory-mgmt` | `inventory.routes.wrapper.js` |
| `/api/navigation` | `navigationRoute.js` |
| `/api/shops` | `shopResolveRoute.js` |

---

## Troubleshooting / Gotchas

- **JWE vs JWT mismatch with inventory-backend:** tokens here are JWE (`jose`, `A256GCM`). If inventory-backend expects plain JWT (or a different `JWT_SECRET`), decryption fails (`ERR_JWE_DECRYPTION_FAILED` → `MALFORMED_TOKEN`). Keep the **same secret + same JWE scheme** across both services.
- **TiDB DB SSL:** set `DB_SSL=true`; for strict CA use `DB_SSL_CA`. Plaintext connections to TiDB Cloud will fail.
- **FCM credentials:** `FIREBASE_SERVICE_ACCOUNT_KEY` must be valid JSON on a single line; missing/invalid → FCM silently skipped (logged). Invalid FCM tokens are auto-nulled in DB.
- **Rate limits:** 1000 req/15 min global, 30/min on tracking endpoints (in-memory, per-process — resets on restart, not shared across instances). 10 MB body cap.
- **Token blacklist is in-memory:** `tokenBlacklist` is a `Set` per process — logout/revoke does not propagate across multiple instances/replicas.
- **Subscription billing period mismatch:** cron docs say *15-day billing + 2-day grace*; `subscription.js` util says *30-day + 2-day*. Confirm the authoritative cycle before relying on suspension timing.
- **Dead / unused files** (from `README.md`): `routes/ordersRoute.fast.js`, `utils/errorCodes.js`, `utils/orderBatch.service.js`, `utils/orderCache.service.js`, `utils/clientTokenHandler.js` (mobile code), `middleware/checkPaymentStatus.js` (import commented out), `migrations/add_idempotency_key.sql`, `bun.lock` (stale). Don't build on these.
- **Email on Render:** Gmail SMTP is blocked on Render — use Resend (`RESEND_API_KEY`) in production; Gmail SMTP is dev-only.
