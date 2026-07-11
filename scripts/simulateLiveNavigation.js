/**
 * ============================================================================
 * Live Navigation Animation Simulator
 * ============================================================================
 * 
 * This script simulates a delivery partner moving along the route in real-time.
 * It's used for testing the LiveNavigationScreen without needing a real driver.
 * 
 * Usage:
 *   node scripts/simulateLiveNavigation.js --orderId test-order-123 --speed 2000
 * 
 * Parameters:
 *   --orderId:  The order ID to track (default: "test-order-123")
 *   --speed:    Delay between location updates in milliseconds (default: 2000)
 *   --backend:  Backend URL (default: "http://localhost:5000")
 * 
 * How it works:
 *   1. Connects to the backend via Socket.io
 *   2. Fetches the order route from /api/navigation/order/:orderId
 *   3. Extracts the polyline (array of coordinates)
 *   4. Loops through each coordinate and emits it as a "shop:location:updated" event
 *   5. The frontend receives these events and updates the driver marker in real-time
 * 
 * ============================================================================
 */

import io from 'socket.io-client';
import fetch from 'node-fetch';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

// Parse command-line arguments
const argv = yargs(hideBin(process.argv))
  .option('orderId', {
    alias: 'o',
    describe: 'Order ID to track',
    default: 'test-order-123',
    type: 'string',
  })
  .option('speed', {
    alias: 's',
    describe: 'Delay between location updates in milliseconds',
    default: 2000,
    type: 'number',
  })
  .option('backend', {
    alias: 'b',
    describe: 'Backend URL',
    default: 'http://localhost:5000',
    type: 'string',
  })
  .option('repeat', {
    alias: 'r',
    describe: 'Repeat the route N times (0 = infinite)',
    default: 1,
    type: 'number',
  })
  .help().argv;

const BACKEND_URL = argv.backend;
const ORDER_ID = argv.orderId;
const UPDATE_INTERVAL = argv.speed;
const REPEAT_ROUTE = argv.repeat;

console.log('🚀 Live Navigation Simulator');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`📍 Order ID: ${ORDER_ID}`);
console.log(`🌐 Backend: ${BACKEND_URL}`);
console.log(`⏱️  Update Interval: ${UPDATE_INTERVAL}ms`);
console.log(`🔄 Repeat Route: ${REPEAT_ROUTE === 0 ? '∞ (infinite)' : REPEAT_ROUTE}x`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

let polylineCoordinates = [];
let currentIndex = 0;
let repeatCount = 0;
let socket = null;

/**
 * Fetch the route from the backend API
 */
async function fetchRoute() {
  try {
    console.log(`📡 Fetching route for order ${ORDER_ID}...`);

    const response = await fetch(`${BACKEND_URL}/api/navigation/order/${ORDER_ID}`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    if (data.success && data.data.polyline) {
      polylineCoordinates = data.data.polyline;
      console.log(`✅ Route fetched successfully!`);
      console.log(`   📍 Waypoints: ${polylineCoordinates.length}`);
      console.log(`   📏 Distance: ${data.data.distance_km} km`);
      console.log(`   ⏳ ETA: ${data.data.eta_minutes} minutes`);
      console.log(`   First point: ${polylineCoordinates[0].latitude}, ${polylineCoordinates[0].longitude}`);
      console.log(`   Last point: ${polylineCoordinates[polylineCoordinates.length - 1].latitude}, ${polylineCoordinates[polylineCoordinates.length - 1].longitude}\n`);
      return true;
    } else {
      throw new Error(data.message || 'Invalid response format');
    }
  } catch (error) {
    console.error(`❌ Failed to fetch route: ${error.message}`);
    return false;
  }
}

/**
 * Connect to Socket.io and start simulating location updates
 */
function connectSocket() {
  return new Promise((resolve) => {
    console.log('🔌 Connecting to Socket.io...');

    socket = io(BACKEND_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
    });

    socket.on('connect', () => {
      console.log('✅ Socket.io connected\n');
      resolve();
    });

    socket.on('connect_error', (error) => {
      console.error(`❌ Socket connection error: ${error.message}`);
    });

    socket.on('disconnect', () => {
      console.log('🔌 Socket disconnected');
    });
  });
}

/**
 * Simulate the delivery partner moving along the route
 */
async function simulateMovement() {
  const totalCoordinates = polylineCoordinates.length;

  while (true) {
    if (currentIndex >= totalCoordinates) {
      repeatCount++;

      if (REPEAT_ROUTE > 0 && repeatCount >= REPEAT_ROUTE) {
        console.log('\n✅ Simulation complete!');
        console.log(`📦 Delivery completed after ${repeatCount} route(s)`);
        process.exit(0);
      }

      console.log(`\n🔄 Repeating route (iteration ${repeatCount + 1})...\n`);
      currentIndex = 0;
    }

    const coord = polylineCoordinates[currentIndex];
    const progress = Math.round((currentIndex / totalCoordinates) * 100);

    // Calculate heading based on previous and current point
    let heading = 0;
    if (currentIndex > 0) {
      const prevCoord = polylineCoordinates[currentIndex - 1];
      const dLat = coord.latitude - prevCoord.latitude;
      const dLng = coord.longitude - prevCoord.longitude;
      heading = Math.atan2(dLng, dLat) * (180 / Math.PI);
    }

    // Emit location update
    socket.emit('shop:location:updated', {
      order_id: ORDER_ID,
      latitude: coord.latitude,
      longitude: coord.longitude,
      heading: heading,
      speed: Math.random() * 40, // Simulate varying speed (0-40 km/h)
      timestamp: new Date().toISOString(),
    });

    console.log(
      `📍 [${progress}%] Point ${currentIndex + 1}/${totalCoordinates}: ` +
        `${coord.latitude.toFixed(6)}, ${coord.longitude.toFixed(6)} | Heading: ${heading.toFixed(0)}°`
    );

    currentIndex++;

    // Wait before next update
    await new Promise((resolve) => setTimeout(resolve, UPDATE_INTERVAL));
  }
}

/**
 * Main execution
 */
async function main() {
  try {
    // Step 1: Fetch the route
    const routeFetched = await fetchRoute();
    if (!routeFetched) {
      console.log('❌ Cannot start simulation without a valid route');
      process.exit(1);
    }

    // Step 2: Connect to Socket.io
    await connectSocket();

    // Step 3: Start simulating movement
    console.log('🚗 Starting live location updates...');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    await simulateMovement();
  } catch (error) {
    console.error('❌ Simulation failed:', error.message);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n🛑 Simulation stopped by user');
  if (socket) {
    socket.disconnect();
  }
  process.exit(0);
});

// Start the simulation
main();
