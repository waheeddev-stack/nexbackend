#!/usr/bin/env node

/**
 * Verify Email Configuration
 * Checks if email credentials are properly configured
 */

import dotenv from 'dotenv';

dotenv.config();

console.log('🔍 Verifying Email Configuration');
console.log('=' .repeat(60));

const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASSWORD = process.env.EMAIL_PASSWORD;

console.log('\n📧 Email User:');
if (EMAIL_USER) {
  console.log(`   ✅ Set: ${EMAIL_USER}`);
} else {
  console.log('   ❌ NOT SET');
}

console.log('\n🔑 Email Password (App Password):');
if (EMAIL_PASSWORD) {
  console.log(`   ✅ Set: ${EMAIL_PASSWORD.substring(0, 4)}${'*'.repeat(EMAIL_PASSWORD.length - 4)}`);
  console.log(`   📏 Length: ${EMAIL_PASSWORD.length} characters`);
  
  // Check for common issues
  if (EMAIL_PASSWORD.includes(' ')) {
    console.log('   ⚠️  WARNING: Password contains spaces (should be removed)');
  }
  
  if (EMAIL_PASSWORD.length !== 16) {
    console.log('   ⚠️  WARNING: Gmail App Passwords are typically 16 characters');
  }
  
  // Check if it looks like a regular password (has special chars)
  if (/[!@#$%^&*(),.?":{}|<>]/.test(EMAIL_PASSWORD)) {
    console.log('   ⚠️  WARNING: This looks like a regular password, not an App Password');
    console.log('   💡 Gmail App Passwords are 16 lowercase letters without special characters');
  }
} else {
  console.log('   ❌ NOT SET');
}

console.log('\n' + '='.repeat(60));

if (!EMAIL_USER || !EMAIL_PASSWORD) {
  console.log('\n❌ Email configuration is incomplete!');
  console.log('\nTo fix:');
  console.log('1. Go to https://myaccount.google.com/security');
  console.log('2. Enable 2-Step Verification if not already enabled');
  console.log('3. Go to "App passwords"');
  console.log('4. Generate a new app password for "Mail"');
  console.log('5. Copy the 16-character password (remove spaces)');
  console.log('6. Add to .env file:');
  console.log('   EMAIL_USER=resetnexkirana@gmail.com');
  console.log('   EMAIL_PASSWORD=your16charpassword');
  process.exit(1);
} else {
  console.log('\n✅ Email configuration looks good!');
  console.log('\nNext step: Test email sending with:');
  console.log('   node scripts/test-email-send.js');
  process.exit(0);
}
