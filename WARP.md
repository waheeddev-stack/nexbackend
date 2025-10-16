# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

This is a **Node.js Express API** for a local grocery/kirana store e-commerce platform supporting three user roles:
- **Users/Customers**: Browse nearby shops, place orders
- **Shopkeepers**: Manage products, process orders
- **Admins**: Platform management and analytics

## Development Commands

### Essential Commands
```bash
# Start development server with hot reload
npm run dev

# Start production server
npm start

# Install dependencies
npm install
```

### Database Operations
No specific migration commands are provided. SQL schema files are in `/schema/` directory for manual database setup.

## Architecture Overview

### Core Structure
- **Entry Point**: `server.js` - Express app with Socket.IO integration
- **Routes**: `/routes/` - API endpoints organized by user roles
  - `userRoute.js` - Customer operations (signup, nearby shops, orders)
  - `shopkeeperRoute.js` - Shop management, product CRUD, order processing
  - `adminRoute.js` - Platform analytics, user management
  - `ordersRoute.js` - Order management and real-time updates
- **Middleware**: `/middleware/auth.js` - JWT token verification
- **Config**: Database, Cloudinary, file upload configurations
- **Schema**: SQL table definitions

### Key Technologies
- **Backend**: Node.js, Express.js
- **Database**: MySQL2 with connection pooling
- **Real-time**: Socket.IO for live order updates
- **Authentication**: JWT tokens with bcryptjs password hashing
- **File Upload**: Multer + Cloudinary integration
- **Location Services**: Haversine formula for nearby shop calculation
- **Geocoding**: Google Maps API integration

### Database Architecture
**Core Tables:**
- `users` - Customer accounts with store credits
- `shopkeepers` - Shop owners with geolocation data
- `products` - Inventory linked to specific shops via `shop_id`
- `orders` - Order records with status tracking
- `order_items` - Order line items linking products and quantities
- `admins` - Platform administrators

**Key Relationships:**
- Orders connect users → shopkeepers → products
- Products belong to specific shopkeepers (`shop_id` foreign key)
- Real-time order updates via Socket.IO room system

### Environment Configuration

**Database (supports both local MySQL and TiDB Cloud):**
```
DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME
DB_SSL=true/false
DB_SSL_CA=/path/to/ca.pem (for TiDB Cloud)
```

**Authentication & Services:**
```
JWT_SECRET
CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
GOOGLE_MAPS_API_KEY
ADMIN_EMAIL, ADMIN_PASSWORD
```

## Development Practices

### API Patterns
- Consistent JSON response format: `{ success: boolean, message?: string, data?: any }`
- JWT authentication middleware protection for sensitive routes
- Role-based access control (users can only access their own profiles)
- Error handling with appropriate HTTP status codes

### Real-time Features
- Socket.IO integration for live order updates
- Room-based messaging system for shopkeeper/customer communication
- Order status changes broadcast to relevant parties

### File Upload Flow
1. Multer processes multipart form data into memory
2. Streamifier converts buffer to stream
3. Cloudinary handles image storage and URL generation
4. Database stores secure URLs, not files directly

### Location-Based Features
- Haversine formula implementation for nearby shop discovery
- Google Maps API for reverse geocoding (lat/lng → address)
- Flexible radius-based search (default: 2km)

### Data Validation Patterns
- Required field validation before database operations
- Phone number format validation (10 digits)
- Password strength requirements (minimum 6 characters)
- Duplicate email/user prevention

## Important Implementation Details

### Database Connection
- Uses connection pooling for performance
- SSL support for cloud databases (TiDB Cloud)
- Automatic connection testing on startup
- Environment-specific configuration (development vs production)

### Authentication Flow
- JWT tokens with 7-day expiration
- Password hashing with bcryptjs (salt rounds: 10)
- Bearer token authorization header format
- User ID embedded in JWT payload for route protection

### Order Management System
- Order status: Pending → Processing → Delivered/Cancelled
- Store credits calculation and tracking
- Order items linked to specific products with frozen prices
- Real-time status updates via WebSocket

When working on this codebase, prioritize maintaining the existing authentication patterns, database transaction integrity, and real-time communication architecture.