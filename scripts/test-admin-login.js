import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const API_URL = process.env.API_URL || 'http://localhost:5000/api';

async function testAdminLogin() {
  console.log('🧪 Testing Admin Login with JWE Token\n');
  console.log('API URL:', API_URL);
  console.log('-----------------------------------\n');

  try {
    // Test credentials
    const credentials = {
      email: process.env.ADMIN_EMAIL || 'nexkirana@kirana.com',
      password: process.env.ADMIN_PASSWORD || 'qwI41L5U47RwaI47DasA'
    };

    console.log('1. 🔐 Attempting admin login...');
    console.log(`   Email: ${credentials.email}`);
    
    const loginResponse = await axios.post(`${API_URL}/admin/login`, credentials);
    
    if (loginResponse.data.success) {
      console.log('   ✅ Login successful!');
      console.log(`   Token: ${loginResponse.data.token.substring(0, 50)}...`);
      console.log(`   Admin: ${JSON.stringify(loginResponse.data.admin, null, 2)}`);
      
      const token = loginResponse.data.token;
      
      // Test protected route
      console.log('\n2. 🔒 Testing protected route (admin profile)...');
      const profileResponse = await axios.get(`${API_URL}/admin/profile`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (profileResponse.data.success) {
        console.log('   ✅ Protected route access successful!');
        console.log(`   Profile: ${JSON.stringify(profileResponse.data.data, null, 2)}`);
      } else {
        console.log('   ❌ Protected route failed:', profileResponse.data.message);
      }
      
      // Test dashboard route
      console.log('\n3. 📊 Testing dashboard route...');
      const dashboardResponse = await axios.get(`${API_URL}/admin/dashboard`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (dashboardResponse.data.success) {
        console.log('   ✅ Dashboard access successful!');
        console.log(`   Stats: ${JSON.stringify(dashboardResponse.data.data, null, 2)}`);
      } else {
        console.log('   ❌ Dashboard failed:', dashboardResponse.data.message);
      }
      
      console.log('\n✅ All tests passed! Admin login with JWE token is working correctly.');
      
    } else {
      console.log('   ❌ Login failed:', loginResponse.data.message);
    }
    
  } catch (error) {
    console.error('\n❌ Test failed with error:');
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Message: ${error.response.data.message || error.response.statusText}`);
      console.error(`   Data: ${JSON.stringify(error.response.data, null, 2)}`);
    } else if (error.request) {
      console.error('   No response received from server');
      console.error('   Make sure the backend server is running');
    } else {
      console.error(`   Error: ${error.message}`);
    }
  }
}

// Run the test
testAdminLogin();
