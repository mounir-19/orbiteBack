const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

pool.query('SELECT NOW()')
    .then(() => console.log('PostgreSQL connected successfully'))
    .catch((err) => {
        console.error('PostgreSQL connection failed:', err.message);
        process.exit(1);
    });

module.exports = {
    query: (text, params) => pool.query(text, params),
    pool,
};