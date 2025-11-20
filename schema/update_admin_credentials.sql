-- Update admin credentials to new NexKirana admin account
-- This script updates the admin email and password in the database

-- First, let's check if there are existing admin records
-- DELETE FROM admins WHERE email = 'admin@admin.com';

-- Update existing admin record or insert new one
-- Note: The password will be hashed by the application when the admin registers
-- This is just for reference - the actual password hashing happens in the backend

-- If you need to manually insert the admin with hashed password, use this:
-- Replace 'HASHED_PASSWORD_HERE' with the actual bcrypt hash of 'qwI41L5U47RwaI47DasA'

-- DELETE FROM admins; -- Remove all existing admins (optional)

-- The admin will be created automatically when the /admin/register endpoint is called
-- with the new environment variables:
-- ADMIN_EMAIL=nexkirana@kirana.com  
-- ADMIN_PASSWORD=qwI41L5U47RwaI47DasA

-- Or you can manually insert if needed:
-- INSERT INTO admins (email, password) VALUES ('nexkirana@kirana.com', '$2b$10$HASHED_PASSWORD_HERE');

-- To get the hashed password, you can use the admin registration endpoint
-- or run this in Node.js:
-- const bcrypt = require('bcryptjs');
-- const hashedPassword = await bcrypt.hash('qwI41L5U47RwaI47DasA', 10);
-- console.log(hashedPassword);