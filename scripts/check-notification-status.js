import pool from '../config/db.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Quick status check for notification system
 * Shows current configuration and readiness
 * 
 * Usage: node nexbackend/scripts/check-notification-status.js
 */

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bright: '\x1b[1m',
};

function status(label, value, isOk) {
  const icon = isOk ? '✅' : '❌';
  const color = isOk ? COLORS.green : COLORS.red;
  console.log(`${icon} ${label}: ${color}${value}${COLORS.reset}`);
}

function info(label, value) {
  console.log(`   ${label}: ${COLORS.cyan}${value}${COLORS.reset}`);
}

async function checkNotificationStatus() {
  console.log(`\n${COLORS.bright}📊 Notification System Status Check${COLORS.reset}\n`);
  
  let allGood = true;
  
  // 1. Check Firebase Service Account
  console.log(`${COLORS.bright}1. Backend Configuration${COLORS.reset}`);
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  
  if (serviceAccount) {
    try {
      const config = JSON.parse(serviceAccount);
      status('Firebase Service Account', 'Configured', true);
      info('Project ID', config.project_id || 'Unknown');
      info('Client Email', config.client_email || 'Unknown');
    } catch (error) {
      status('Firebase Service Account', 'Invalid JSON', false);
      allGood = false;
    }
  } else {
    status('Firebase Service Account', 'Not configured', false);
    console.log(`   ${COLORS.yellow}⚠️  Set FIREBASE_SERVICE_ACCOUNT in .env${COLORS.reset}`);
    allGood = false;
  }
  
  // 2. Check Database Connection
  console.log(`\n${COLORS.bright}2. Database Connection${COLORS.reset}`);
  try {
    await pool.query('SELECT 1');
    status('Database', 'Connected', true);
  } catch (error) {
    status('Database', `Error: ${error.message}`, false);
    allGood = false;
    await pool.end();
    return;
  }
  
  // 3. Check Shopkeepers Table
  console.log(`\n${COLORS.bright}3. Shopkeepers Table${COLORS.reset}`);
  try {
    const [columns] = await pool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'shopkeepers' 
      AND COLUMN_NAME = 'expo_push_token'
    `);
    
    if (columns.length > 0) {
      status('expo_push_token column', 'Exists', true);
    } else {
      status('expo_push_token column', 'Missing', false);
      console.log(`   ${COLORS.yellow}⚠️  Run: ALTER TABLE shopkeepers ADD COLUMN expo_push_token TEXT;${COLORS.reset}`);
      allGood = false;
    }
  } catch (error) {
    status('Table check', `Error: ${error.message}`, false);
    allGood = false;
  }
  
  // 4. Check Shopkeepers with Tokens
  console.log(`\n${COLORS.bright}4. Registered Shopkeepers${COLORS.reset}`);
  try {
    const [shopkeepers] = await pool.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN expo_push_token IS NOT NULL THEN 1 ELSE 0 END) as with_tokens
      FROM shopkeepers
    `);
    
    const total = shopkeepers[0].total;
    const withTokens = shopkeepers[0].with_tokens;
    
    info('Total Shopkeepers', total);
    
    if (withTokens > 0) {
      status('Shopkeepers with Tokens', withTokens, true);
      
      // Get details
      const [details] = await pool.query(`
        SELECT id, name, shop_name, 
               SUBSTRING(expo_push_token, 1, 30) as token_preview,
               created_at
        FROM shopkeepers 
        WHERE expo_push_token IS NOT NULL
        ORDER BY id
      `);
      
      console.log(`\n   ${COLORS.cyan}Registered Shopkeepers:${COLORS.reset}`);
      details.forEach((shop, index) => {
        console.log(`   ${index + 1}. ${shop.name} (${shop.shop_name})`);
        console.log(`      ID: ${shop.id} | Token: ${shop.token_preview}...`);
      });
    } else {
      status('Shopkeepers with Tokens', '0', false);
      console.log(`   ${COLORS.yellow}⚠️  No shopkeepers have registered for notifications${COLORS.reset}`);
      console.log(`   ${COLORS.yellow}   Login to shopkeeper app to register${COLORS.reset}`);
      allGood = false;
    }
  } catch (error) {
    status('Shopkeeper check', `Error: ${error.message}`, false);
    allGood = false;
  }
  
  // 5. Check Recent Orders
  console.log(`\n${COLORS.bright}5. Recent Orders${COLORS.reset}`);
  try {
    const [orders] = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 1 END) as last_24h,
        COUNT(CASE WHEN created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR) THEN 1 END) as last_hour
      FROM orders
    `);
    
    info('Total Orders', orders[0].total);
    info('Last 24 Hours', orders[0].last_24h);
    info('Last Hour', orders[0].last_hour);
    
    if (orders[0].total > 0) {
      const [recent] = await pool.query(`
        SELECT id, shopkeeper_id, total, status, created_at
        FROM orders
        ORDER BY created_at DESC
        LIMIT 5
      `);
      
      console.log(`\n   ${COLORS.cyan}Recent Orders:${COLORS.reset}`);
      recent.forEach((order, index) => {
        const time = new Date(order.created_at).toLocaleString();
        console.log(`   ${index + 1}. Order #${order.id} | Shop: ${order.shopkeeper_id} | ₹${order.total} | ${order.status}`);
        console.log(`      ${time}`);
      });
    }
  } catch (error) {
    info('Order check', `Error: ${error.message}`);
  }
  
  // 6. System Readiness
  console.log(`\n${COLORS.bright}6. System Readiness${COLORS.reset}`);
  
  if (allGood) {
    console.log(`\n${COLORS.green}${COLORS.bright}✅ ALL SYSTEMS GO!${COLORS.reset}`);
    console.log(`${COLORS.green}Notification system is ready for testing.${COLORS.reset}\n`);
    console.log('Next steps:');
    console.log('1. Run: node nexbackend/scripts/test-order-notification-complete.js');
    console.log('2. Or place a real order from customer app');
    console.log('3. Check shopkeeper app for notification\n');
  } else {
    console.log(`\n${COLORS.red}${COLORS.bright}❌ SYSTEM NOT READY${COLORS.reset}`);
    console.log(`${COLORS.red}Fix the issues above before testing.${COLORS.reset}\n`);
    console.log('Common fixes:');
    console.log('1. Set FIREBASE_SERVICE_ACCOUNT in nexbackend/.env');
    console.log('2. Login to shopkeeper app to register token');
    console.log('3. Check database connection and schema\n');
  }
  
  // 7. Quick Actions
  console.log(`${COLORS.bright}Quick Actions:${COLORS.reset}`);
  console.log('• Test notification: node nexbackend/scripts/test-order-notification-complete.js');
  console.log('• Test specific shop: node nexbackend/scripts/test-order-notification-complete.js [shop-id]');
  console.log('• View full guide: cat ORDER_NOTIFICATION_TEST_GUIDE.md');
  console.log('• Quick start: cat TEST_NOTIFICATIONS_QUICK_START.md\n');
  
  await pool.end();
}

// Run the check
checkNotificationStatus().catch(error => {
  console.error(`\n${COLORS.red}Fatal error: ${error.message}${COLORS.reset}`);
  console.error(error.stack);
  process.exit(1);
});
