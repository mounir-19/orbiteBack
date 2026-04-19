const router = require('express').Router();
const db = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
//  GET /api/users
router.get('/', authenticate, authorize('admin'), async (req, res, next) => {
    const { role, status, domain, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];
    let i = 1;

    if (role) { conditions.push(`role = $${i++}`); params.push(role); }
    if (status) { conditions.push(`status = $${i++}`); params.push(status); }
    if (domain) { conditions.push(`domain = $${i++}`); params.push(domain); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    try {
        const total = await db.query(`SELECT COUNT(*) FROM "user" ${where}`, params);
        const users = await db.query(
            `SELECT id, last_name, first_name, email, phone, role, status, domain, created_at
             FROM "user" ${where}
             ORDER BY created_at DESC
             LIMIT $${i++} OFFSET $${i++}`,
            [...params, limit, offset]
        );
        res.json({
            total: parseInt(total.rows[0].count),
            page: parseInt(page),
            limit: parseInt(limit),
            users: users.rows,
        });
    } catch (err) {
        next(err);
    }
});
//  GET /api/users/:id
router.get('/:id', authenticate, async (req, res, next) => {
    if (req.user.role !== 'admin' && req.user.id !== req.params.id) {
        return res.status(403).json({ error: 'Access denied' });
    }
    try {
        const result = await db.query(
            `SELECT id, last_name, first_name, email, phone, role, status, domain, created_at
             FROM "user" WHERE id = $1`,
            [req.params.id]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'User not found' });

        const user = result.rows[0];
        if (user.role === 'student') {
            const s = await db.query('SELECT * FROM student WHERE user_id = $1', [user.id]);
            user.student = s.rows[0] || null;
        } else if (user.role === 'expert') {
            const e = await db.query('SELECT * FROM expert WHERE user_id = $1', [user.id]);
            user.expert = e.rows[0] || null;
        } else if (user.role === 'client') {
            const c = await db.query('SELECT * FROM client WHERE user_id = $1', [user.id]);
            user.client = c.rows[0] || null;
        }

        res.json(user);
    } catch (err) {
        next(err);
    }
});
//  PUT /api/users/:id
router.put('/:id', authenticate, async (req, res, next) => {
    if (req.user.role !== 'admin' && req.user.id !== req.params.id) {
        return res.status(403).json({ error: 'Access denied' });
    }

    const { first_name, last_name, phone,
        cv_url, portfolio_url, wilaya, university,
        specialty, bio, available,
        company, city } = req.body;
    try {
        await db.query(
            `UPDATE "user"
             SET first_name = COALESCE($1, first_name),
                 last_name  = COALESCE($2, last_name),
                 phone      = COALESCE($3, phone)
             WHERE id = $4`,
            [first_name, last_name, phone, req.params.id]
        );
        const roleRes = await db.query('SELECT role FROM "user" WHERE id = $1', [req.params.id]);
        const role = roleRes.rows[0]?.role;

        if (role === 'student') {
            await db.query(
                `UPDATE student
                 SET cv_url        = COALESCE($1, cv_url),
                     portfolio_url = COALESCE($2, portfolio_url),
                     wilaya        = COALESCE($3, wilaya),
                     university    = COALESCE($4, university)
                 WHERE user_id = $5`,
                [cv_url, portfolio_url, wilaya, university, req.params.id]
            );
        } else if (role === 'expert') {
            await db.query(
                `UPDATE expert
                 SET specialty = COALESCE($1, specialty),
                     bio       = COALESCE($2, bio),
                     available = COALESCE($3, available)
                 WHERE user_id = $4`,
                [specialty, bio, available, req.params.id]
            );
        } else if (role === 'client') {
            await db.query(
                `UPDATE client
                 SET company = COALESCE($1, company),
                     city    = COALESCE($2, city)
                 WHERE user_id = $3`,
                [company, city, req.params.id]
            );
        }

        res.json({ message: 'Profile updated successfully' });
    } catch (err) {
        next(err);
    }
});
//  PATCH /api/users/:id/status
router.patch('/:id/status', authenticate, authorize('admin'), async (req, res, next) => {
    const { status } = req.body;
    const valid = ['active', 'inactive', 'suspended', 'pending'];
    if (!valid.includes(status)) {
        return res.status(400).json({ error: 'Invalid status value' });
    }
    try {
        const result = await db.query(
            `UPDATE "user" SET status = $1 WHERE id = $2
             RETURNING id, email, status`,
            [status, req.params.id]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
        res.json(result.rows[0]);
    } catch (err) {
        next(err);
    }
});

//  DELETE /api/users/:id
router.delete('/:id', authenticate, authorize('admin'), async (req, res, next) => {
    try {
        const result = await db.query(
            'DELETE FROM "user" WHERE id = $1 RETURNING id',
            [req.params.id]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
        res.json({ message: 'User deleted successfully' });
    } catch (err) {
        next(err);
    }
});
//  GET /api/users/students/list
router.get('/students/list', authenticate, authorize('admin', 'expert'), async (req, res, next) => {
    const { domain } = req.query;
    try {
        const result = await db.query(
            `SELECT u.id, u.first_name, u.last_name, u.email, u.domain,
                    s.global_rating, s.consecutive_projects, s.wilaya, s.university
             FROM "user" u
             JOIN student s ON s.user_id = u.id
             WHERE u.status = 'active'
             ${domain ? 'AND u.domain = $1' : ''}
             ORDER BY s.global_rating DESC`,
            domain ? [domain] : []
        );
        res.json(result.rows);
    } catch (err) {
        next(err);
    }
});

module.exports = router;