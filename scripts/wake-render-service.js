#!/usr/bin/env node

/**
 * Wake Up Render Service
 * Pings the production server to wake it from sleep
 */

const BACKEND_URL = 'https://nexbackend.onrender.com';

async function wakeService() {
  console.log('🌅 Waking up Render service...');
  console.log(`📍 URL: ${BACKEND_URL}`);
  console.log('⏳ This may take 30-60 seconds on first request...\n');

  const startTime = Date.now();

  try {
    const response = await fetch(BACKEND_URL, {
      method: 'GET',
      headers: {
        'User-Agent': 'NexKirana-Wake-Service/1.0'
      }
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    if (response.ok) {
      console.log(`✅ Service is awake! (${duration}s)`);
      console.log(`📊 Status: ${response.status}`);
      
      // Try to get response body
      try {
        const text = await response.text();
        console.log(`📦 Response: ${text.substring(0, 200)}${text.length > 200 ? '...' : ''}`);
      } catch (e) {
        // Ignore if can't read body
      }
      
      return true;
    } else {
      console.log(`⚠️  Service responded but with error status: ${response.status}`);
      return false;
    }
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error(`❌ Failed to wake service (${duration}s)`);
    console.error(`Error: ${error.message}`);
    
    if (error.message.includes('ECONNREFUSED')) {
      console.log('\n💡 Service may be down. Check Render dashboard.');
    } else if (error.message.includes('ETIMEDOUT')) {
      console.log('\n💡 Request timed out. Service may be starting up. Try again in 30 seconds.');
    } else if (error.message.includes('fetch failed')) {
      console.log('\n💡 Network error. Check your internet connection.');
    }
    
    return false;
  }
}

async function main() {
  console.log('=' .repeat(60));
  const success = await wakeService();
  console.log('=' .repeat(60));
  
  if (success) {
    console.log('\n✅ Service is ready to receive requests!');
    console.log('You can now test the password reset feature.');
  } else {
    console.log('\n❌ Service is not responding.');
    console.log('Please check:');
    console.log('  1. Render dashboard for service status');
    console.log('  2. Render logs for errors');
    console.log('  3. Environment variables are set correctly');
  }
  
  process.exit(success ? 0 : 1);
}

main();
