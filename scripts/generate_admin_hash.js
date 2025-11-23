import bcrypt from 'bcryptjs';

// Generate hashed password for the new admin credentials
const generateAdminHash = async () => {
  const email = 'nexkirana@kirana.com';
  const password = 'qwI41L5U47RwaI47DasA';
  
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    
    console.log('='.repeat(50));
    console.log('NexKirana Admin Credentials');
    console.log('='.repeat(50));
    console.log(`Email: ${email}`);
    console.log(`Password: ${password}`);
    console.log(`Hashed Password: ${hashedPassword}`);
    console.log('='.repeat(50));
    console.log('\nSQL Insert Statement:');
    console.log(`INSERT INTO admins (email, password) VALUES ('${email}', '${hashedPassword}');`);
    console.log('='.repeat(50));
    
  } catch (error) {
    console.error('Error generating hash:', error);
  }
};

generateAdminHash();