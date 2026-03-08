#!/usr/bin/env node

/**
 * Check Email Configuration Status
 * Shows which email service is configured and available
 */

import dotenv from 'dotenv';

dotenv.config();

console.log('📧 Email Configuration Status');
console.log('=' .repeat(60));

// Check SendGrid
const hasSendGrid = !!process.env.SENDGRID_API_KEY;
console.log('\n🔷 SendGrid (Production):');
if (hasSendGrid) {
  console.log('   ✅ CONFIGURED');
  console.log(`   📧 From: ${process.env.SENDGRID_FROM_EMAIL || 'Not set'}`);
  console.log(`   👤 Name: ${process.env.SENDGRID_FROM_NAME || 'Not set'}`);
  console.log(`   🔑 API Key: ${process.env.SENDGRID_API_KEY.substring(0, 10)}...`);
} else {
  console.log('   ❌ NOT CONFIGURED');
  console.log('   💡 Set SENDGRID_API_KEY in .env or Render environment');
}

// Check Gmail SMTP
const hasGmail = !!process.env.EMAIL_PASSWORD;
console.log('\n📮 Gmail SMTP (Local Development):');
if (hasGmail) {
  console.log('   ✅ CONFIGURED');
  console.log(`   📧 User: ${process.env.EMAIL_USER || 'Not set'}`);
  console.log(`   🔑 Password: ${process.env.EMAIL_PASSWORD.substring(0, 4)}****`);
} else {
  console.log('   ❌ NOT CONFIGURED');
  console.log('   💡 Set EMAIL_USER and EMAIL_PASSWORD in .env');
}

// Determine which will be used
console.log('\n🎯 Active Email Service:');
if (hasSendGrid) {
  console.log('   ✅ SendGrid (Production mode)');
  console.log('   📍 Uses HTTPS API - Works on Render');
} else if (hasGmail) {
  console.log('   ✅ Gmail SMTP (Local mode)');
  console.log('   📍 Uses SMTP - Works locally only');
} else {
  console.log('   ❌ NO EMAIL SERVICE CONFIGURED');
  console.log('   ⚠️  Password reset will fail!');
}

console.log('\n' + '='.repeat(60));

// Recommendations
if (!hasSendGrid && !hasGmail) {
  console.log('\n❌ ERROR: No email service configured!');
  console.log('\nTo fix:');
  console.log('1. For production: Set up SendGrid (see SENDGRID_SETUP_GUIDE.md)');
  console.log('2. For local: Add EMAIL_USER and EMAIL_PASSWORD to .env');
} else if (!hasSendGrid && hasGmail) {
  console.log('\n⚠️  WARNING: Only Gmail SMTP configured');
  console.log('   Gmail SMTP is blocked on Render (production)');
  console.log('   Set up SendGrid for production: See SENDGRID_SETUP_GUIDE.md');
} else if (hasSendGrid) {
  console.log('\n✅ Ready for production!');
  console.log('   SendGrid is configured and will work on Render');
}

process.exit(0);
