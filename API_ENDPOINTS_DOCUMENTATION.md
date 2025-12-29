# Complete API Endpoints Documentation

**Generated:** December 29, 2024  
**Project:** Nexkirana Platform  
**Base URL:** `https://your-domain.com/api`

---

## Table of Contents
1. [Admin Routes](#admin-routes)
2. [User/Customer Routes](#usercustomer-routes)
3. [Shopkeeper Routes](#shopkeeper-routes)
4. [Authentication](#authentication)
5. [Payment & Billing](#payment--billing)
6. [Order Management](#order-management)
7. [Product Management](#product-management)

---

## Admin Routes
**Base Path:** `/api/admin`

### Authentication
- `POST /api/admin/register` - Register initial admin (one-time only)
- `POST /api/admin/login` - Admin login

### Shopkeeper Management
- `GET /api/admin/shopkeepers` - Get all shopkeepers (with optional status filter)
  - Query params: `?status=all|pending|approved|rejected`
- `GET /api/admin/shopkeepers/stats` - Get shopkeeper statistics
- `PATCH /api/admin/shopkeepers/:id/verify` - Approve/reject shopkeeper
  - Body: `{ action: "approve" | "reject" }`
- `POST /api/admin/shopkeepers/:id/status` - Update shopkeeper status (alternative)
- `DELETE /api/admin/shopkeepers/:id` - Delete shopkeeper (soft delete)
- `PUT /api/admin/shopkeepers/:id/scale` - Update shopkeeper scale
- `GET /api/admin/test-verify/:id` - Test verification endpoint (debug)

### Customer Management
- `GET /api/admin/customers` - Get all customers/users

### Dashboard
- `GET /api/admin/dashboard` - Get admin dashboard statistics
- `GET /api/admin/` - List all admins

### Global Products (Admin Catalog)
- `GET /api/admin/global-products` - Get all global products
- `POST /api/admin/global-products` - Create global product
- `PUT /api/admin/global-products/:id` - Update global product
- `DELETE /api/admin/global-products/:id` - Delete global product
- `GET /api/admin/global-products/scale/:shopScale` - Get products by shop scale

### Shop-Specific Products
- `GET /api/admin/products` - Get all shop-specific products

### Payment Management
- `GET /api/admin/payment-requests` - Get all payment requests
- `PATCH /api/admin/payment-requests/:id` - Approve/reject payment
- `GET /api/admin/payment-info` - Get admin payment credentials
- `PUT /api/admin/payment-info` - Update payment credentials

### Earnings & Billing
- `GET /api/admin/earnings` - Get total earnings from all shopkeepers
- `GET /api/admin/earnings/shopkeeper/:id` - Get earnings from specific shopkeeper
- `GET /api/admin/earnings/history` - Get payment history

---

## User/Customer Routes
**Base Path:** `/api/user`

### Authentication
- `POST /api/user/signup` - Register new customer
- `POST /api/user/signin` - Customer login

### Profile Management
- `GET /api/user/profile/:id` - Get user profile
- `PUT /api/user/profile/:id` - Update user profile (with image upload)

### Shop Discovery
- `GET /api/user/nearby-shops` - Find nearby shopkeepers
  - Query params: `?latitude=X&longitude=Y&radiusKm=1.25`

### Product Browsing
- `GET /api/user/products` - Get all products

### Order Management
- `GET /api/user/orders` - Get user's orders (requires auth)
- `POST /api/user/orders` - Place new order (requires auth)
- `GET /api/user/orders/:orderId` - Get detailed order info
- `GET /api/user/orders/:orderId/status` - Get order status
- `POST /api/user/orders/:orderId/cancel` - Cancel order
- `DELETE /api/user/orders/clear-user-orders` - Clear all user orders

### Timer & Pickup
- `GET /api/user/orders/:orderId/timer` - Get timer status for order
- `GET /api/user/shops/:shopId/location` - Get shop location

### Push Notifications
- `POST /api/user/push-token` - Save Expo push token

---

## Shopkeeper Routes
**Base Path:** `/api/shopkeeper`

### Authentication
- `POST /api/shopkeeper/signup` - Register new shopkeeper
- `POST /api/shopkeeper/signin` - Shopkeeper login

### Profile Management
- `GET /api/shopkeeper/profile/:id` - Get shopkeeper profile
- `PUT /api/shopkeeper/profile/:id` - Update profile (with image & UPI QR upload)
- `PUT /api/shopkeeper/update-scale/:id` - Update shop scale

### Dashboard & Statistics
- `GET /api/shopkeeper/stats` - Get shopkeeper statistics

### Order Management
- `GET /api/shopkeeper/orders` - Get shopkeeper's orders
  - Query params: `?status=Pending|Processing|Completed|Cancelled`
- `PATCH /api/shopkeeper/orders/:orderId/status` - Update order status

### Product Management (Shop-Specific)
- `GET /api/shopkeeper/products` - Get shopkeeper's products
- `POST /api/shopkeeper/products` - Add new product
- `PUT /api/shopkeeper/products/:id` - Update product
- `DELETE /api/shopkeeper/products/:id` - Delete product
- `PATCH /api/shopkeeper/products/:id/stock` - Update product stock

### Global Products (Catalog)
- `GET /api/shopkeeper/global-products` - Get available global products
- `POST /api/shopkeeper/products/from-global` - Add product from global catalog

### Timer & Pickup Management
- `POST /api/shopkeeper/orders/:orderId/start-timer` - Start pickup timer
- `POST /api/shopkeeper/orders/:orderId/verify-pickup` - Verify pickup code
- `POST /api/shopkeeper/orders/:orderId/stop-timer` - Stop timer (legacy)
- `GET /api/shopkeeper/orders/:orderId/timer` - Get timer status
- `POST /api/shopkeeper/cleanup-expired-timers` - Cleanup expired timers

### Location Verification
- `POST /api/shopkeeper/verify-location` - Verify shopkeeper location
- `GET /api/shopkeeper/location-history` - Get location verification history

### Earnings & Billing
- `GET /api/shopkeeper/earnings` - Get billing summary
- `GET /api/shopkeeper/earnings/history` - Get payment history
- `GET /api/shopkeeper/earnings/status` - Get billing/subscription status

### Subscription Management
- `GET /api/shopkeeper/subscription-status` - Get subscription status
- `GET /api/shopkeeper/subscription` - Get detailed subscription info
- `POST /api/shopkeeper/subscription/check-access` - Check app access
- `POST /api/shopkeeper/submit-payment` - Submit payment proof
- `GET /api/shopkeeper/payment-history` - Get payment history
- `GET /api/shopkeeper/payment-info` - Get admin payment credentials

### Push Notifications
- `POST /api/shopkeeper/push-token` - Save Expo/FCM push token

---

## Authentication

### Token-Based Authentication
All protected routes require JWT token in header:
```
Authorization: Bearer <token>
```

### User Types
1. **Admin** - Full system access
2. **Customer/User** - Browse shops, place orders
3. **Shopkeeper** - Manage products, fulfill orders

### Verification Status (Shopkeepers)
- `pending` - Awaiting admin approval
- `approved` - Can access app (is_verified = 1)
- `rejected` - Denied access (is_verified = 0)

---

## Payment & Billing

### Trial System
- **Trial Period:** 90 days from admin approval
- **Billing Cycle:** 15 days after trial
- **Grace Period:** 2 days after payment due

### Payment Flow
1. Shopkeeper submits payment proof
2. Admin reviews and approves/rejects
3. On approval: subscription renewed for 15 days
4. On rejection: shopkeeper must resubmit

### Subscription Statuses
- `trial` - In 90-day trial period
- `active` - Paid and active
- `overdue` - Payment due (in grace period)
- `suspended` - Grace period expired, access blocked

### Enforcement
Controlled by environment variable:
```
ENFORCE_SUBSCRIPTIONS=false  # Platform is FREE
ENFORCE_SUBSCRIPTIONS=true   # Billing enforced
```

---

## Order Management

### Order Statuses
- `Pending` - Order placed, awaiting shopkeeper
- `Processing` - Shopkeeper preparing order
- `Ready` - Order ready for pickup
- `Completed` - Order picked up successfully
- `Cancelled` - Order cancelled

### Order Flow
1. Customer places order → Status: `Pending`
2. Shopkeeper accepts → Status: `Processing`
3. Shopkeeper marks ready → Status: `Ready` + Timer starts
4. Customer arrives, provides code → Status: `Completed`

### Timer System (FIT INDIA Challenge)
- **Duration:** 7 minutes (420 seconds)
- **Starts:** When order is placed
- **Purpose:** Encourage customers to walk/cycle to shop
- **Rewards:** Wellness points based on arrival time

---

## Product Management

### Product Types
1. **Shop-Specific Products** - Created by individual shopkeepers
2. **Global Products** - Admin-managed catalog, shopkeepers can add to their inventory

### Shop Scales
- `small` - Small shops
- `medium` - Medium shops
- `large` - Large shops
- `all` - Available to all scales

### Product Fields
- `name` - Product name
- `description` - Product description
- `category` - Product category
- `price` - Price (2 decimal places)
- `stock` - Available quantity
- `image` - Product image URL
- `brand` - Brand name (global products)
- `barcode` - Barcode (global products)
- `shop_scales` - Available scales (global products)

---

## Middleware & Security

### Authentication Middleware
- `verifyToken` - Validates JWT token
- `verifyAdminToken` - Validates admin JWT token
- `verifyShopkeeperStatus` - Checks shopkeeper verification status

### Subscription Middleware
- `checkSubscriptionStatus` - Enforces subscription (if enabled)

### Rate Limiting
- Auth endpoints: 5 attempts per 15 minutes
- Prevents brute force attacks

### Validation
- Input validation on all POST/PUT endpoints
- Phone number: 10 digits
- Email: Valid format
- Password: Minimum 6 characters

---

## Real-Time Features

### Socket.IO Events

#### Rooms
- `shop_{shopkeeper_id}` - Shopkeeper-specific room
- `customer_{user_id}` - Customer-specific room

#### Events Emitted
- `newOrder` - New order placed
- `orderStatusUpdate` - Order status changed
- `orderStatusChanged` - Order status changed (legacy)
- `timerUpdate` - Timer status update

---

## Push Notifications

### Supported Platforms
- **Expo Push Notifications** - For Expo apps
- **Firebase Cloud Messaging (FCM)** - For native apps

### Notification Types
1. **New Order** - Sent to shopkeeper
2. **Order Status Update** - Sent to customer
3. **Order Cancelled** - Sent to shopkeeper/customer
4. **Payment Approved** - Sent to shopkeeper
5. **Timer Expiring** - Sent to customer

---

## Error Handling

### Standard Error Response
```json
{
  "success": false,
  "message": "Error description"
}
```

### Common HTTP Status Codes
- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `500` - Server Error

---

## File Uploads

### Supported Endpoints
- Profile images (users, shopkeepers)
- Product images
- UPI QR codes
- Payment proof images

### Upload Configuration
- **Storage:** Cloudinary
- **Format:** Multipart form-data
- **Field Names:** `img`, `image`, `upi_qr`, `proof_image`

---

## Database Tables

### Core Tables
- `users` - Customers
- `shopkeepers` - Shop owners
- `admins` - Admin users
- `products` - Shop-specific products
- `global_products` - Admin catalog
- `orders` - Customer orders
- `order_items` - Order line items
- `order_timers` - Pickup timers
- `billing_payments` - Payment records
- `payment_info` - Admin payment credentials

---

## Environment Variables

### Required
- `JWT_SECRET` - JWT signing secret
- `DATABASE_URL` - Database connection string
- `CLOUDINARY_URL` - Cloudinary credentials
- `ADMIN_EMAIL` - Initial admin email
- `ADMIN_PASSWORD` - Initial admin password

### Optional
- `ENFORCE_SUBSCRIPTIONS` - Enable/disable billing (default: false)
- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment (development/production)

---

## API Versioning

**Current Version:** v1 (implicit)  
**Future:** May add `/api/v2/` prefix for breaking changes

---

## Rate Limits

### Authentication Endpoints
- **Limit:** 5 attempts per 15 minutes
- **Applies to:** `/signup`, `/signin`

### General Endpoints
- No rate limiting currently
- Consider adding for production

---

## CORS Configuration

### Allowed Origins
- Development: `http://localhost:*`
- Production: Configure based on deployment

### Allowed Methods
- GET, POST, PUT, PATCH, DELETE

---

## Testing Endpoints

### Debug Endpoints
- `GET /api/admin/test-verify/:id` - Test shopkeeper verification

### Health Check
- Consider adding: `GET /api/health`

---

## Deprecated Endpoints

### Legacy
- `POST /api/shopkeeper/orders/:orderId/stop-timer` - Use `verify-pickup` instead

---

## Future Enhancements

### Planned Features
1. Webhook support for payment gateways
2. Bulk product import/export
3. Analytics endpoints
4. Report generation
5. Email notifications
6. SMS notifications
7. Multi-language support

---

## Support & Contact

For API support or questions:
- Check documentation first
- Review error messages
- Contact development team

---

**Last Updated:** December 29, 2024  
**Documentation Version:** 1.0  
**API Status:** ✅ Production Ready

