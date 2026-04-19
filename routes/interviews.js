const router = require('express').Router();
const db = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { validate, createInterviewSchema, updateInterviewSchema } = require('../validators');
//  GET /api/interviews
router.get('/', authenticate, async (req, res, next) => {
    try {
        let query, params;

        if (req.user.role === 'expert') {
            query = `SELECT i.*,
                            u.first_name || ' ' || u.last_name AS student_name,
                            u.email AS student_email
                     FROM interview i
                     JOIN "user" u ON u.id = i.student_id
                     WHERE i.expert_id = $1
                     ORDER BY i.scheduled_at DESC`;
            params = [req.user.id];

        } else if (req.user.role === 'student') {
            query = `SELECT i.*,
                            e.first_name || ' ' || e.last_name AS expert_name
                     FROM interview i
                     JOIN "user" e ON e.id = i.expert_id
                     WHERE i.student_id = $1
                     ORDER BY i.scheduled_at DESC`;
            params = [req.user.id];

        } else {
            query = `SELECT i.*,
                            u.first_name || ' ' || u.last_name AS student_name,
                            e.first_name || ' ' || e.last_name AS expert_name
                     FROM interview i
                     JOIN "user" u ON u.id = i.student_id
                     JOIN "user" e ON e.id = i.expert_id
                     ORDER BY i.scheduled_at DESC`;
            params = [];
        }

        const result = await db.query(query, params);
        res.json(result.rows);
    } catch (err) {
        next(err);
    }
});
//  GET /api/interviews/:id
router.get('/:id', authenticate, async (req, res, next) => {
    try {
        const result = await db.query(
            `SELECT i.*,
                    u.first_name || ' ' || u.last_name AS student_name, u.email AS student_email,
                    e.first_name || ' ' || e.last_name AS expert_name
             FROM interview i
             JOIN "user" u ON u.id = i.student_id
             JOIN "user" e ON e.id = i.expert_id
             WHERE i.id = $1`,
            [req.params.id]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Interview not found' });

        const interview = result.rows[0];
        if (req.user.role === 'student' && interview.student_id !== req.user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        res.json(interview);
    } catch (err) {
        next(err);
    }
});
//  POST /api/interviews
router.post('/', authenticate, authorize('expert'), validate(createInterviewSchema), async (req, res, next) => {
    const { student_id, scheduled_at, meeting_link } = req.body;
    try {
        const student = await db.query(
            `SELECT u.id, u.status FROM "user" u WHERE u.id = $1 AND u.role = 'student'`,
            [student_id]
        );
        if (!student.rows.length) return res.status(404).json({ error: 'Student not found' });

        const result = await db.query(
            `INSERT INTO interview (student_id, expert_id, scheduled_at, meeting_link)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [student_id, req.user.id, scheduled_at, meeting_link || null]
        );
        await db.query(
            `INSERT INTO notification (user_id, type, message)
             VALUES ($1, 'interview_scheduled', $2)`,
            [student_id, `Your interview has been scheduled for ${new Date(scheduled_at).toLocaleString()}`]
        );

        res.status(201).json(result.rows[0]);
    } catch (err) {
        next(err);
    }
});
//  PUT /api/interviews/:id
router.put('/:id', authenticate, authorize('admin', 'expert'), validate(updateInterviewSchema), async (req, res, next) => {
    const { scheduled_at, meeting_link, status, result: interviewResult, comment } = req.body;
    try {
        const existing = await db.query('SELECT * FROM interview WHERE id = $1', [req.params.id]);
        if (!existing.rows.length) return res.status(404).json({ error: 'Interview not found' });

        if (req.user.role === 'expert' && existing.rows[0].expert_id !== req.user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const updated = await db.query(
            `UPDATE interview
             SET scheduled_at  = COALESCE($1, scheduled_at),
                 meeting_link  = COALESCE($2, meeting_link),
                 status        = COALESCE($3, status),
                 result        = COALESCE($4, result),
                 comment       = COALESCE($5, comment)
             WHERE id = $6 RETURNING *`,
            [scheduled_at, meeting_link, status, interviewResult, comment, req.params.id]
        );
        if (interviewResult === 'admitted') {
            await db.query(
                `UPDATE "user" SET status = 'active' WHERE id = $1`,
                [existing.rows[0].student_id]
            );
            await db.query(
                `INSERT INTO notification (user_id, type, message)
                 VALUES ($1, 'interview_admitted', 'Congratulations! You passed the interview and your account is now active.')`,
                [existing.rows[0].student_id]
            );
        } else if (interviewResult === 'rejected') {
            await db.query(
                `INSERT INTO notification (user_id, type, message)
                 VALUES ($1, 'interview_rejected', 'Unfortunately, you did not pass the interview. You may reapply after 3 months.')`,
                [existing.rows[0].student_id]
            );
        }

        res.json(updated.rows[0]);
    } catch (err) {
        next(err);
    }
});
//  DELETE /api/interviews/:id
router.delete('/:id', authenticate, authorize('admin'), async (req, res, next) => {
    try {
        const result = await db.query('DELETE FROM interview WHERE id = $1 RETURNING id', [req.params.id]);
        if (!result.rows.length) return res.status(404).json({ error: 'Interview not found' });
        res.json({ message: 'Interview deleted' });
    } catch (err) {
        next(err);
    }
});

module.exports = router;