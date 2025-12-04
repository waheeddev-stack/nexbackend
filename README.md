# NexKirana Backend API

A comprehensive backend API for the NexKirana grocery delivery platform, built with Node.js, Express, and TiDB Cloud.

## Features

- **User Management**: Registration, authentication, and profile management
- **Shopkeeper Management**: Store registration, verification, and management
- **Admin Panel**: Administrative controls and dashboard
- **Order Management**: Complete order lifecycle management
- **Real-time Communication**: Socket.IO integration for live updates
- **Product Management**: Global and shop-specific product catalogs
- **Payment Integration**: COD and UPI payment methods
- **Location Services**: GPS-based delivery tracking

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: TiDB Cloud (MySQL-compatible)
- **Authentication**: JWT (JSON Web Tokens)
- **Real-time**: Socket.IO
- **File Upload**: Cloudinary
- **Security**: bcrypt, CORS, Security Headers

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd nexkirana-backend
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your actual configuration values
```

4. Start the server:
```bash
npm start
```

The server will start on `http://localhost:5000`

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `ADMIN_EMAIL` | Admin login email | Yes |
| `ADMIN_PASSWORD` | Admin login password | Yes |
| `CLOUDINARY_API_KEY` | Cloudinary API key | Yes |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret | Yes |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name | Yes |
| `DB_HOST` | Database host | Yes |
| `DB_NAME` | Database name | Yes |
| `DB_PASS` | Database password | Yes |
| `DB_PORT` | Database port | Yes |
| `DB_SSL` | Enable SSL connection | Yes |
| `DB_USER` | Database username | Yes |
| `JWT_SECRET` | JWT signing secret | Yes |
| `PORT` | Server port | No (default: 5000) |

## API Endpoints

### Authentication
- `POST /api/admin/login` - Admin login
- `POST /api/user/signin` - User login
- `POST /api/user/signup` - User registration
- `POST /api/shopkeeper/signin` - Shopkeeper login
- `POST /api/shopkeeper/signup` - Shopkeeper registration

### Health Checks
- `GET /` - Basic health check
- `GET /health` - Database health check
- `GET /api` - API information

### Admin Routes
- `GET /api/admin/dashboard` - Admin dashboard data
- `GET /api/admin/shopkeepers` - List all shopkeepers
- `PATCH /api/admin/shopkeepers/:id/verify` - Verify shopkeeper

### User Routes
- `GET /api/user/profile/:id` - Get user profile
- `PATCH /api/user/profile/:id` - Update user profile

### Orders
- `POST /api/orders` - Create new order
- `GET /api/orders/user/:userId` - Get user orders
- `GET /api/orders/shopkeeper/:shopkeeperId` - Get shopkeeper orders

## Database Schema

The application uses 7 main tables:
- `users` - Customer information
- `shopkeepers` - Store owner information
- `admins` - Administrative users
- `products` - Shop-specific products
- `global_products` - Global product catalog
- `orders` - Order information
- `order_items` - Order line items

## Real-time Features

Socket.IO is integrated for real-time communication:
- Order status updates
- Admin notifications
- Shopkeeper-customer messaging
- Live dashboard updates

## Security Features

- Password hashing with bcrypt
- JWT token authentication
- CORS protection
- Security headers
- Input validation
- SSL database connections

## Development

For development mode:
```bash
npm run dev
```

## Production Deployment

1. Set `NODE_ENV=production`
2. Configure production database
3. Set up SSL certificates
4. Configure reverse proxy (nginx)
5. Set up process manager (PM2)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the MIT License.

## Support

For support and questions, please contact the development team.