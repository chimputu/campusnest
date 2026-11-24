const { types } = require('pg');
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));   // BIGINT -> number
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));   // NUMERIC -> float

const { Pool } = require('pg');
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
});

// Test database connection
pool.on('connect', () => {
    console.log('Connected to PostgreSQL database.');
});

pool.on('error', (err) => {
    console.error('Unexpected PostgreSQL error:', err);
});

module.exports = pool;