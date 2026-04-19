const router = require('express').Router();
const db = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

// GET /api/certificates
router.get('/', authenticate, async (req, res, next) => {
    try {
        let query, params;
        if (req.user.role === 'student') {
            query = `SELECT c.*, p.title AS project_title, p.service_type
                     FROM certificate c JOIN project p ON p.id = c.project_id
                     WHERE c.student_id = $1 ORDER BY c.issued_at DESC`;
            params = [req.user.id];
        } else {
            const { student_id } = req.query;
            query = `SELECT c.*, p.title AS project_title,
                            u.first_name || ' ' || u.last_name AS student_name
                     FROM certificate c
                     JOIN project p ON p.id = c.project_id
                     JOIN "user" u ON u.id = c.student_id
                     ${student_id ? 'WHERE c.student_id = $1' : ''}
                     ORDER BY c.issued_at DESC`;
            params = student_id ? [student_id] : [];
        }
        const result = await db.query(query, params);
        res.json(result.rows);
    } catch (err) { next(err); }
});

// GET /api/certificates/:id
router.get('/:id', authenticate, async (req, res, next) => {
    try {
        const result = await db.query(
            `SELECT c.*, p.title AS project_title, p.service_type,
                    u.first_name || ' ' || u.last_name AS student_name
             FROM certificate c
             JOIN project p ON p.id = c.project_id
             JOIN "user" u ON u.id = c.student_id
             WHERE c.id = $1`,
            [req.params.id]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Certificate not found' });
        if (req.user.role === 'student' && result.rows[0].student_id !== req.user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }
        res.json(result.rows[0]);
    } catch (err) { next(err); }
});

// POST /api/certificates — Expert/admin issue certificate
router.post('/', authenticate, authorize('admin', 'expert'), async (req, res, next) => {
    const { student_id, project_id, pdf_url } = req.body;
    if (!student_id || !project_id) {
        return res.status(400).json({ error: 'student_id and project_id are required' });
    }
    try {
        // Get project service_type and calculate duration
        const project = await db.query(
            'SELECT service_type, started_at, delivered_at FROM project WHERE id = $1',
            [project_id]
        );
        if (!project.rows.length) return res.status(404).json({ error: 'Project not found' });

        const { service_type, started_at, delivered_at } = project.rows[0];
        let duration_days = null;
        if (started_at && delivered_at) {
            duration_days = Math.ceil((new Date(delivered_at) - new Date(started_at)) / (1000 * 60 * 60 * 24));
        }

        const result = await db.query(
            `INSERT INTO certificate (student_id, project_id, service_type, duration_days, pdf_url)
             VALUES ($1,$2,$3,$4,$5) RETURNING *`,
            [student_id, project_id, service_type, duration_days, pdf_url || null]
        );

        await db.query(
            `INSERT INTO notification (user_id, type, message)
             VALUES ($1, 'certificate_issued', 'Your certificate of experience has been issued. Download it from your profile.')`,
            [student_id]
        );

        res.status(201).json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'Certificate already issued for this student and project' });
        next(err);
    }
});

// PATCH /api/certificates/:id/pdf — Update PDF url
router.patch('/:id/pdf', authenticate, authorize('admin', 'expert'), async (req, res, next) => {
    const { pdf_url } = req.body;
    if (!pdf_url) return res.status(400).json({ error: 'pdf_url is required' });
    try {
        const result = await db.query(
            'UPDATE certificate SET pdf_url = $1 WHERE id = $2 RETURNING *',
            [pdf_url, req.params.id]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Certificate not found' });
        res.json(result.rows[0]);
    } catch (err) { next(err); }
});

module.exports = router;