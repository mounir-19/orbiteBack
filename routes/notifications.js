const router = require('express').Router();
const db = require('../config/db');
const { authenticate } = require('../middleware/auth');

// GET /api/notifications — own notifications
router.get('/', authenticate, async (req, res, next) => {
    const { read } = req.query;
    try {
        const params = [req.user.id];
        let filter = '';
        if (read !== undefined) {
            filter = 'AND read = $2';
            params.push(read === 'true');
        }
        const result = await db.query(
            `SELECT * FROM notification WHERE user_id = $1 ${filter} ORDER BY sent_at DESC LIMIT 50`,
            params
        );
        res.json(result.rows);
    } catch (err) { next(err); }
});

// PATCH /api/notifications/:id/read
router.patch('/:id/read', authenticate, async (req, res, next) => {
    try {
        const result = await db.query(
            `UPDATE notification SET read = TRUE WHERE id = $1 AND user_id = $2 RETURNING *`,
            [req.params.id, req.user.id]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Notification not found' });
        res.json(result.rows[0]);
    } catch (err) { next(err); }
});

// PATCH /api/notifications/read-all
router.patch('/read-all', authenticate, async (req, res, next) => {
    try {
        await db.query(
            'UPDATE notification SET read = TRUE WHERE user_id = $1 AND read = FALSE',
            [req.user.id]
        );
        res.json({ message: 'All notifications marked as read' });
    } catch (err) { next(err); }
});

// DELETE /api/notifications/:id
router.delete('/:id', authenticate, async (req, res, next) => {
    try {
        const result = await db.query(
            'DELETE FROM notification WHERE id = $1 AND user_id = $2 RETURNING id',
            [req.params.id, req.user.id]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Notification not found' });
        res.json({ message: 'Notification deleted' });
    } catch (err) { next(err); }
});

module.exports = router;