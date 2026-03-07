import pool from '../config/db.js';
import dotenv from 'dotenv';

dotenv.config();

async function fixNullUserIds() {
  try {
    console.log('🔧 Fixing NULL user IDs...\n');

    // Get users with NULL ids
    const [nullUsers] = await pool.query('SELECT * FROM users WHERE id IS NULL ORDER BY created_at');
    
    if (nullUsers.length === 0) {
      console.log('✅ No users with NULL ids found!');
      process.exit(0);
    }

    console.log(`⚠️ Found ${nullUsers.length} users with NULL ids\n`);

    // Get the current max ID
    const [maxIdResult] = await pool.query('SELECT MAX(id) as maxId FROM users WHERE id IS NOT NULL');
    let nextId = (maxIdResult[0].maxId || 0) + 1;

    console.log(`📊 Starting ID assignment from: ${nextId}\n`);

    // Assign IDs to NULL users
    for (const user of nullUsers) {
      const email = user.email || 'N/A';
      const name = user.name || 'N/A';
      
      console.log(`Assigning ID ${nextId} to: ${name} (${email})`);
      
      // Update the user with new ID
      await pool.query(
        'UPDATE users SET id = ? WHERE email = ? AND id IS NULL LIMIT 1',
        [nextId, user.email]
      );
      
      nextId++;
    }

    console.log(`\n✅ Assigned IDs to ${nullUsers.length} users`);

    // Verify
    const [remainingNull] = await pool.query('SELECT COUNT(*) as count FROM users WHERE id IS NULL');
    console.log(`\n📊 Remaining NULL IDs: ${remainingNull[0].count}`);

    if (remainingNull[0].count === 0) {
      console.log('🎉 All users now have valid IDs!');
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

fixNullUserIds();
