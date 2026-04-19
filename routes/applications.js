const router = require('express').Router();
const db = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { validate, createApplicationSchema, updateApplicationSchema } = require('../validators');

//  GET /api/applications

router.get('/', authenticate, async (req, res, next) => {
    const { project_id, status } = req.query;
    try {
        let query, params;

        if (req.user.role === 'student') {
            query = `SELECT a.*, p.title AS project_title, p.service_type
                     FROM application a
                     JOIN project p ON p.id = a.project_id
                     WHERE a.student_id = $1
                     ${status ? 'AND a.status = $2' : ''}
                     ORDER BY a.applied_at DESC`;
            params = status ? [req.user.id, status] : [req.user.id];
        } else {
            if (!project_id) return res.status(400).json({ error: 'project_id is required' });

            let i = 1;
            params = [project_id];
            let statusFilter = '';
            if (status) {
                statusFilter = `AND a.status = $${++i}`;
                params.push(status);
            }

            query = `SELECT a.*,
                            u.first_name, u.last_name, u.email,
                            s.global_rating, s.consecutive_projects
                     FROM application a
                     JOIN "user" u ON u.id = a.student_id
                     JOIN student s ON s.user_id = a.student_id
                     WHERE a.project_id = $1
                     ${statusFilter}
                     ORDER BY s.global_rating DESC`;
        }

        const result = await db.query(query, params);
        res.json(result.rows);
    } catch (err) {
        next(err);
    }
});
//  POST /api/applications
//  Student only

router.post('/', authenticate, authorize('student'), validate(createApplicationSchema), async (req, res, next) => {
    const { project_id, message } = req.body;
    if (!project_id) return res.status(400).json({ error: 'project_id is required' });

    try {
        // Check project exists and is open
        const project = await db.query(
            `SELECT id, service_type, status FROM project WHERE id = $1`,
            [project_id]
        );
        if (!project.rows.length) return res.status(404).json({ error: 'Project not found' });
        if (!['accepted', 'in_progress'].includes(project.rows[0].status)) {
            return res.status(400).json({ error: 'Project is not open for applications' });
        }
        if (project.rows[0].service_type !== req.user.domain) {
            return res.status(403).json({ error: 'Project domain does not match your domain' });
        }

        // Check consecutive projects rule
        const studentData = await db.query(
            'SELECT consecutive_projects FROM student WHERE user_id = $1',
            [req.user.id]
        );
        if (studentData.rows[0].consecutive_projects >= 1) {
            const active = await db.query(
                `SELECT a.id FROM application a
                 JOIN project p ON p.id = a.project_id
                 WHERE a.student_id = $1 AND a.status = 'selected'
                 AND p.status IN ('in_progress', 'in_review')`,
                [req.user.id]
            );
            if (active.rows.length) {
                return res.status(400).json({ error: 'You already have an active project. No consecutive projects allowed.' });
            }
        }

        // Check referral priority
        const referral = await db.query(
            `SELECT id FROM referral WHERE student_id = $1 AND project_id = $2 AND status = 'converted'`,
            [req.user.id, project_id]
        );
        const referral_priority = referral.rows.length > 0;

        const result = await db.query(
            `INSERT INTO application (student_id, project_id, message, referral_priority)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [req.user.id, project_id, message || null, referral_priority]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'You already applied to this project' });
        next(err);
    }
});

//  PATCH /api/applications/:id
//  Expert/admin: select or reject | Student: withdraw

router.patch('/:id', authenticate, validate(updateApplicationSchema), async (req, res, next) => {
    const { status } = req.body;
    try {
        const app = await db.query('SELECT * FROM application WHERE id = $1', [req.params.id]);
        if (!app.rows.length) return res.status(404).json({ error: 'Application not found' });
        if (req.user.role === 'student') {
            if (app.rows[0].student_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });
            if (status !== 'withdrawn') return res.status(403).json({ error: 'Students can only withdraw applications' });
        }

        const result = await db.query(
            'UPDATE application SET status = $1 WHERE id = $2 RETURNING *',
            [status, req.params.id]
        );

        // If selected: open project group and add student
        if (status === 'selected') {
            const { student_id, project_id } = app.rows[0];

            // Get or create group
            let group = await db.query('SELECT id FROM project_group WHERE project_id = $1', [project_id]);
            if (!group.rows.length) {
                group = await db.query(
                    'INSERT INTO project_group (project_id) VALUES ($1) RETURNING id',
                    [project_id]
                );
            }
            const group_id = group.rows[0].id;

            // Add student to group
            await db.query(
                `INSERT INTO group_member (group_id, student_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                [group_id, student_id]
            );

            // Update consecutive_projects
            await db.query(
                'UPDATE student SET consecutive_projects = consecutive_projects + 1 WHERE user_id = $1',
                [student_id]
            );

            // Notify student
            await db.query(
                `INSERT INTO notification (user_id, type, message)
                 VALUES ($1, 'application_selected', 'You have been selected for a project. Check your workspace.')`,
                [student_id]
            );
        }

        res.json(result.rows[0]);
    } catch (err) {
        next(err);
    }
});

// =============================================================
//  DELETE /api/applications/:id
//  Admin only
// =============================================================

router.delete('/:id', authenticate, authorize('admin'), async (req, res, next) => {
    try {
        const result = await db.query('DELETE FROM application WHERE id = $1 RETURNING id', [req.params.id]);
        if (!result.rows.length) return res.status(404).json({ error: 'Application not found' });
        res.json({ message: 'Application deleted' });
    } catch (err) {
        next(err);
    }
});

module.exports = router;