import pool from '../config/db.js';
import dotenv from 'dotenv';

dotenv.config();

async function checkUser49() {
  try {
    console.log('🔍 Checking for user ID 49...\n');

    // Check if user 49 exists
    const [user49] = await pool.query('SELECT * FROM users WHERE id = 49');
    
    if (user49.length > 0) {
      console.log('✅ User 49 EXISTS:');
      console.log(JSON.stringify(user49[0], null, 2));
    } else {
      console.log('❌ User 49 NOT FOUND\n');
      
      // Show all users
      console.log('📋 All users in database:');
      const [allUsers] = await pool.query('SELECT id, name, email, phone, created_at FROM users ORDER BY id');
      
      if (allUsers.length > 0) {
        console.log('\nID  | Name                | Email                           | Phone      | Created At');
        console.log('----|---------------------|--------------------------------|------------|-------------------');
        allUsers.forEach(user => {
          const id = String(user.id || 'null').padEnd(3);
          const name = (user.name || 'N/A').substring(0, 19).padEnd(19);
          const email = (user.email || 'N/A').substring(0, 30).padEnd(30);
          const phone = (user.phone || 'N/A').substring(0, 10).padEnd(10);
          const created = user.created_at ? new Date(user.created_at).toISOString().substring(0, 19) : 'N/A';
          console.log(`${id} | ${name} | ${email} | ${phone} | ${created}`);
        });
        
        console.log(`\n📊 Total users: ${allUsers.length}`);
        
        // Check for users with NULL id
        const [nullIdUsers] = await pool.query('SELECT * FROM users WHERE id IS NULL');
        if (nullIdUsers.length > 0) {
          console.log(`\n⚠️ Found ${nullIdUsers.length} users with NULL id!`);
          console.log('These users need to be assigned valid IDs.');
        }
      } else {
        console.log('No users found in database');
      }
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkUser49();
