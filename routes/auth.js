const router = require('express').Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { validate, registerSchema, loginSchema, changePasswordSchema } = require('../validators');

//  POST /api/auth/register

router.post('/register', validate(registerSchema), async (req, res, next) => {
    const {
        first_name, last_name, email, phone, password, role, domain,
        wilaya, university, cv_url, portfolio_url,
        specialty, bio,
        company, city,
    } = req.body;

    try {
        const exists = await db.query(
            'SELECT id FROM "user" WHERE email = $1 OR phone = $2',
            [email, phone]
        );
        if (exists.rows.length) {
            return res.status(409).json({ error: 'Email or phone already registered' });
        }

        const hashed = await bcrypt.hash(password, 12);
        const userResult = await db.query(
            `INSERT INTO "user" (last_name, first_name, email, phone, password, role, status, domain)
             VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
             RETURNING id, last_name, first_name, email, phone, role, status, domain, created_at`,
            [last_name, first_name, email, phone, hashed, role, domain || null]
        );
        const user = userResult.rows[0];
        if (role === 'student') {
            await db.query(
                `INSERT INTO student (user_id, cv_url, portfolio_url, wilaya, university)
                 VALUES ($1, $2, $3, $4, $5)`,
                [user.id, cv_url || null, portfolio_url || null, wilaya || null, university || null]
            );
        } else if (role === 'expert') {
            await db.query(
                `INSERT INTO expert (user_id, specialty, bio) VALUES ($1, $2, $3)`,
                [user.id, specialty || null, bio || null]
            );
        } else if (role === 'client') {
            await db.query(
                `INSERT INTO client (user_id, company, city) VALUES ($1, $2, $3)`,
                [user.id, company || null, city || null]
            );
        }

        const token = jwt.sign(
            { id: user.id, role: user.role, domain: user.domain },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
        );

        res.status(201).json({ token, user });
    } catch (err) {
        next(err);
    }
});

//  POST /api/auth/login

router.post('/login', validate(loginSchema), async (req, res, next) => {
    const { email, password } = req.body;
    try {
        const result = await db.query(
            `SELECT id, last_name, first_name, email, phone, password, role, status, domain
             FROM "user" WHERE email = $1`,
            [email]
        );
        const user = result.rows[0];

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        if (user.status === 'suspended') {
            return res.status(403).json({ error: 'Account suspended' });
        }

        const { password: _, ...safeUser } = user;

        const token = jwt.sign(
            { id: user.id, role: user.role, domain: user.domain },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
        );

        res.json({ token, user: safeUser });
    } catch (err) {
        next(err);
    }
});

//  GET /api/auth/me

router.get('/me', authenticate, async (req, res, next) => {
    try {
        const result = await db.query(
            `SELECT id, last_name, first_name, email, phone, role, status, domain, created_at
             FROM "user" WHERE id = $1`,
            [req.user.id]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
        res.json(result.rows[0]);
    } catch (err) {
        next(err);
    }
});

//  PUT /api/auth/change-password
router.put('/change-password', authenticate, validate(changePasswordSchema), async (req, res, next) => {
    const { current_password, new_password } = req.body;
    try {
        const result = await db.query('SELECT password FROM "user" WHERE id = $1', [req.user.id]);
        const user = result.rows[0];

        if (!(await bcrypt.compare(current_password, user.password))) {
            return res.status(400).json({ error: 'Current password is incorrect' });
        }

        const hashed = await bcrypt.hash(new_password, 12);
        await db.query('UPDATE "user" SET password = $1 WHERE id = $2', [hashed, req.user.id]);

        res.json({ message: 'Password updated successfully' });
    } catch (err) {
        next(err);
    }
});

module.exports = router;