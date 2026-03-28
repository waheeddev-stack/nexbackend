import mysql from "mysql2/promise";

const pool = mysql.createPool({
  host: 'gateway01.ap-northeast-1.prod.aws.tidbcloud.com',
  port: 4000,
  user: '46qwXvMazwF4bW3.root',
  password: '2ox9URtfNyH2Bj3z',
  database: 'nexkiranadb',
  ssl: { rejectUnauthorized: false }
});

async function checkSchema() {
  try {
    const conn = await pool.getConnection();
    const [columns] = await conn.execute('DESCRIBE orders');
    console.log('Orders table columns:');
    console.table(columns.map(c => ({ Field: c.Field, Type: c.Type, Null: c.Null })));
    conn.release();
    pool.end();
  } catch (err) {
    console.error('Error:', err.message);
    pool.end();
  }
}

checkSchema();
