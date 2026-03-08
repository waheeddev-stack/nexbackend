#!/usr/bin/env node

/**
 * Check if User Exists in Database
 * Verifies if email is registered
 */

import pool from '../config/db.js';

const emailToCheck = process.argv[2] || 'waheedwork12@gmail.com';

console.log('🔍 Checking User in Database');
console.log('=' .repeat(60));
console.log(`📧 Email: ${emailToCheck}\n`);

try {
  const [users] = await pool.query(
    'SELECT id, name, email, created_at FROM users WHERE email = ?',
    [emailToCheck]
  );

  if (users.length > 0) {
    const user = users[0];
    console.log('✅ USER FOUND!');
    console.log('\n📋 User Details:');
    console.log(`   ID: ${user.id}`);
    console.log(`   Name: ${user.name || 'Not set'}`);
    console.log(`   Email: ${user.email}`);
    console.log(`   Created: ${user.created_at || 'Unknown'}`);
    console.log('\n✅ Password reset email WILL be sent to this user');
  } else {
    console.log('❌ USER NOT FOUND!');
    console.log('\n⚠️  This email is not registered in the database');
    console.log('Password reset will return success but NO email will be sent');
    console.log('(This is by design to prevent email enumeration)');
    console.log('\n💡 To fix:');
    console.log('1. Register this email in the app first');
    console.log('2. Or use an email that is already registered');
    console.log('3. Or manually add to database for testing');
  }

  console.log('\n' + '='.repeat(60));
  
  // Show all users for reference
  const [allUsers] = await pool.query(
    'SELECT id, email, name FROM users LIMIT 10'
  );
  
  if (allUsers.length > 0) {
    console.log('\n📋 Registered Users (first 10):');
    allUsers.forEach((u, i) => {
      console.log(`   ${i + 1}. ${u.email} (${u.name || 'No name'})`);
    });
  } else {
    console.log('\n⚠️  No users found in database!');
  }

  await pool.end();
  process.exit(users.length > 0 ? 0 : 1);
} catch (error) {
  console.error('\n❌ Database Error:', error.message);
  console.error('\nCheck:');
  console.error('1. Database connection in .env');
  console.error('2. Database is running');
  console.error('3. Users table exists');
  await pool.end();
  process.exit(1);
}
