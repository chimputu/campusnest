const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const pool = require('../config/db');

async function check() {
  const tables = await pool.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = $1 ORDER BY table_name`,
    ['public']
  );

  for (const row of tables.rows) {
    const name = row.table_name;
    const stmt = await pool.query('SELECT format($1::text, $2::text, $3::text) AS sql', ['SELECT COUNT(*)::int AS n FROM %I.%I', 'public', name]);
    const count = await pool.query(stmt.rows[0].sql);
    console.log(`${name}: ${count.rows[0].n}`);
  }

  const migrations = await pool.query('SELECT COUNT(*)::int AS n FROM _migrations');
  console.log(`_migrations (applied): ${migrations.rows[0].n}`);
}

check()
  .then(async () => { await pool.end(); })
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
