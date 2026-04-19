const router = require('express').Router();
const db = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { validate, createPaymentSchema, updatePaymentSchema } = require('../validators');

// GET /api/payments
router.get('/', authenticate, async (req, res, next) => {
    const { project_id, status } = req.query;
    try {
        let query, params;

        if (req.user.role === 'student' || req.user.role === 'expert') {
            query = `SELECT pay.*, p.title AS project_title
                     FROM payment pay JOIN project p ON p.id = pay.project_id
                     WHERE pay.recipient_id = $1
                     ${status ? 'AND pay.status = $2' : ''}
                     ORDER BY pay.created_at DESC`;
            params = status ? [req.user.id, status] : [req.user.id];
        } else {
            query = `SELECT pay.*, p.title AS project_title,
                            u.first_name || ' ' || u.last_name AS recipient_name
                     FROM payment pay
                     JOIN project p ON p.id = pay.project_id
                     JOIN "user" u ON u.id = pay.recipient_id
                     WHERE 1=1
                     ${project_id ? 'AND pay.project_id = $1' : ''}
                     ${status ? `AND pay.status = $${project_id ? 2 : 1}` : ''}
                     ORDER BY pay.created_at DESC`;
            params = [project_id, status].filter(Boolean);
        }

        const result = await db.query(query, params);
        res.json(result.rows);
    } catch (err) { next(err); }
});

// GET /api/payments/breakdown/:project_id
router.get('/breakdown/:project_id', authenticate, authorize('admin', 'expert'), async (req, res, next) => {
    try {
        const result = await db.query(
            'SELECT * FROM v_payment_breakdown WHERE project_id = $1',
            [req.params.project_id]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Project not found' });
        res.json(result.rows[0]);
    } catch (err) { next(err); }
});

// POST /api/payments — Admin only
router.post('/', authenticate, authorize('admin'), validate(createPaymentSchema), async (req, res, next) => {
    const { project_id, recipient_id, recipient_type, amount, method, transaction_ref } = req.body;
    try {
        const result = await db.query(
            `INSERT INTO payment (project_id, recipient_id, recipient_type, amount, method, transaction_ref)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [project_id, recipient_id, recipient_type, amount, method, transaction_ref || null]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) { next(err); }
});

// PATCH /api/payments/:id — Admin only
router.patch('/:id', authenticate, authorize('admin'), validate(updatePaymentSchema), async (req, res, next) => {
    const { status, transaction_ref, processed_at } = req.body;
    try {
        const result = await db.query(
            `UPDATE payment
             SET status          = $1,
                 transaction_ref = COALESCE($2, transaction_ref),
                 processed_at    = COALESCE($3, processed_at)
             WHERE id = $4 RETURNING *`,
            [status, transaction_ref, processed_at || null, req.params.id]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Payment not found' });
        const pay = result.rows[0];
        await db.query(
            `INSERT INTO notification (user_id, type, message) VALUES ($1, 'payment_update', $2)`,
            [pay.recipient_id, `Your payment of ${pay.amount} DZD has been ${status}.`]
        );

        res.json(result.rows[0]);
    } catch (err) { next(err); }
});

module.exports = router;