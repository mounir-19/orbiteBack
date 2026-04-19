const router = require('express').Router();
const db = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { validate, createReferralSchema, updateReferralSchema } = require('../validators');

// GET /api/referrals
router.get('/', authenticate, async (req, res, next) => {
    try {
        let query, params;
        if (req.user.role === 'student') {
            query = `SELECT r.*, p.title AS project_title
                     FROM referral r LEFT JOIN project p ON p.id = r.project_id
                     WHERE r.student_id = $1 ORDER BY r.referred_at DESC`;
            params = [req.user.id];
        } else {
            query = `SELECT r.*, p.title AS project_title,
                            u.first_name || ' ' || u.last_name AS student_name
                     FROM referral r
                     LEFT JOIN project p ON p.id = r.project_id
                     JOIN "user" u ON u.id = r.student_id
                     ORDER BY r.referred_at DESC`;
            params = [];
        }
        const result = await db.query(query, params);
        res.json(result.rows);
    } catch (err) { next(err); }
});

// POST /api/referrals — Student only
router.post('/', authenticate, authorize('student'), validate(createReferralSchema), async (req, res, next) => {
    const { client_contact, bonus_amount } = req.body;
    try {
        const result = await db.query(
            `INSERT INTO referral (student_id, client_contact, bonus_amount)
             VALUES ($1,$2,$3) RETURNING *`,
            [req.user.id, client_contact, bonus_amount || null]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) { next(err); }
});

// PATCH /api/referrals/:id — Admin only
router.patch('/:id', authenticate, authorize('admin'), validate(updateReferralSchema), async (req, res, next) => {
    const { status, project_id, bonus_amount } = req.body;
    try {
        const result = await db.query(
            `UPDATE referral
             SET status       = $1,
                 project_id   = COALESCE($2, project_id),
                 bonus_amount = COALESCE($3, bonus_amount)
             WHERE id = $4 RETURNING *`,
            [status, project_id || null, bonus_amount || null, req.params.id]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Referral not found' });

        const ref = result.rows[0];
        if (status === 'converted' && ref.project_id) {
            await db.query(
                `UPDATE application SET referral_priority = TRUE
                 WHERE student_id = $1 AND project_id = $2`,
                [ref.student_id, ref.project_id]
            );
        }
        await db.query(
            `INSERT INTO notification (user_id, type, message) VALUES ($1, 'referral_update', $2)`,
            [ref.student_id, `Your referral status has been updated to: ${status}`]
        );

        res.json(result.rows[0]);
    } catch (err) { next(err); }
});

module.exports = router;