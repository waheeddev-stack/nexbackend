import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🔄 Updating Backend Code for 3-Status System...\n');

// Files to update
const files = [
  {
    path: path.join(__dirname, 'routes', 'ordersRoute.js'),
    updates: [
      {
        find: /o\.status IN \('Pending', 'Processing'\)/g,
        replace: "o.status = 'Pending'",
        description: 'Remove Processing from Pending filter'
      },
      {
        find: /o\.status IN \('Completed', 'Delivered'\)/g,
        replace: "o.status = 'Completed'",
        description: 'Remove Delivered from Completed filter'
      },
      {
        find: /\['pending', 'processing'\]\.includes/g,
        replace: "['pending'].includes",
        description: 'Remove processing from array checks'
      },
      {
        find: /\['completed', 'delivered'\]\.includes/g,
        replace: "['completed'].includes",
        description: 'Remove delivered from array checks'
      }
    ]
  },
  {
    path: path.join(__dirname, 'routes', 'shopkeeperRoute.js'),
    updates: [
      {
        find: /const validStatuses = \["Pending", "Processing", "Completed", "Cancelled"\];/g,
        replace: 'const validStatuses = ["Pending", "Completed", "Cancelled"];',
        description: 'Update valid statuses array'
      },
      {
        find: /o\.status === "Delivered" \|\| o\.status === "Completed"/g,
        replace: 'o.status === "Completed"',
        description: 'Remove Delivered status checks'
      }
    ]
  }
];

let totalUpdates = 0;

files.forEach(file => {
  console.log(`📝 Processing: ${path.basename(file.path)}`);
  console.log('═'.repeat(60));
  
  try {
    let content = fs.readFileSync(file.path, 'utf8');
    let fileUpdated = false;
    
    file.updates.forEach(update => {
      const matches = content.match(update.find);
      if (matches) {
        content = content.replace(update.find, update.replace);
        console.log(`✅ ${update.description} (${matches.length} occurrence${matches.length > 1 ? 's' : ''})`);
        totalUpdates += matches.length;
        fileUpdated = true;
      } else {
        console.log(`⏭️  ${update.description} (no matches found)`);
      }
    });
    
    if (fileUpdated) {
      fs.writeFileSync(file.path, content, 'utf8');
      console.log(`💾 File updated successfully\n`);
    } else {
      console.log(`ℹ️  No changes needed\n`);
    }
    
  } catch (error) {
    console.error(`❌ Error processing ${path.basename(file.path)}:`, error.message);
  }
});

console.log('═'.repeat(60));
console.log(`✅ Code Update Complete!`);
console.log(`   Total replacements: ${totalUpdates}`);
console.log('\n📝 Summary of Changes:');
console.log('   • Removed "Processing" status from all queries');
console.log('   • Removed "Delivered" status from all queries');
console.log('   • Updated validStatuses array to 3 statuses');
console.log('   • Backend now uses: Pending, Completed, Cancelled');
console.log('\n⚠️  Next Steps:');
console.log('   1. Run: node nexbackend/migrate-order-status.js');
console.log('   2. Restart backend server');
console.log('   3. Test order creation and status updates');
