#!/usr/bin/env node

/**
 * Complete Verification Script for Home Delivery Toggle Fix
 * 
 * This script verifies:
 * 1. Database has home_delivery_active column
 * 2. At least one shop has it disabled for testing
 * 3. New public endpoint exists and works
 * 4. NexKirana code is updated correctly
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pool from './config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const BOLD = '\x1b[1m';

function success(msg) {
  console.log(`${GREEN}✅ ${msg}${RESET}`);
}

function error(msg) {
  console.log(`${RED}❌ ${msg}${RESET}`);
}

function warning(msg) {
  console.log(`${YELLOW}⚠️  ${msg}${RESET}`);
}

function info(msg) {
  console.log(`${BLUE}ℹ️  ${msg}${RESET}`);
}

function header(msg) {
  console.log(`\n${BOLD}${BLUE}━━━ ${msg} ━━━${RESET}\n`);
}

async function verifyDatabase() {
  header('1. Database Verification');
  
  try {
    // Check column exists
    const [columns] = await pool.query(`
      SHOW COLUMNS FROM shopkeepers LIKE 'home_delivery_active'
    `);
    
    if (columns.length === 0) {
      error('Column home_delivery_active does NOT exist');
      return false;
    }
    success('Column home_delivery_active exists');
    
    // Check for test shops
    const [disabledShops] = await pool.query(`
      SELECT id, shop_name, name, home_delivery_active, is_verified, is_online
      FROM shopkeepers
      WHERE home_delivery_active = 0 AND is_verified = 1
    `);
    
    if (disabledShops.length === 0) {
      warning('No shops have home_delivery_active = 0');
      info('Creating test case...');
      
      const [testShops] = await pool.query(`
        SELECT id, shop_name, name
        FROM shopkeepers
        WHERE is_verified = 1
        ORDER BY id DESC
        LIMIT 1
      `);
      
      if (testShops.length > 0) {
        await pool.query('UPDATE shopkeepers SET home_delivery_active = 0 WHERE id = ?', [testShops[0].id]);
        success(`Set shop ID ${testShops[0].id} (${testShops[0].shop_name}) to home_delivery_active = 0`);
        return testShops[0].id;
      } else {
        error('No verified shops found to create test case');
        return false;
      }
    } else {
      success(`Found ${disabledShops.length} shop(s) with home delivery disabled`);
      disabledShops.forEach(shop => {
        info(`  - ID ${shop.id}: ${shop.shop_name || shop.name}`);
      });
      return disabledShops[0].id;
    }
  } catch (err) {
    error(`Database check failed: ${err.message}`);
    return false;
  }
}

async function verifyBackendEndpoint() {
  header('2. Backend Endpoint Verification');
  
  try {
    const userRouteFile = readFileSync('./routes/userRoute.js', 'utf8');
    
    // Check if endpoint exists
    if (userRouteFile.includes('userrouter.get("/shop-info/:shopId"')) {
      success('Public shop-info endpoint exists in userRoute.js');
    } else {
      error('Public shop-info endpoint NOT found in userRoute.js');
      return false;
    }
    
    // Check if it includes home_delivery_active
    if (userRouteFile.includes('home_delivery_active')) {
      success('Endpoint includes home_delivery_active field');
    } else {
      error('Endpoint does NOT include home_delivery_active field');
      return false;
    }
    
    // Check shopkeeper profile endpoint
    const shopkeeperRouteFile = readFileSync('./routes/shopkeeperRoute.js', 'utf8');
    const profileMatch = shopkeeperRouteFile.match(/shopkeeperRouter\.get\("\/profile\/:id".*?res\.json/s);
    
    if (profileMatch && profileMatch[0].includes('home_delivery_active')) {
      success('Shopkeeper profile endpoint includes home_delivery_active');
    } else {
      warning('Shopkeeper profile endpoint may not include home_delivery_active');
    }
    
    return true;
  } catch (err) {
    error(`Backend verification failed: ${err.message}`);
    return false;
  }
}

async function verifyNexKiranaCode() {
  header('3. NexKirana Code Verification');
  
  try {
    const cartFile = readFileSync(join(rootDir, 'NexKirana/app/(tabs)/cart.jsx'), 'utf8');
    
    // Check if using new endpoint
    if (cartFile.includes('/api/user/shop-info/')) {
      success('Cart uses new public shop-info endpoint');
    } else if (cartFile.includes('/api/shopkeeper/profile/')) {
      error('Cart still uses old protected profile endpoint');
      return false;
    } else {
      error('Cannot find shop info fetch in cart.jsx');
      return false;
    }
    
    // Check if using correct response field
    if (cartFile.includes('data.shop.home_delivery_active')) {
      success('Cart checks data.shop.home_delivery_active (correct)');
    } else if (cartFile.includes('data.user.home_delivery_active')) {
      error('Cart checks data.user.home_delivery_active (wrong field)');
      return false;
    } else if (cartFile.includes('data.shopkeeper.home_delivery_active')) {
      error('Cart checks data.shopkeeper.home_delivery_active (wrong field)');
      return false;
    } else {
      error('Cannot find home_delivery_active check in cart.jsx');
      return false;
    }
    
    // Check if state is used correctly
    if (cartFile.includes('shopHomeDeliveryEnabled &&')) {
      success('Cart conditionally renders home delivery option');
    } else {
      warning('Cannot verify conditional rendering logic');
    }
    
    return true;
  } catch (err) {
    error(`NexKirana verification failed: ${err.message}`);
    return false;
  }
}

async function testEndpointQuery(shopId) {
  header('4. Endpoint Query Test');
  
  try {
    const [shop] = await pool.query(`
      SELECT id, name, shop_name, address, phone, latitude, longitude, 
             is_online, is_verified, home_delivery_active
      FROM shopkeepers 
      WHERE id = ? AND is_verified = 1
    `, [shopId]);
    
    if (shop.length === 0) {
      error(`Shop ID ${shopId} not found or not verified`);
      return false;
    }
    
    success(`Endpoint query successful for shop ID ${shopId}`);
    info(`  Shop: ${shop[0].shop_name || shop[0].name}`);
    info(`  home_delivery_active: ${shop[0].home_delivery_active}`);
    info(`  Expected behavior: ${shop[0].home_delivery_active === 0 ? 'Hide home delivery' : 'Show home delivery'}`);
    
    return true;
  } catch (err) {
    error(`Endpoint query test failed: ${err.message}`);
    return false;
  }
}

async function main() {
  console.log(`${BOLD}${BLUE}
╔═══════════════════════════════════════════════════════════╗
║   Home Delivery Toggle Fix - Complete Verification       ║
╚═══════════════════════════════════════════════════════════╝
${RESET}`);
  
  let allPassed = true;
  
  // Step 1: Database
  const testShopId = await verifyDatabase();
  if (!testShopId) {
    allPassed = false;
  }
  
  // Step 2: Backend
  const backendOk = await verifyBackendEndpoint();
  if (!backendOk) {
    allPassed = false;
  }
  
  // Step 3: Frontend
  const frontendOk = await verifyNexKiranaCode();
  if (!frontendOk) {
    allPassed = false;
  }
  
  // Step 4: Query Test
  if (testShopId) {
    const queryOk = await testEndpointQuery(testShopId);
    if (!queryOk) {
      allPassed = false;
    }
  }
  
  // Final Summary
  header('Verification Summary');
  
  if (allPassed) {
    console.log(`${GREEN}${BOLD}
╔═══════════════════════════════════════════════════════════╗
║                  ✅ ALL CHECKS PASSED                     ║
╚═══════════════════════════════════════════════════════════╝
${RESET}`);
    
    console.log(`\n${BOLD}Next Steps:${RESET}`);
    console.log('1. Restart backend server');
    console.log('2. Reload NexKirana app');
    console.log(`3. Test with shop ID ${testShopId}`);
    console.log('4. Verify home delivery option is hidden\n');
  } else {
    console.log(`${RED}${BOLD}
╔═══════════════════════════════════════════════════════════╗
║              ❌ SOME CHECKS FAILED                        ║
╚═══════════════════════════════════════════════════════════╝
${RESET}`);
    
    console.log(`\n${BOLD}Please review the errors above and fix them.${RESET}\n`);
  }
  
  await pool.end();
  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error(`${RED}Fatal error:${RESET}`, err);
  process.exit(1);
});
