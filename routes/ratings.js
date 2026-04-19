//  ratings.js
const ratingsRouter = require('express').Router();
const db = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { validate, createRatingSchema } = require('../validators');

ratingsRouter.get('/', authenticate, async (req, res, next) => {
    const { student_id, project_id } = req.query;
    try {
        let query, params;
        if (req.user.role === 'student') {
            query = `SELECT r.*, p.title AS project_title
                     FROM rating r JOIN project p ON p.id = r.project_id
                     WHERE r.student_id = $1 ORDER BY r.rated_at DESC`;
            params = [req.user.id];
        } else if (student_id) {
            query = `SELECT r.*, p.title AS project_title
                     FROM rating r JOIN project p ON p.id = r.project_id
                     WHERE r.student_id = $1 ORDER BY r.rated_at DESC`;
            params = [student_id];
        } else if (project_id) {
            query = `SELECT r.*,
                            u.first_name || ' ' || u.last_name AS student_name
                     FROM rating r JOIN "user" u ON u.id = r.student_id
                     WHERE r.project_id = $1`;
            params = [project_id];
        } else {
            return res.status(400).json({ error: 'student_id or project_id required' });
        }
        const result = await db.query(query, params);
        res.json(result.rows);
    } catch (err) { next(err); }
});

ratingsRouter.post('/', authenticate, authorize('expert'), validate(createRatingSchema), async (req, res, next) => {
    const { student_id, project_id, quality, deadline, communication, collaboration, technical, comment } = req.body;
    try {
        const result = await db.query(
            `INSERT INTO rating (student_id, project_id, expert_id, quality, deadline, communication, collaboration, technical, comment)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [student_id, project_id, req.user.id, quality, deadline, communication, collaboration, technical, comment || null]
        );
        await db.query(
            `INSERT INTO notification (user_id, type, message) VALUES ($1, 'new_rating', 'You received a new rating for your project work.')`,
            [student_id]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'Rating already exists for this student and project' });
        next(err);
    }
});

ratingsRouter.get('/:id', authenticate, async (req, res, next) => {
    try {
        const result = await db.query('SELECT * FROM rating WHERE id = $1', [req.params.id]);
        if (!result.rows.length) return res.status(404).json({ error: 'Rating not found' });
        if (req.user.role === 'student' && result.rows[0].student_id !== req.user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }
        res.json(result.rows[0]);
    } catch (err) { next(err); }
});

module.exports = ratingsRouter;