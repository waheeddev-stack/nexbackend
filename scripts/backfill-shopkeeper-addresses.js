/**
 * Backfill script to fetch addresses for shopkeepers who have coordinates but no address
 * Uses OpenStreetMap Nominatim API for reverse geocoding (free, no API key required)
 * 
 * Usage: node scripts/backfill-shopkeeper-addresses.js
 */

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse';

// Rate limit: 1 request per second (Nominatim policy)
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function reverseGeocode(latitude, longitude) {
  try {
    const url = `${NOMINATIM_URL}?lat=${latitude}&lon=${longitude}&format=json&addressdetails=1`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'NexKirana-Backfill/1.0 (shopkeeper address backfill script)'
      }
    });

    if (!response.ok) {
      throw new Error(`Nominatim API error: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error);
    }

    // Build address from components
    const addr = data.address || {};
    const parts = [
      addr.house_number,
      addr.road || addr.street,
      addr.neighbourhood || addr.suburb,
      addr.city || addr.town || addr.village,
      addr.state,
      addr.postcode
    ].filter(Boolean);

    return parts.join(', ') || data.display_name || null;
  } catch (error) {
    console.error(`Reverse geocode failed for (${latitude}, ${longitude}):`, error.message);
    return null;
  }
}

async function main() {
  let connection;
  
  try {
    // Connect to database (matching other scripts' connection pattern)
    const sslConfig = process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined;
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT) || 4000,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
      ssl: sslConfig
    });

    console.log('Connected to database');

    // Find shopkeepers with coordinates but no address
    const [shopkeepers] = await connection.query(`
      SELECT id, name, shop_name, latitude, longitude, address
      FROM shopkeepers
      WHERE latitude IS NOT NULL 
        AND longitude IS NOT NULL
        AND latitude != 0 
        AND longitude != 0
        AND (address IS NULL OR address = '')
    `);

    console.log(`Found ${shopkeepers.length} shopkeepers with coordinates but no address`);

    if (shopkeepers.length === 0) {
      console.log('No shopkeepers need address backfill');
      return;
    }

    let updated = 0;
    let failed = 0;

    for (const shop of shopkeepers) {
      console.log(`\nProcessing: ${shop.shop_name || shop.name} (ID: ${shop.id})`);
      console.log(`  Coordinates: ${shop.latitude}, ${shop.longitude}`);

      const address = await reverseGeocode(shop.latitude, shop.longitude);

      if (address) {
        // Update the shopkeeper's address
        await connection.query(
          'UPDATE shopkeepers SET address = ? WHERE id = ?',
          [address, shop.id]
        );
        console.log(`  ✓ Address set: ${address}`);
        updated++;
      } else {
        console.log(`  ✗ Could not fetch address`);
        failed++;
      }

      // Rate limit: wait 1 second between requests
      await delay(1100);
    }

    console.log(`\n========== Summary ==========`);
    console.log(`Total processed: ${shopkeepers.length}`);
    console.log(`Successfully updated: ${updated}`);
    console.log(`Failed: ${failed}`);

  } catch (error) {
    console.error('Script error:', error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('\nDatabase connection closed');
    }
  }
}

main();
