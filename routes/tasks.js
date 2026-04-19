const router = require('express').Router();
const db = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { validate, createTaskSchema, updateTaskSchema, bulkCreateTasksSchema } = require('../validators');
//  GET /api/tasks?project_id=
router.get('/', authenticate, async (req, res, next) => {
    const { project_id } = req.query;
    if (!project_id) return res.status(400).json({ error: 'project_id is required' });

    try {
        let query, params;

        if (req.user.role === 'student') {
            query = `SELECT t.*, u.first_name || ' ' || u.last_name AS assigned_to
                     FROM task t
                     LEFT JOIN "user" u ON u.id = t.student_id
                     WHERE t.project_id = $1 AND t.student_id = $2
                     ORDER BY t.created_at`;
            params = [project_id, req.user.id];
        } else {
            query = `SELECT t.*, u.first_name || ' ' || u.last_name AS assigned_to
                     FROM task t
                     LEFT JOIN "user" u ON u.id = t.student_id
                     WHERE t.project_id = $1
                     ORDER BY t.created_at`;
            params = [project_id];
        }

        const result = await db.query(query, params);
        res.json(result.rows);
    } catch (err) {
        next(err);
    }
});
//  GET /api/tasks/:id
router.get('/:id', authenticate, async (req, res, next) => {
    try {
        const result = await db.query(
            `SELECT t.*, u.first_name || ' ' || u.last_name AS assigned_to
             FROM task t
             LEFT JOIN "user" u ON u.id = t.student_id
             WHERE t.id = $1`,
            [req.params.id]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Task not found' });
        if (req.user.role === 'student' && result.rows[0].student_id !== req.user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        res.json(result.rows[0]);
    } catch (err) {
        next(err);
    }
});
//  POST /api/tasks
router.post('/', authenticate, authorize('admin', 'expert'), validate(createTaskSchema), async (req, res, next) => {
    const { project_id } = req.query;
    if (!project_id) return res.status(400).json({ error: 'project_id is required' });

    const { title, description, weight_pct, commit_freq, due_date, domain_tag, student_id, ai_proposed } = req.body;

    try {
        await validateWeightBudget(project_id, weight_pct);

        const result = await db.query(
            `INSERT INTO task (project_id, student_id, title, description, weight_pct, commit_freq, due_date, domain_tag, ai_proposed)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
            [project_id, student_id || null, title, description || null, weight_pct, commit_freq || null, due_date || null, domain_tag || null, ai_proposed || false]
        );

        if (student_id) {
            await db.query(
                `INSERT INTO notification (user_id, type, message)
                 VALUES ($1, 'task_assigned', $2)`,
                [student_id, `You have been assigned a new task: ${title}`]
            );
        }

        res.status(201).json(result.rows[0]);
    } catch (err) {
        next(err);
    }
});
//  POST /api/tasks/bulk
router.post('/bulk', authenticate, authorize('admin', 'expert'), validate(bulkCreateTasksSchema), async (req, res, next) => {
    const { project_id } = req.query;
    if (!project_id) return res.status(400).json({ error: 'project_id is required' });

    const { tasks } = req.body;
    const total = tasks.reduce((sum, t) => sum + t.weight_pct, 0);
    if (Math.round(total) !== 100) {
        return res.status(400).json({ error: `Task weights must sum to 100. Current sum: ${total}` });
    }

    try {
        await db.query('DELETE FROM task WHERE project_id = $1 AND ai_proposed = TRUE', [project_id]);

        const created = [];
        for (const task of tasks) {
            const r = await db.query(
                `INSERT INTO task (project_id, student_id, title, description, weight_pct, commit_freq, due_date, domain_tag, ai_proposed)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
                [project_id, task.student_id || null, task.title, task.description || null,
                    task.weight_pct, task.commit_freq || null, task.due_date || null, task.domain_tag || null, true]
            );
            created.push(r.rows[0]);
        }

        res.status(201).json(created);
    } catch (err) {
        next(err);
    }
});
//  PUT /api/tasks/:id
router.put('/:id', authenticate, validate(updateTaskSchema), async (req, res, next) => {
    const { title, description, weight_pct, status, commit_freq, due_date, student_id } = req.body;

    try {
        const task = await db.query('SELECT * FROM task WHERE id = $1', [req.params.id]);
        if (!task.rows.length) return res.status(404).json({ error: 'Task not found' });
        if (req.user.role === 'student') {
            if (task.rows[0].student_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });
            const allowed = ['in_progress', 'in_review'];
            if (!allowed.includes(status)) return res.status(403).json({ error: 'Students can only set status to in_progress or in_review' });

            const result = await db.query(
                'UPDATE task SET status = $1 WHERE id = $2 RETURNING *',
                [status, req.params.id]
            );
            return res.json(result.rows[0]);
        }

        const result = await db.query(
            `UPDATE task
             SET title       = COALESCE($1, title),
                 description = COALESCE($2, description),
                 weight_pct  = COALESCE($3, weight_pct),
                 status      = COALESCE($4, status),
                 commit_freq = COALESCE($5, commit_freq),
                 due_date    = COALESCE($6, due_date),
                 student_id  = COALESCE($7, student_id)
             WHERE id = $8 RETURNING *`,
            [title, description, weight_pct, status, commit_freq, due_date, student_id, req.params.id]
        );

        res.json(result.rows[0]);
    } catch (err) {
        next(err);
    }
});
//  DELETE /api/tasks/:id
router.delete('/:id', authenticate, authorize('admin', 'expert'), async (req, res, next) => {
    try {
        const result = await db.query('DELETE FROM task WHERE id = $1 RETURNING id', [req.params.id]);
        if (!result.rows.length) return res.status(404).json({ error: 'Task not found' });
        res.json({ message: 'Task deleted' });
    } catch (err) {
        next(err);
    }
});
//  HELPER: validate remaining weight budget
async function validateWeightBudget(project_id, new_weight) {
    const result = await db.query(
        'SELECT COALESCE(SUM(weight_pct), 0) AS total FROM task WHERE project_id = $1',
        [project_id]
    );
    const current = parseFloat(result.rows[0].total);
    if (current + new_weight > 100) {
        const err = new Error(`Weight budget exceeded. Available: ${100 - current}%, requested: ${new_weight}%`);
        err.status = 400;
        throw err;
    }
}

module.exports = router;