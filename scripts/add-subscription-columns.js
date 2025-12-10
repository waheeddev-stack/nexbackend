import pool from '../config/db.js';

(async () => {
    try {
        console.log("Adding columns to shopkeepers table...");

        // TiDB/MySQL query to add columns if they don't exist
        // Note: IF NOT EXISTS syntax for ADD COLUMN is supported in newer MySQL/TiDB versions
        // If it fails, we catch the error (duplicate column)

        const queries = [
            "ALTER TABLE shopkeepers ADD COLUMN IF NOT EXISTS shop_scale VARCHAR(20) DEFAULT 'small'",
            "ALTER TABLE shopkeepers ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(20) DEFAULT 'free'",
            "ALTER TABLE shopkeepers ADD COLUMN IF NOT EXISTS trial_ends_at DATETIME NULL"
        ];

        for (const query of queries) {
            try {
                await pool.query(query);
                console.log(`Executed: ${query}`);
            } catch (err) {
                // Ignore "Duplicate column name" error (Code 1060)
                if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes("Duplicate column")) {
                    console.log(`Column already exists (skipped): ${query}`);
                } else {
                    // If syntax error (IF NOT EXISTS not supported), try without it
                    if (err.code === 'ER_PARSE_ERROR') {
                        const simpleQuery = query.replace('IF NOT EXISTS ', '');
                        try {
                            await pool.query(simpleQuery);
                            console.log(`Executed fallback: ${simpleQuery}`);
                        } catch (fallbackErr) {
                            if (fallbackErr.code === 'ER_DUP_FIELDNAME' || fallbackErr.message.includes("Duplicate column")) {
                                console.log(`Column already exists (skipped fallback): ${simpleQuery}`);
                            } else {
                                throw fallbackErr;
                            }
                        }
                    } else {
                        throw err;
                    }
                }
            }
        }

        console.log("✅ Migration completed successfully");
        process.exit(0);
    } catch (error) {
        console.error("❌ Migration failed:", error);
        process.exit(1);
    }
})();
