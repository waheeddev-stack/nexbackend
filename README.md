# NexKirana Backend API

A comprehensive backend API for the NexKirana grocery delivery platform, built with Node.js, Express, and XAMPP MySQL.

## 🚀 Features

- **User Management**: Registration, authentication, and profile management
- **Shopkeeper Management**: Store registration, verification, and management
- **Admin Panel**: Administrative controls and dashboard
- **Order Management**: Complete order lifecycle management
- **Real-time Communication**: Socket.IO integration for live updates
- **Product Management**: Global and shop-specific product catalogs (250K+ products)
- **Payment Integration**: COD and UPI payment methods
- **Location Services**: GPS-based delivery tracking

## 🛠️ Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: XAMPP MySQL (localhost:3306)
- **Authentication**: JWT (JSON Web Tokens)
- **Real-time**: Socket.IO
- **File Upload**: Cloudinary
- **Security**: bcrypt, CORS, Security Headers

## 📋 Prerequisites

1. **XAMPP** installed and running
2. **MySQL** service started in XAMPP
3. **phpMyAdmin** accessible at `http://localhost/phpmyadmin`
4. **Database** `nexkiranadb` imported with 250K+ products

## 🔧 Installation

1. **Clone the repository:**
```bash
git clone <repository-url>
cd nexkirana-backend
```

2. **Install dependencies:**
```bash
npm install
```

3. **Set up environment variables:**
```bash
cp .env.example .env
```

4. **Start XAMPP MySQL:**
   - Open XAMPP Control Panel
   - Start Apache and MySQL services
   - Verify MySQL is running on port 3306

5. **Test database connection:**
```bash
npm run test-xampp
```

6. **Start the server:**
```bash
npm start
# or for development
npm run dev
```

The server will start on `http://localhost:5000`

## 🗄️ Database Setup

### XAMPP MySQL Configuration:
- **Host**: localhost
- **Port**: 3306
- **Username**: root
- **Password**: (empty)
- **Database**: nexkiranadb

### Import Database:
1. Open phpMyAdmin: `http://localhost/phpmyadmin`
2. Create database `nexkiranadb`
3. Import your SQL file with 250K+ products
4. Verify tables exist: users, shopkeepers, products, orders, etc.

## 🌐 Environment Variables

| Variable | Value | Description |
|----------|-------|-------------|
| `ADMIN_EMAIL` | nexkirana@gmail.com | Admin login email |
| `ADMIN_PASSWORD` | nexkirana123 | Admin login password |
| `CLOUDINARY_API_KEY` | 115424958181214 | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | 913y9mHUE2JA4hrNIaYR5jMOSQM | Cloudinary API secret |
| `CLOUDINARY_CLOUD_NAME` | dbhjho1kv | Cloudinary cloud name |
| `DB_HOST` | localhost | XAMPP MySQL host |
| `DB_NAME` | nexkiranadb | Database name |
| `DB_PASS` | (empty) | MySQL password |
| `DB_PORT` | 3306 | MySQL port |
| `DB_USER` | root | MySQL username |
| `JWT_SECRET` | nexkiranadbhsmsu | JWT signing secret |
| `PORT` | 5000 | Server port |

## 🔗 API Endpoints

### Authentication
- `POST /api/admin/login` - Admin login
- `POST /api/user/signin` - User login
- `POST /api/user/signup` - User registration
- `POST /api/shopkeeper/signin` - Shopkeeper login
- `POST /api/shopkeeper/signup` - Shopkeeper registration

### Products
- `GET /api/products` - Get all products
- `GET /api/shopkeepers/:id/products` - Get shopkeeper products

### Orders
- `POST /api/orders` - Create new order
- `GET /api/users/:id/orders` - Get user orders

### Health Checks
- `GET /` - Basic health check
- `GET /health` - Database health check
- `GET /api` - API information

## 🧪 Testing

### Test Database Connection:
```bash
npm run test-db
```

### Test XAMPP Connection:
```bash
npm run test-xampp
```

### Manual API Testing:
```bash
# Test health endpoint
curl http://localhost:5000/health

# Test admin login
curl -X POST http://localhost:5000/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"nexkirana@gmail.com","password":"nexkirana123"}'
```

## 🚀 Production Deployment (Render.com)

1. **Environment Variables on Render:**
```
DB_HOST=your_production_mysql_host
DB_PORT=3306
DB_USER=your_production_mysql_user
DB_PASS=your_production_mysql_password
DB_NAME=nexkiranadb
```

2. **Build Command:**
```bash
npm install
```

3. **Start Command:**
```bash
npm start
```

## 📊 Database Schema

The application uses 7 main tables:
- `users` - Customer information
- `shopkeepers` - Store owner information  
- `admins` - Administrative users
- `products` - Shop-specific products (250K+ records)
- `global_products` - Global product catalog
- `orders` - Order information
- `order_items` - Order line items

## 🔒 Security Features

- Password hashing with bcrypt
- JWT token authentication
- CORS protection
- Security headers
- Input validation
- No SSL required for localhost

## 🐛 Troubleshooting

### Common Issues:

1. **MySQL Connection Failed:**
   - Ensure XAMPP MySQL is running
   - Check port 3306 is not blocked
   - Verify database `nexkiranadb` exists

2. **Database Not Found:**
   - Import your SQL file in phpMyAdmin
   - Check database name matches `nexkiranadb`

3. **Port 5000 Already in Use:**
   - Change PORT in .env file
   - Or kill existing process: `taskkill /f /im node.exe`

## 📝 License

This project is licensed under the MIT License.

## 🆘 Support

For support and questions, please contact the development team.