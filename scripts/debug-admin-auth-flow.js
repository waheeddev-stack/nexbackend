import axios from 'axios';
import db from '../config/db.js';
import { createJWEToken } from '../utils/jweToken.js';

const API_BASE_URL = 'https://nexbackend.onrender.com/api';
const LOCAL_API_BASE_URL = 'http://localhost:5000/api';

async function debugAuthFlow() {
  try {
    console.log('🔐 Debugging Admin Authentication Flow\n');
    console.log('='.repeat(60));

    // Step 1: Check environment variables
    console.log('\n1️⃣  Environment Configuration:');
    console.log('   ADMIN_EMAIL:', process.env.ADMIN_EMAIL || 'NOT SET');
    console.log('   ADMIN_PASSWORD:', process.env.ADMIN_PASSWORD ? '***SET***' : 'NOT SET');
    console.log('   JWT_SECRET:', process.env.JWT_SECRET ? '***SET***' : 'NOT SET');

    // Step 2: Check database connection
    console.log('\n2️⃣  Database Connection:');
    try {
      const [testResult] = await db.execute('SELECT 1 as test');
      console.log('   ✅ Database connected');
      console.log('   Test query result:', testResult);
    } catch (error) {
      console.error('   ❌ Database connection failed:', error.message);
    }

    // Step 3: Check admins table
    console.log('\n3️⃣  Admins Table:');
    try {
      const [admins] = await db.execute('SELECT id, email FROM admins LIMIT 5');
      console.log(`   ✅ Found ${admins.length} admin(s)`);
      admins.forEach(admin => {
        console.log(`      - ID: ${admin.id}, Email: ${admin.email}`);
      });
    } catch (error) {
      console.error('   ❌ Error querying admins:', error.message);
    }

    // Step 4: Create a test token locally
    console.log('\n4️⃣  Creating Test Token:');
    try {
      const testToken = await createJWEToken(
        {
          id: 1,
          email: process.env.ADMIN_EMAIL || 'nexkirana@kirana.com',
          role: 'admin'
        },
        '1h'
      );
      console.log('   ✅ Test token created');
      console.log('   Token (first 50 chars):', testToken.substring(0, 50) + '...');
      console.log('   Token length:', testToken.length);

      // Step 5: Test endpoints with local server (if running)
      console.log('\n5️⃣  Testing Local Endpoints (if server running):');
      try {
        const statusResponse = await axios.get(`${LOCAL_API_BASE_URL}/service/status`, {
          timeout: 2000
        });
        console.log('   ✅ GET /service/status works');
        console.log('   Response:', JSON.stringify(statusResponse.data, null, 2));

        // Try with token
        try {
          const historyResponse = await axios.get(`${LOCAL_API_BASE_URL}/service/history`, {
            headers: { Authorization: `Bearer ${testToken}` },
            timeout: 2000
          });
          console.log('   ✅ GET /service/history works with token');
          console.log('   Response:', JSON.stringify(historyResponse.data, null, 2));
        } catch (error) {
          console.error('   ❌ GET /service/history failed:', error.response?.data?.message || error.message);
        }
      } catch (error) {
        console.log('   ⚠️  Local server not running or not accessible');
      }

      // Step 6: Test production endpoints
      console.log('\n6️⃣  Testing Production Endpoints:');
      try {
        const statusResponse = await axios.get(`${API_BASE_URL}/service/status`, {
          timeout: 5000
        });
        console.log('   ✅ GET /service/status works');
        console.log('   Response:', JSON.stringify(statusResponse.data, null, 2));
      } catch (error) {
        console.error('   ❌ GET /service/status failed:', error.message);
      }

      // Try history with token
      try {
        const historyResponse = await axios.get(`${API_BASE_URL}/service/history?limit=5`, {
          headers: { Authorization: `Bearer ${testToken}` },
          timeout: 5000
        });
        console.log('   ✅ GET /service/history works with token');
        console.log('   Response:', JSON.stringify(historyResponse.data, null, 2));
      } catch (error) {
        console.error('   ❌ GET /service/history failed:', error.response?.data?.message || error.message);
        if (error.response?.status === 403) {
          console.log('   💡 Hint: 403 Forbidden - Token verification failed');
          console.log('      This could be due to JWT_SECRET mismatch between servers');
        }
      }

      // Try toggle with token
      try {
        const toggleResponse = await axios.post(
          `${API_BASE_URL}/service/toggle`,
          {
            status: 'offline',
            message: 'Debug test'
          },
          {
            headers: { Authorization: `Bearer ${testToken}` },
            timeout: 5000
          }
        );
        console.log('   ✅ POST /service/toggle works with token');
        console.log('   Response:', JSON.stringify(toggleResponse.data, null, 2));
      } catch (error) {
        console.error('   ❌ POST /service/toggle failed:', error.response?.data?.message || error.message);
        if (error.response?.status === 403) {
          console.log('   💡 Hint: 403 Forbidden - Token verification failed');
        }
      }

    } catch (error) {
      console.error('   ❌ Token creation failed:', error.message);
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ Debug flow completed\n');
    process.exit(0);
  } catch (error) {
    console.error('❌ Debug flow failed:', error.message);
    process.exit(1);
  }
}

debugAuthFlow();
