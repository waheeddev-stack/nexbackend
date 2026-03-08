/**
 * Diagnose nodemailer installation and module resolution
 * Run with: node scripts/diagnose-nodemailer.js
 */

console.log('🔍 Diagnosing nodemailer installation...\n');

// Check if nodemailer is installed
try {
  console.log('1️⃣ Checking nodemailer package...');
  const nodemailer = await import('nodemailer');
  console.log('   ✅ nodemailer imported successfully');
  console.log('   Type:', typeof nodemailer);
  console.log('   Has default:', !!nodemailer.default);
  console.log('   Has createTransport:', !!nodemailer.createTransport);
  console.log('   Has default.createTransport:', !!nodemailer.default?.createTransport);
  console.log('   Keys:', Object.keys(nodemailer).slice(0, 10));
  
  // Try to create a transporter
  console.log('\n2️⃣ Attempting to create transporter...');
  let transporter;
  
  if (typeof nodemailer.createTransport === 'function') {
    console.log('   Using nodemailer.createTransport');
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: 'test@example.com',
        pass: 'test'
      }
    });
  } else if (typeof nodemailer.default?.createTransport === 'function') {
    console.log('   Using nodemailer.default.createTransport');
    transporter = nodemailer.default.createTransport({
      service: 'gmail',
      auth: {
        user: 'test@example.com',
        pass: 'test'
      }
    });
  } else {
    throw new Error('createTransport not found');
  }
  
  console.log('   ✅ Transporter created successfully');
  console.log('   Transporter type:', typeof transporter);
  console.log('   Has sendMail:', !!transporter.sendMail);
  
  console.log('\n✅ nodemailer is working correctly!');
  
} catch (error) {
  console.error('\n❌ Error:', error.message);
  console.error('   Stack:', error.stack);
  
  // Try to get more info
  try {
    const pkg = await import('../package.json', { assert: { type: 'json' } });
    console.log('\n📦 Package.json nodemailer version:', pkg.default.dependencies.nodemailer);
  } catch (e) {
    console.log('\n📦 Could not read package.json');
  }
  
  // Check node_modules
  try {
    const fs = await import('fs');
    const path = await import('path');
    const nodemailerPath = path.default.join(process.cwd(), 'node_modules', 'nodemailer');
    const exists = fs.default.existsSync(nodemailerPath);
    console.log('📁 node_modules/nodemailer exists:', exists);
    
    if (exists) {
      const pkgPath = path.default.join(nodemailerPath, 'package.json');
      const pkgContent = fs.default.readFileSync(pkgPath, 'utf8');
      const pkg = JSON.parse(pkgContent);
      console.log('   Installed version:', pkg.version);
      console.log('   Type:', pkg.type);
    }
  } catch (e) {
    console.log('📁 Could not check node_modules');
  }
  
  process.exit(1);
}
