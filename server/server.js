const express = require('express');
const cors = require('cors');
require('dotenv').config();

const pool = require('./config/db');

const app = express();
const PORT = 3000;
const authRoutes = require('./routes/auth');

// Middleware
app.use(cors());
app.use(express.json());

//Routes
app.use('/api/auth', authRoutes);

// Test API endpoint
app.get('/api/health', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT current_database() AS database'
        );

        res.json({
            status: 'success',
            message: 'Backend connected to PostgreSQL',
            database: result.rows[0].database
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            status: 'error',
            message: 'Database connection failed'
        });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});