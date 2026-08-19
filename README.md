# NexKirana Backend

A Node.js/Express backend server for NexKirana — a kirana (grocery) store management platform connecting shopkeepers and customers.

## Tech Stack

- **Runtime:** Node.js (>=18.17)
- **Framework:** Express 5
- **Database:** MySQL / TiDB Cloud (via `mysql2`)
- **Auth:** JWE (Encrypted JWT) using `jose`
- **Push Notifications:** Expo Push SDK & Firebase Cloud Messaging
- **File Uploads:** Multer + Cloudinary
- **Real-time:** Socket.IO
- **Email:** Nodemailer / Resend
- **Cron:** node-cron
- **Testing:** Jest

## Quick Start

```bash
# Install dependencies
npm install

# Copy env and configure
cp .env.example .env

# Start dev server
npm run dev

# Production
npm start

# Run test suite
npm test

# Run tests in watch mode
npm run test:watch

# Run service status tests
npm run test:service-status

# Run service status property-based tests
npm run test:service-status:pbt

# Run ESLint check
npm run lint
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | `development` | Environment mode |
| `PORT` | No | `5000` | Server port |
| `JWT_SECRET` | **Yes** | — | JWE encryption key (min 32 chars) |
| `DB_HOST` | **Yes** | — | Database host (TiDB Cloud) |
| `DB_PORT` | No | `4000` | Database port (standard fallback for TiDB Cloud) |
| `DB_USER` | **Yes** | — | Database user |
| `DB_PASS` | **Yes** | — | Database password |
| `DB_NAME` | **Yes** | — | Database name |
| `DB_SSL` | No | `false` | Enable SSL for DB connection |
| `DB_SSL_CA` | No | — | Optional path to SSL CA certificate |
| `ADMIN_EMAIL` | No | `nexkirana@kirana.com` | Admin login email |
| `ADMIN_PASSWORD` | No | `qwI41L5U47RwaI47DasA` | Admin login password |
| `CLOUDINARY_CLOUD_NAME` | No | — | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | No | — | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | No | — | Cloudinary API secret |
| `GOOGLE_CLIENT_ID` | No | — | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | No | — | Google OAuth client secret |
| `GOOGLE_CALLBACK_URL` | No | — | Google OAuth redirect callback URL |
| `RESEND_API_KEY` | No | — | Resend API key for emails |
| `SMTP_HOST` | No | — | SMTP host for nodemailer |
| `SMTP_PORT` | No | `587` | SMTP port |
| `SMTP_USER` | No | — | SMTP username |
| `SMTP_PASS` | No | — | SMTP password |
| `FIREBASE_SERVICE_ACCOUNT` | No | — | Firebase service account JSON |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | No | — | Firebase service account JSON string (alternative key name) |
| `ENFORCE_SUBSCRIPTIONS` | No | `false` | Enable subscription enforcement |
| `RESTOCK_CRON_SCHEDULE` | No | `0 0 * * *` | Cron schedule for inventory restocking |
| `STAGING_URL` | No | `https://staging-nexbackend.onrender.com` | Staging environment endpoint URL |

---

# API Reference

## Health & System Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/` | No | Root health check |
| `GET` | `/health` | No | Health check with DB & Socket.IO status |
| `GET` | `/api` | No | API info |
| `GET` | `/api/socket-status` | No | Socket.IO connection status |
| `GET` | `/api/db-status` | No | Database tables & record counts |
| `GET` | `/api/debug-admin` | No | Debug admin table structure |

## Auth Routes — `/api/auth`

### Standard Auth (`authRoute.js` — 92 lines)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/auth/logout` | Token | Logout — blacklists the current JWE token |
| `GET` | `/api/auth/validate-token` | Token | Validate current token and get expiry info |
| `POST` | `/api/auth/refresh-token` | Token | Refresh token if close to expiration |

### Google OAuth (`googleAuthRoute.js` — 499 lines)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/auth/google/test` | No | Test endpoint for Google auth |
| `POST` | `/api/auth/google/users` | No | Google Sign-In for customers (creates/links user) |
| `POST` | `/api/auth/google/shopkeepers` | No | Google Sign-In for shopkeepers (links existing) |
| `POST` | `/api/auth/google/shopkeepers/register` | No | Complete shopkeeper registration via Google |

**Functions:**
- `verifyGoogleToken(idToken)` — Verifies Google ID token and returns payload (email, name, picture)

## Password Reset — `/api/password-reset`

(`passwordResetRoute.js` — 418 lines)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/password-reset/request` | No | Request password reset email (rate-limited to 3/15min) |
| `POST` | `/api/password-reset/verify` | No | Verify password reset token validity |
| `POST` | `/api/password-reset/reset` | No | Reset password using token |
| `GET` | `/api/password-reset/redirect` | No | HTML redirect page for email deep links |

## Deep Link Redirect — `/reset-password`

(`deepLinkRedirect.js` — 202 lines)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/reset-password` | No | HTML page that redirects to the app's deep link for password reset |

## User Routes — `/api/user`

(`userRoute.js` — 783 lines)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/user/signup` | No | Register new user (rate-limited: 5/15min) |
| `POST` | `/api/user/signin` | No | User login — returns JWE token |
| `GET` | `/api/user/profile/:id` | No | Get user profile by ID |
| `PUT` | `/api/user/profile/:id` | No | Update user profile (name, phone, address, area, landmark, pincode, img) |
| `GET` | `/api/user/nearby-shops` | No | Find nearby shops with products (double-verified distance) |
| `GET` | `/api/user/shop-info/:shopId` | No | Get public shop info for customers |
| `POST` | `/api/user/push-token` | Token | Save Expo push token for user |
| `GET` | `/api/user/products` | No | List products from all verified online shops (limit 50) |
| `GET` | `/api/user/shops/:shopId/location` | Token | Get shop location coordinates |
| `GET` | `/api/user/leaderboard` | No | Top 10 users by store_credits + current user's rank |

**Key Logic:**
- `GET /nearby-shops` performs a **triple-verification**: 1) Bounding box SQL query with Haversine, 2) Node.js re-verification, 3) Real-time product stock & status check. Returns only the **single best online shop** with products. Falls back to offline shops if no online shop has stock.
- `POST /signup` auto-generates referral codes, handles ID assignment (manual for TiDB compatibility), retries up to 5 times on duplicate insertion

## Shopkeeper Routes — `/api/shopkeeper`

(`shopkeeperRoute.js` — ~2423 lines)

### Auth & Profile

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/shopkeeper/signup` | No | Register new shopkeeper (with optional image upload) |
| `POST` | `/api/shopkeeper/signin` | No | Shopkeeper login — returns JWE token |
| `GET` | `/api/shopkeeper/profile/:id` | Token | Get own profile (verifies ownership) |
| `PUT` | `/api/shopkeeper/profile/:id` | Token | Update profile (img, upi_qr, name, phone, address, shop_name, coords, push_token) |

### Dashboard

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/shopkeeper/stats` | Token+Verified+Sub | Shop statistics (top product, sales, deliveries) |
| `GET` | `/api/shopkeeper/dashboard/summary` | Token+Verified+Sub | Complete dashboard data (sales, orders, top product, online status) |
| `PATCH` | `/api/shopkeeper/dashboard/online-status` | Token+Verified | Toggle shop online/offline |
| `PATCH` | `/api/shopkeeper/dashboard/home-delivery-status` | Token+Verified | Toggle home delivery (auto-creates column if missing) |
| `GET` | `/api/shopkeeper/analytics` | Token+Verified+Sub | Shopkeeper dashboard analytics, including top products/customers, sales growth trends, and stock alerts. Accepts `timeframe` query parameter. See [ANALYTICS_README.md](ANALYTICS_README.md) for detailed spec. |

### Shop Status

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `PATCH` | `/api/shopkeeper/shop-status` | Token+Verified | Toggle shop online/offline status |
| `GET` | `/api/shopkeeper/shop-status` | Token | Get current shop online status |

### Products

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/shopkeeper/products` | Token+Verified+Sub | List own products |
| `POST` | `/api/shopkeeper/products` | Token+Verified+Sub | Add product (with optional image upload) |
| `PUT` | `/api/shopkeeper/products/:id` | Token+Verified+Sub | Update product (stock syncs to baselineQty) |
| `DELETE` | `/api/shopkeeper/products/:id` | Token+Verified | Delete product (blocked if used in orders) |
| `PATCH` | `/api/shopkeeper/products/:id/stock` | Token+Verified | Quick stock update |
| `PUT` | `/api/shopkeeper/products/bulk/baseline` | Token+Verified+Sub | Bulk set baselineQty for all products |

### Global Products

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/shopkeeper/global-products` | Token+Verified | List global products filtered by shop scale |
| `POST` | `/api/shopkeeper/products/from-global` | Token+Verified | Add product from global catalog to own shop |

### Orders

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/shopkeeper/orders` | Token+Verified | List orders (filterable by status) with items |
| `PATCH` | `/api/shopkeeper/orders/:orderId/status` | Token+Verified+Sub | Update order status (Complete/Cancel) with stock restoration & push notification |

### Billing & Subscription

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/shopkeeper/earnings` | Token | Get billing summary with gross revenue, platform fee %, fee amount, and net payout |
| `GET` | `/api/shopkeeper/earnings/history` | Token | Payment history |
| `GET` | `/api/shopkeeper/earnings/status` | Token | Subscription status with next payment due |
| `GET` | `/api/shopkeeper/generate-bill` | Token+Verified | Generate detailed platform fee bill/receipt (gross revenue, fee brackets, net payout) |
| `GET` | `/api/shopkeeper/subscription-status` | Token | Subscription plan details |
| `POST` | `/api/shopkeeper/submit-payment` | Token | Submit payment record to admin |
| `GET` | `/api/shopkeeper/payment-history` | Token | Full payment history |
| `GET` | `/api/shopkeeper/payment-info` | Token | Get admin payment credentials (UPI, bank) |
| `GET` | `/api/shopkeeper/subscription` | Token | Detailed subscription status (calculated) |
| `POST` | `/api/shopkeeper/subscription/check-access` | Token | Check if shopkeeper can access the app |

### Scale & Misc

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `PUT` | `/api/shopkeeper/update-scale/:id` | Token | Update shop scale (activates subscription) |

**Internal Middleware:**
- `verifyShopkeeperStatus` — Checks shopkeeper exists, is not deleted, and is verified (is_verified = 1)
- `checkSubscriptionStatus` — Checks subscription is active (grace period allowed); blocks suspended accounts

## Admin Routes — `/api/admin`

(`adminRoute.js` — 2827 lines)

### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/admin/login` | No | Admin login using env credentials — returns JWE token |
| `POST` | `/api/admin/register` | No | Initial admin registration (disabled if admin exists) |
| `GET` | `/api/admin/profile` | Token | Get admin profile from token |
| `GET` | `/api/admin/:id` | Token | Get admin by ID |
| `PUT` | `/api/admin/:id` | Token | Update admin email or password |
| `DELETE` | `/api/admin/:id` | Token | Delete admin |

### Shopkeepers Management

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/admin/shopkeepers` | Token | List shopkeepers (filterable: all/pending/approved/rejected) |
| `GET` | `/api/admin/shopkeepers/stats` | Token | Shopkeeper statistics (totals, new this week/month) |
| `GET` | `/api/admin/test-verify/:id` | Token | Debug shopkeeper verification status |
| `PATCH` | `/api/admin/shopkeepers/:id/verify` | Token | Approve/reject shopkeeper (initializes billing on approve) |
| `POST` | `/api/admin/shopkeepers/:id/status` | Token | Simple verification status update |
| `DELETE` | `/api/admin/shopkeepers/:id` | Token | Delete shopkeeper (blocked if active orders exist) |
| `PATCH` | `/api/admin/shopkeepers/:id/suspend` | Token | Suspend shopkeeper |
| `PATCH` | `/api/admin/shopkeepers/:id/unsuspend` | Token | Unsuspend shopkeeper — resets billing cycle |
| `PUT` | `/api/admin/shopkeepers/:id/scale` | Token | Update shopkeeper scale (small/medium/large) |

### Customers

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/admin/customers` | Token | List all customers/users |
| `DELETE` | `/api/admin/customers/:customerId` | Token | Delete customer |

### Products

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/admin/products` | Token | List all shop-specific products (with shopkeeper info) |
| `GET` | `/api/admin/global-products` | Token | List all global products |
| `POST` | `/api/admin/global-products` | Token | Create global product (with optional image, barcode dedup check) |
| `PUT` | `/api/admin/global-products/:id` | Token | Update global product |
| `DELETE` | `/api/admin/global-products/:id` | Token | Delete global product |
| `GET` | `/api/admin/global-products/scale/:shopScale` | Token | Get global products filtered by shop scale |

### Orders

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/admin/orders` | Token | List all orders (filterable: all/pending/completed/cancelled) with items |
| `PATCH` | `/api/admin/orders/:id/status` | Token | Update order status (with Socket.IO broadcast) |
| `GET` | `/api/admin/order-items` | Token | List all order items |

### Admins

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/admin/admins` | Token | List all admins |
| `GET` | `/api/admin/` | Token | List all admins (alternative) |

### Dashboard & Stats

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/admin/dashboard` | Token | Dashboard stats (shopkeepers, customers, orders, revenue, top products) |

### Payments & Billing

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/admin/payment-requests` | Token | List pending payment requests from billing_payments |
| `PATCH` | `/api/admin/payment-requests/:id` | Token | Approve/reject payment request (approve resets billing cycle) |
| `GET` | `/api/admin/payments/all` | Token | List all payments (pending, approved, rejected) |
| `GET` | `/api/admin/pending-payments` | Token | List pending payments |
| `PATCH` | `/api/admin/payments/:id/status` | Token | Approve/reject payment (approve calls processPaymentApproval) |
| `GET` | `/api/admin/earnings` | Token | Earnings summary from billing_payments + subscription stats |
| `GET` | `/api/admin/earnings/summary` | Token | Earnings summary (alternative endpoint) |
| `GET` | `/api/admin/shopkeeper-earnings` | Token | Per-shopkeeper detailed earnings with payment status, gross revenue, platform fee %, fee amount, and net payout |
| `GET` | `/api/admin/payment-stats` | Token | Payment & subscription statistics |

### Payment Info

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/admin/payment-info` | Token | Get payment info (UPI, bank details) |
| `GET` | `/api/admin/payment-info/admin` | Token | Get admin-specific payment info |
| `PUT` | `/api/admin/payment-info` | Token | Update payment info (with QR code upload) |
| `GET` | `/api/admin/payment-info/test` | Token | Debug payment info table structure |

### Notifications

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/admin/notifications/broadcast` | Token | Broadcast push notification to all users (cleans invalid tokens) |
| `GET` | `/api/admin/notifications/stats` | Token | Notification statistics (users/shopkeepers with tokens) |

## Orders Routes — `/api/orders`

(`ordersRoute.js` — 1523 lines)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/orders/delivery-slots` | Token | Get available delivery time slots for next 7 days |
| `GET` | `/api/orders` | Token | List orders for the authenticated user/shopkeeper/admin with status counts |
| `POST` | `/api/orders/place` | Token | Place a new order (validates stock, applies credits, triggers notifications, awards points) |
| `GET` | `/api/orders/:id` | Token | Get order details with items |
| `POST` | `/api/orders/:id/cancel` | Token | Cancel order (refunds credits, restores stock) |
| `POST` | `/api/orders/:id/complete` | Token | Mark order as completed (with delivery verification) |

**Key Logic:**
- `GET /delivery-slots` — Generates 30-min time slots from 8 AM to 8 PM for next 7 days
- `POST /place` — Uses transaction for order placement: validates stock → deducts stock → creates order + items → handles credits → runs background tasks (notifications, wellness points, analytics)
- Order cancellation restores product stock via `restoreStockForCancelledOrder` and refunds credits
- Supports both home delivery and store pickup (Click & Collect with 7-min timer)
- Supports scheduled orders with pickup codes

## Order Prefetch Routes — `/api/prefetch`

(`orderPrefetchRoute.js` — 148 lines)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/prefetch/user` | Token | Prefetch and cache user data for faster orders |
| `GET` | `/api/prefetch/shop/:shopId` | Token | Prefetch and cache shop product data |
| `POST` | `/api/prefetch/order` | Token | Prefetch combined order data (user + shop) |
| `GET` | `/api/prefetch/status` | Token | Check current cache status |

## Inventory Routes — `/api/inventory`

(`inventoryRoute.js` — 286 lines)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/inventory/barcode/:code` | Token | Lookup product by barcode (checks shop products then global) |
| `POST` | `/api/inventory/restock` | Token | Restock inventory (logs to inventory_logs) |
| `GET` | `/api/inventory/history/:productId` | Token | Get inventory change history for a product |
| `POST` | `/api/inventory/price-update` | Token | Update price and log to price_history |
| `GET` | `/api/inventory/low-stock` | Token | Get low stock alerts (stock ≤ baselineQty threshold) |
| `GET` | `/api/inventory/export` | Token | Export inventory to CSV |
| `POST` | `/api/inventory/transfer` | Token | Transfer stock between shops |
| `DELETE` | `/api/inventory/product/:productId` | Token | Delete product from inventory |

## Inventory Management Routes — `/api/inventory-mgmt`

(`inventory.routes.wrapper.js` — 261 lines)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/inventory-mgmt/create-product` | Token | Create inventory product |
| `POST` | `/api/inventory-mgmt/buy` | Token | Simulate purchase (reduces stock) |
| `GET` | `/api/inventory-mgmt/product/:id` | Token | Fetch details of a specific inventory product |
| `GET` | `/api/inventory-mgmt/products` | Token | List all inventory products with auto-restock flag |
| `POST` | `/api/inventory-mgmt/restock/:id` | Token | Manually add stock quantity to an inventory product |
| `GET` | `/api/inventory-mgmt/low-stock` | Token | Retrieve products with stock level below threshold (default 10) |

## Notification Routes — `/api/notifications`

(`notificationRoute.js` — 104 lines)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/notifications/send` | No | Send push notification (supports both Expo and FCM) |
| `POST` | `/api/notifications/send-fcm` | No | Send FCM notification specifically |
| `POST` | `/api/notifications/send-topic` | No | Send to FCM topic |

## Recommendation Routes — `/api/user/recommendations`, `/api/recommendations`

(`recommendationRoute.js` — 36 lines)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/user/recommendations/` | Token | Get product recommendations for user (params: top_n) |

## Referral Routes — `/api/refer`

(`referralRoute.js` — 152 lines)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/refer/code` | Token | Get current user's referral code |
| `POST` | `/api/refer/use` | Token | Use a referral code (grants rewards to both users) |
| `GET` | `/api/refer/history` | Token | Referral usage history |
| `POST` | `/api/refer/withdraw` | Token | Withdraw referral wallet balance |

**Functions:**
- `generatereferralCode(name)` — Generates a referral code: first 3 chars of name + 5 random alphanumeric chars
- `grantReferralReward(referralCode, referredId)` — Uses transaction: validates code → prevents self-referral → checks duplicate → grants ₹4 to referrer, ₹8 to referred

## Shopping List Routes — `/api/shopping-list`

(`shoppingListRoute.js` — 182 lines)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/shopping-list` | Token | Save a new shopping list (written text list, uploaded image, or both) |
| `GET` | `/api/shopping-list` | Token | Retrieve all saved shopping lists for the authenticated user |
| `GET` | `/api/shopping-list/:id/image` | Token | Retrieve / redirect to the uploaded image of a specific shopping list |
| `DELETE` | `/api/shopping-list/:id` | Token | Manually delete a shopping list and its associated Cloudinary image |

**Data Retention Policy:**
- Records and uploaded Cloudinary images are automatically purged after 15 days by a daily background cron job.

## Navigation Routes — `/api/navigation`

(`navigationRoute.js` — 419 lines)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/navigation/nearby` | No | Find nearby shops within radius (default 5km) with estimated delivery time |
| `GET` | `/api/navigation/directions` | No | Get turn-by-turn directions via OSRM (falls back to curved mathematical interpolation if API is offline) |
| `GET` | `/api/navigation/geocode` | No | Reverse geocode coordinates to human-readable address via Nominatim |
| `POST` | `/api/navigation/track` | Token | Stream/broadcast live GPS coordinates to Socket.IO room `tracking_order_${orderId}` |
| `GET` | `/api/navigation/order/:orderId` | Token | Retrieve order routes and ETA for real-time customer/shopkeeper tracking |
| `GET` | `/api/navigation/status` | No | Health check for navigation subsystem showing active features |

## Service Status Routes — `/api/service`

(`serviceStatusRoute.js` — 268 lines)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/service/status` | No | Get current service status (online/offline) |
| `POST` | `/api/service/toggle` | No | Toggle service status (logs to history) |
| `GET` | `/api/service/history` | No | Get service status change history |

---

# Middleware

## Authentication

### `auth.js` — JWE Token Verification
Verifies encrypted JWT tokens from the `Authorization: Bearer <token>` header. Attaches `req.user` with `{ id, role, iat, exp, jti }`. Auto-refreshes tokens close to expiration via response headers (`X-New-Token`). Handles expired, revoked, and malformed tokens.

### `adminAuth.js` — Admin Token Verification
Verifies admin tokens with JWE-first, JWT-fallback approach. Special handling for environment-based admin (ID 1). Validates admin role claim and checks database for other admins. Attaches `req.admin`.

### `tokenRefresh.js` — Token Refresh
Auto-refreshes tokens expiring within 24 hours. Sets `X-New-Token`, `X-Token-Refresh`, `X-Token-Expires-In` headers. Includes error handlers for expired/revoked tokens that return proper 401 responses.

## Subscription

### `checkSubscription.js` — Subscription Enforcement
Checks shopkeeper subscription before allowing access. Controlled via `ENFORCE_SUBSCRIPTIONS` env var. Blocks suspended accounts, warns during grace period, allows active accounts. Fail-open on errors.

### `checkPaymentStatus.js` — Payment Status *(DISABLED — import commented out)*
Intended to check payment status but not currently used.

## Security

### `security.js` — Security Headers & Sanitization
- Sets security headers: X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, CSP, HSTS
- Sanitizes query/URL/body parameters (trims, limits length, removes HTML)
- Request logging with method, path, IP, user-agent
- Request size limiter (10MB max)
- CORS configuration based on environment
- 404 handler and global error handler

## Validation

### `validation.js` — Input Validation & Rate Limiting
- `sanitizeString(str)` — Trims, removes HTML tags, limits to 1000 chars
- `validateEmail(email)` — Validates email format (max 254 chars)
- `validatePassword(password)` — Min 6, max 128 chars
- `validatePhone(phone)` — 10 digits
- `validateNumber(value, fieldName, min, max)` — Numeric range validation
- `validateRequired(obj, fields)` — Checks for missing required fields
- `validateOrderData(orderData)` — Validates products, total, address rules (home delivery requires address)
- `validateProductData(productData)` — Validates name, price, stock
- `validateUserRegistration(userData)` — Validates name, email, password
- `validateShopkeeperRegistration(shopkeeperData)` — Validates name, email, password, phone, shop_name
- `validate(validationFn)` — Middleware wrapper for validation functions (attaches `req.validatedData`)
- `createRateLimiter(windowMs, max)` — In-memory IP-based rate limiter

## Order Error Handler

### `orderErrorHandler.js`
- `handleOrderTokenExpiration` — Checks token expiry for order operations
- `handleCartTokenExpiration` — Checks cart token expiry
- `orderErrorHandler` — Global error handler for order routes

## Inventory Hooks

### `inventory.order.hooks.js`
- `validateStockAvailability` — Validates product stock before order
- `onOrderCreated` — Post-order inventory hooks
- `attachInventoryHooks` — Attaches hooks to request pipeline

---

# Utilities

## `subscription.js` — Subscription Management

| Function | Description |
|----------|-------------|
| `calculateSubscriptionStatus(shopkeeperId)` | Calculates subscription status based on payment dates. 30-day billing cycle + 2-day grace period. Returns status, isActive, dates, days overdue, etc. |
| `updateSubscriptionStatus(shopkeeperId)` | Calculates and writes subscription status to DB |
| `processPaymentApproval(shopkeeperId)` | Resets billing cycle after payment: sets last_payment_date = NOW, next_payment_due = NOW + 30 days, grace_period_end = next_payment_due + 2 days |
| `canAccessApp(shopkeeperId)` | Returns boolean — whether shopkeeper can access the app |

## `jweToken.js` — JWE Token Utilities

| Function | Description |
|----------|-------------|
| `createJWEToken(payload, expiresIn)` | Create encrypted JWT (supports d/h/m formats) |
| `verifyJWEToken(token)` | Verify and decrypt JWE, check expiration and blacklist |
| `refreshTokenIfNeeded(payload)` | Generate new token if expiring within 24 hours |
| `extractTokenFromHeader(authHeader)` | Extract Bearer token from Authorization header |
| `isTokenCloseToExpiration(payload, thresholdHours)` | Check if token is near expiration |
| `blacklistToken(token)` | Add token to in-memory blacklist |

## `wellnessPoints.js` — Wellness Points System

| Function | Description |
|----------|-------------|
| `calculateWellnessPoints(timeRemaining)` | Calculate points based on delivery time: ≥5min=40pts, 2-5min=30pts, 0-2min=10pts, late=5pts |
| `awardWellnessPoints(pool, userId, deliveryTime, timerStartedAt, orderAmount, deliveryType)` | Award points on order completion (£40 minimum, home delivery capped at 40pts) |
| `deductWellnessPoints(pool, userId, pointsToDeduct)` | Deduct points for order payment (30% max of order value) |
| `validatePointsUsage(selectedPoints, availablePoints, totalAmount)` | Validate points usage limits |
| `calculateMaxPointsAllowed(availablePoints, totalAmount)` | Max 30% of order value in points |

## `expoPush.js` — Expo Push Notifications
- `sendExpoPush(tokens, title, body, data)` — Sends push notifications via Expo Push API with automated receipt validation and invalid token cleanup

## `fcmPush.js` — Firebase Cloud Messaging
- `sendFCMPush(tokens, title, body, data)` — Sends via FCM with batch processing
- `sendFCMNotification(tokens, title, body, data)` — Single/batch FCM notification
- `sendFCMToTopic(topic, title, body, data)` — Send to FCM topic
- `isFCMToken(token)` — Detect if token is FCM vs Expo format

## `stockManager.js` — Stock Management
- `restoreStockForCancelledOrder(orderId, cancelledBy, reason)` — Restores product stock when order is cancelled (with dedup logging)
- `createStockRestorationLogTable()` — Initializes the stock_restoration_log table

## `revenue.js` — Revenue & Platform Fee System

| Function | Description |
|----------|-------------|
| `calculateTotalRevenue(orders)` | Filters completed/delivered orders and sums their total_amount |
| `calculatePlatformFee(totalRevenue)` | Determines fee % based on revenue brackets: ₹0-29,999=0%, ₹30k-99,999=2%, ₹1L-1,99,999=2.5%, ₹2L+=3%. Returns `{ feePercentage, feeAmount }` |
| `generateBill(shopkeeperId, orders)` | Generates complete receipt: gross revenue, platform fee %, fee amount, net payout to shopkeeper |

## `inventory.service.bridge.js` — Inventory Service Bridge
- `handleAutoRestock(productId, currentStock)` — Schedules restock 24h after stock hits 0
- `getInventoryProduct(productId)` — Get inventory product with caching
- `createInventoryProduct(data)` — Create product in inventory system
- `updateInventoryStock(productId, quantity)` — Update stock levels

## Other Utilities
- `googleAuth.js` — Google OAuth2 client initialization
- `errorCodes.js` — Standardized error code definitions *(NOT currently imported by any file)*
- `clientTokenHandler.js` — React Native client-side token handling *(bundled with backend but for mobile app)*
- `orderCache.service.js` — In-memory order data caching *(NOT imported by any active code)*
- `orderBatch.service.js` — Batch order processing *(NOT imported by any active code)*

---

# Services

## `orderPrefetch.service.js` — Data Prefetching
Prefetches and caches user data, shop details, and product data for faster order placement. Used by `orderPrefetchRoute.js` and `ordersRoute.js`.

- `prefetchUserData(userId)` — Cache user info + credits
- `prefetchShopProducts(shopId)` — Cache shop products
- `prefetchOrderData(userId, shopkeeperId)` — Cache combined order data
- `getCachedShopkeeper(shopkeeperId)` — Get cached shopkeeper
- `getCachedShopProducts(shopId)` — Get cached products
- `getCachedUser(userId)` — Get cached user
- `startBackgroundRefresh()` — Start periodic cache refresh

## `recommendation.service.js` — Product Recommendations
- `getRecommendationsForUser(userId, options)` — Generate product recommendations based on user order history

---

# Cron Jobs

## `subscription.status.cron.js` — Subscription Auto-Updater
Runs **every hour** to:
1. Move `active` shopkeepers to `grace_period` when `next_payment_due` has passed
2. Move `grace_period`/`overdue` shopkeepers to `suspended` when grace period has ended
3. Logs current subscription status distribution

## `inventory.restock.cron.js` — Auto-Restock
Runs **daily at midnight** to restore stock for out-of-stock products (stock = 0) back to their `baselineQty`. Configurable via `RESTOCK_CRON_SCHEDULE` env var.

## `shoppingList.cleanup.cron.js` — Shopping List Cleanup
Runs **daily at midnight** to purge database records and associated Cloudinary uploaded images for shopping lists older than 15 days, enforcing the data retention policy.

---

# Configuration

| File | Description |
|------|-------------|
| `config/db.js` | MySQL/TiDB Cloud connection pool (SSL support, utf8mb4 charset) |
| `config/environment.js` | Environment validation and config aggregation |
| `config/constants.js` | App-wide constants: timer duration, slot config, wellness tiers, order statuses, delivery fees, rate limits, push notification config |
| `config/cloudinary.js` | Cloudinary SDK initialization for image uploads |
| `config/upload.js` | Multer configuration (memoryStorage, 10MB limit, image filter) |
| `config/firebase.js` | Firebase Admin SDK for FCM (sendNotification, sendToTopic) |
| `config/email.js` | Nodemailer/Resend email transport (used by password reset) |
| `config/email.resend.js` | Resend mail client initialization |
| `config/inventory.db.bridge.js` | Inventory database bridge initialization |

---

# Database Schema

The schema uses a MySQL/TiDB Cloud database with the following main tables:

| Table | Description |
|-------|-------------|
| `users` | Customers with store_credits, google_id, push tokens, referral codes |
| `shopkeepers` | Shopkeepers with subscription status, billing dates, shop scale, verification, geo-coordinates |
| `admins` | Admin accounts |
| `products` | Shop-specific products with stock, baselineQty, barcode, price |
| `global_products` | Central product catalog with shop_scales (JSON) |
| `orders` | Orders with user/shopkeeper references, status, amounts, credits, delivery info, pickup codes |
| `order_items` | Individual items in each order |
| `billing_payments` | Subscription payment records with approval tracking |
| `payment_info` | Admin payment credentials (UPI, bank, QR) |
| `refer_transaction` | Referral reward transactions |
| `inventory_logs` | Inventory change audit trail |
| `price_history` | Product price change history |
| `stock_restoration_log` | Cancelled order stock restoration audit trail |
| `service_status` | Current platform status (online/offline) |
| `service_status_history` | Service status change history |
| `order_timers` | Active session limit timers for pickup/Click & Collect orders |
| `inventory_alerts` | Low stock inventory alerts and system notifications |
| `barcode_scans` | Logs of barcode lookup scans performed by clients |
| `shopping_lists` | Customer persistent shopping lists (written items and Cloudinary image references) |

---

# Socket.IO Events

The server uses Socket.IO for real-time communication with rooms for shops, customers, and admins.

| Event | Direction | Description |
|-------|-----------|-------------|
| `joinShop(shopkeeper_id)` | Client→Server | Shopkeeper joins their shop room |
| `joinCustomer(user_id)` | Client→Server | Customer joins their customer room |
| `joinAdmin(admin_id)` | Client→Server | Admin joins the admin room |
| `updateOrderStatus(data)` | Client→Server | Shopkeeper updates order status (broadcast to customer + admin) |
| `notifyCustomer(data)` | Client→Server | Shopkeeper notifies a customer |
| `broadcastToShopkeepers(message)` | Client→Server | Admin broadcasts to all shopkeepers |
| `broadcastToCustomers(message)` | Client→Server | Admin broadcasts to all customers |
| `notifyShopkeeper(data)` | Client→Server | Admin notifies a specific shopkeeper |
| `leaveRoom(room)` | Client→Server | Leave a room |
| `disconnect` | Client→Server | Handle disconnection (notifies admin) |
| `orderStatusUpdate` | Server→Client | Order status changed |
| `adminBroadcast` | Server→Client | Admin broadcast message |
| `adminNotification` | Server→Client | Admin notification to shopkeeper |
| `shopkeeperOnline/Offline` | Server→Admin | Shopkeeper connection status |
| `customerOnline/Offline` | Server→Admin | Customer connection status |

---

# Unused Files (Dead Code)

Files that exist but are not imported or used anywhere:

| File | Reason |
|------|--------|
| `routes/ordersRoute.fast.js` | Never imported |
| `utils/errorCodes.js` | Never imported |
| `utils/orderBatch.service.js` | Never imported |
| `utils/orderCache.service.js` | Never imported |
| `utils/clientTokenHandler.js` | React Native client-side code bundled with backend |
| `middleware/checkPaymentStatus.js` | Import commented out in shopkeeperRoute.js |
| `migrations/add_idempotency_key.sql` | Never referenced |
| `bun.lock` | Stale lockfile from another package manager |
