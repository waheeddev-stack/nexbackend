# Environment Setup Guide

## Database Configuration

### For TiDB Cloud (Production)
Set these environment variables in your deployment platform (Render, Heroku, etc.):

```bash
# Database Configuration
DB_HOST=your-tidb-host.tidbcloud.com
DB_PORT=4000
DB_USER=your-username
DB_PASS=your-password
DB_NAME=your-database-name
NODE_ENV=production

# SSL Configuration (TiDB Cloud requires SSL)
DB_SSL=true
DB_SSL_REJECT_UNAUTHORIZED=false
```

### For Local Development
```bash
# Database Configuration
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASS=your-local-password
DB_NAME=kirana
NODE_ENV=development

# SSL Configuration (not needed for local)
DB_SSL=false
```

### For Render Deployment
Make sure to set these environment variables in your Render dashboard:

1. Go to your Render service dashboard
2. Navigate to "Environment" tab
3. Add the following variables:

```
DB_HOST=your-tidb-host.tidbcloud.com
DB_PORT=4000
DB_USER=your-tidb-username
DB_PASS=your-tidb-password
DB_NAME=your-database-name
NODE_ENV=production
DB_SSL=true
DB_SSL_REJECT_UNAUTHORIZED=false
JWT_SECRET=your-jwt-secret-key
CLOUDINARY_CLOUD_NAME=your-cloudinary-name
CLOUDINARY_API_KEY=your-cloudinary-key
CLOUDINARY_API_SECRET=your-cloudinary-secret
ADMIN_EMAIL=admin@admin.com
ADMIN_PASSWORD=admin123
```

## TiDB Cloud Setup

1. Create a TiDB Cloud account at https://tidbcloud.com
2. Create a new cluster
3. Get your connection details from the cluster dashboard
4. Use the connection string format: `mysql://username:password@host:port/database`
5. Extract the individual components for the environment variables

## Common Issues

### SSL Connection Errors
- Make sure `DB_SSL=true` is set for TiDB Cloud
- Set `DB_SSL_REJECT_UNAUTHORIZED=false` for cloud deployments
- Ensure `NODE_ENV=production` is set

### Connection Timeout
- Check if your TiDB Cloud cluster is running
- Verify the host, port, username, and password
- Make sure your IP is whitelisted in TiDB Cloud

### Authentication Errors
- Double-check username and password
- Ensure the user has proper permissions
- Verify the database name exists
