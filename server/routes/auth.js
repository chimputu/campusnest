const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../config/db');

const router = express.Router();

// POST /api/auth/register
router.post('/register', async (req, res) => {
    try {
        const { full_name, email, password, phone, role } = req.body;

        // Validate required fields
        if (!full_name || !email || !password || !role) {
            return res.status(400).json({
                status: 'error',
                message: 'Please provide your name, email, password and role.'
            });
        }

        // Normalize role to uppercase
        const normalizedRole = role.trim().toUpperCase();

        // Only tenants and landlords can register publicly
        if (!['TENANT', 'LANDLORD'].includes(normalizedRole)) { 
            return res.status(403).json({
                status: 'error',
                message: 'Invalid registration role.'
            });
        }

        // Validate password length
        if (password.length < 8) {
            return res.status(400).json({
                status: 'error',
                message: 'Password must contain at least 8 characters.'
            });
        }

        // Check whether email already exists
        const existingUser = await pool.query(
            'SELECT user_id FROM users WHERE LOWER(email) = LOWER($1)',
            [email.trim()]
        );

        if (existingUser.rows.length > 0) {
            return res.status(409).json({
                status: 'error',
                message: 'An account with this email already exists.'
            });
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 12);

        // Insert new user
        const result = await pool.query(
            `INSERT INTO users
            (full_name, email, password_hash, phone, role)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING user_id, full_name, email, phone, role, verified, created_at`,
            [
                full_name.trim(),
                email.trim().toLowerCase(),
                passwordHash,
                phone || null,
                normalizedRole
            ]
        );

        res.status(201).json({
            status: 'success',
            message: 'Account registered successfully.',
            user: result.rows[0]
        });

    } catch (error) {
        console.error('Registration error:', error);

        res.status(500).json({
            status: 'error',
            message: 'An error occurred during registration.'
        });
    }
});
// POST /api/auth/login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validate required fields
        if (
            typeof email !== 'string' ||
            typeof password !== 'string' ||
            !email.trim() ||
            !password
        ) {
            return res.status(400).json({
                status: 'error',
                message: 'Please provide your email and password.'
            });
        }

        // Find the user by email
        const result = await pool.query(
            `SELECT user_id, full_name, email, password_hash,
                    phone, role, verified, created_at
             FROM users
             WHERE LOWER(email) = LOWER($1)`,
            [email.trim()]
        );

        // Reject an unknown email
        if (result.rows.length === 0) {
            return res.status(401).json({
                status: 'error',
                message: 'Invalid email or password.'
            });
        }

        const user = result.rows[0];

        // Compare the submitted password with the stored hash
        const passwordMatches = await bcrypt.compare(
            password,
            user.password_hash
        );

        // Reject an incorrect password
        if (!passwordMatches) {
            return res.status(401).json({
                status: 'error',
                message: 'Invalid email or password.'
            });
        }

        // Return the user details without exposing the password hash
        const {
            password_hash,
            ...safeUser
        } = user;

        return res.status(200).json({
            status: 'success',
            message: 'Login successful.',
            user: safeUser
        });

    } catch (error) {
        console.error('Login error:', error);

        return res.status(500).json({
            status: 'error',
            message: 'An error occurred during login.'
        });
    }
});
module.exports = router;