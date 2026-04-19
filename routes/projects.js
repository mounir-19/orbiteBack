const router = require('express').Router();
const db = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { validate, createProjectSchema, updateProjectSchema } = require('../validators');

//  GET /api/projects
//  Admin/expert: all projects | Client: own projects | Student: open projects in their domain
router.get('/', authenticate, async (req, res, next) => {
    const { status, domain, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    try {
        let query, params;

        if (req.user.role === 'client') {
            query = `SELECT * FROM v_project_board WHERE client_name IS NOT NULL
                     AND project_id IN (SELECT id FROM project WHERE client_id = $1)
                     ORDER BY created_at DESC LIMIT $2 OFFSET $3`;
            params = [req.user.id, limit, offset];

        } else if (req.user.role === 'student') {
            query = `SELECT * FROM v_project_board
                     WHERE service_type = $1
                     AND status IN ('accepted', 'in_progress')
                     ORDER BY created_at DESC LIMIT $2 OFFSET $3`;
            params = [req.user.domain, limit, offset];

        } else {
            const conditions = [];
            params = [];
            let i = 1;
            if (status) { conditions.push(`status = $${i++}`); params.push(status); }
            if (domain) { conditions.push(`service_type = $${i++}`); params.push(domain); }
            const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
            query = `SELECT * FROM v_project_board ${where}
                     ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i++}`;
            params.push(limit, offset);
        }

        const result = await db.query(query, params);
        res.json(result.rows);
    } catch (err) {
        next(err);
    }
});
//  GET /api/projects/:id
router.get('/:id', authenticate, async (req, res, next) => {
    try {
        const result = await db.query(
            'SELECT * FROM v_project_board WHERE project_id = $1',
            [req.params.id]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Project not found' });
        if (req.user.role === 'student' && result.rows[0].service_type !== req.user.domain) {
            return res.status(403).json({ error: 'Access denied' });
        }
        const tasks = await db.query(
            'SELECT * FROM task WHERE project_id = $1 ORDER BY created_at',
            [req.params.id]
        );

        res.json({ ...result.rows[0], tasks: tasks.rows });
    } catch (err) {
        next(err);
    }
});
//  POST /api/projects
router.post('/', authenticate, authorize('client'), validate(createProjectSchema), async (req, res, next) => {
    const { title, service_type, description, team_size } = req.body;
    try {
        const result = await db.query(
            `INSERT INTO project (client_id, title, service_type, description, team_size)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [req.user.id, title, service_type, description, team_size || 1]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        next(err);
    }
});
//  PUT /api/projects/:id
router.put('/:id', authenticate, authorize('admin', 'expert'), validate(updateProjectSchema), async (req, res, next) => {
    const { title, description, status, total_price, team_size, expert_notes, started_at, delivered_at } = req.body;
    try {
        const result = await db.query(
            `UPDATE project
             SET title        = COALESCE($1, title),
                 description  = COALESCE($2, description),
                 status       = COALESCE($3, status),
                 total_price  = COALESCE($4, total_price),
                 team_size    = COALESCE($5, team_size),
                 expert_notes = COALESCE($6, expert_notes),
                 started_at   = COALESCE($7, started_at),
                 delivered_at = COALESCE($8, delivered_at)
             WHERE id = $9
             RETURNING *`,
            [title, description, status, total_price, team_size, expert_notes, started_at, delivered_at, req.params.id]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Project not found' });
        res.json(result.rows[0]);
    } catch (err) {
        next(err);
    }
});
//  PATCH /api/projects/:id/assign-expert
router.patch('/:id/assign-expert', authenticate, authorize('admin'), async (req, res, next) => {
    const { expert_id } = req.body;
    if (!expert_id) return res.status(400).json({ error: 'expert_id is required' });
    try {
        const result = await db.query(
            `UPDATE project SET expert_id = $1, status = 'under_review'
             WHERE id = $2 RETURNING *`,
            [expert_id, req.params.id]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Project not found' });
        res.json(result.rows[0]);
    } catch (err) {
        next(err);
    }
});
//  DELETE /api/projects/:id
router.delete('/:id', authenticate, authorize('admin'), async (req, res, next) => {
    try {
        const result = await db.query(
            'DELETE FROM project WHERE id = $1 RETURNING id',
            [req.params.id]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Project not found' });
        res.json({ message: 'Project deleted successfully' });
    } catch (err) {
        next(err);
    }
});

module.exports = router;