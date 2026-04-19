const router = require('express').Router();
const db = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { validate, taskBreakdownSchema, teamMatchingSchema, approveAiTasksSchema, approveTeamSchema } = require('../validators');

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
//  HELPER: call Claude API
async function callClaude(systemPrompt, userMessage) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: CLAUDE_MODEL,
            max_tokens: 1000,
            system: systemPrompt,
            messages: [{ role: 'user', content: userMessage }],
        }),
    });

    if (!response.ok) {
        const err = await response.json();
        throw new Error(`Claude API error: ${err.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return data.content[0]?.text || '';
}
//  HELPER: parse and validate JSON from Claude response
function parseClaudeJSON(raw) {
    const clean = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
}
//  POST /api/ai/task-breakdown
router.post('/task-breakdown', authenticate, authorize('expert', 'admin'), validate(taskBreakdownSchema), async (req, res, next) => {
    const { project_id, scope_summary, team_size, deadline, domain } = req.body;

    const systemPrompt = `You are a project management assistant for a software agency.
Your job is to break down a project scope into specific tasks for a student development team.
Return ONLY a valid JSON array. No explanation, no markdown, no preamble.
Each task object must have exactly these fields:
- title (string, max 80 chars)
- description (string, 1-2 sentences)
- weight_pct (number, all weights must sum to exactly 100)
- commit_freq (string: "daily", "every_two_days", or "weekly")
- domain_tag (string: "web_dev", "mobile_dev", "ui_ux_design", "video_editing", or "other")
Rules:
- Weights must sum to exactly 100
- Generate between 3 and 8 tasks
- Tasks must be concrete and actionable
- Do not include any text outside the JSON array`;

    const userMessage = `Project scope: ${scope_summary}
Domain: ${domain}
Team size: ${team_size}
Deadline: ${deadline || 'Not specified'}
Generate a task breakdown.`;

    let aiOutput, parsed;

    try {
        aiOutput = await callClaude(systemPrompt, userMessage);
        parsed = parseClaudeJSON(aiOutput);

        if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('Invalid array');
        const totalWeight = parsed.reduce((sum, t) => sum + (t.weight_pct || 0), 0);
        if (Math.round(totalWeight) !== 100) throw new Error(`Weights sum to ${totalWeight}, not 100`);
        for (const task of parsed) {
            if (!task.title || !task.weight_pct) throw new Error('Missing required task fields');
        }
        await db.query(
            `INSERT INTO ai_log (project_id, agent_type, input_summary, output_valid)
             VALUES ($1, 'task_breakdown', $2, TRUE)`,
            [project_id, scope_summary.substring(0, 200)]
        );

        res.json({
            success: true,
            tasks: parsed,
            message: 'Review and edit the proposed tasks, then call /api/ai/task-breakdown/approve to save them.',
        });

    } catch (err) {
        await db.query(
            `INSERT INTO ai_log (project_id, agent_type, input_summary, output_valid)
             VALUES ($1, 'task_breakdown', $2, FALSE)`,
            [project_id, scope_summary?.substring(0, 200)]
        ).catch(() => { });

        if (err.message.includes('Claude API')) return next(err);

        return res.status(422).json({
            success: false,
            error: 'AI returned invalid output. Please try again or enter tasks manually.',
            raw: aiOutput || null,
        });
    }
});
//  POST /api/ai/task-breakdown/approve
router.post('/task-breakdown/approve', authenticate, authorize('expert', 'admin'), validate(approveAiTasksSchema), async (req, res, next) => {
    const { project_id } = req.query;
    if (!project_id) return res.status(400).json({ error: 'project_id is required' });

    const { tasks } = req.body;

    const total = tasks.reduce((sum, t) => sum + t.weight_pct, 0);
    if (Math.round(total) !== 100) {
        return res.status(400).json({ error: `Task weights must sum to 100. Current: ${total}` });
    }

    try {
        await db.query('DELETE FROM task WHERE project_id = $1 AND ai_proposed = TRUE', [project_id]);

        const created = [];
        for (const task of tasks) {
            const r = await db.query(
                `INSERT INTO task (project_id, student_id, title, description, weight_pct, commit_freq, due_date, domain_tag, ai_proposed)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE) RETURNING *`,
                [project_id, task.student_id || null, task.title, task.description || null,
                    task.weight_pct, task.commit_freq || null, task.due_date || null, task.domain_tag || null]
            );
            created.push(r.rows[0]);
        }
        await db.query(
            `UPDATE ai_log SET expert_approved = TRUE
             WHERE project_id = $1 AND agent_type = 'task_breakdown'
             ORDER BY called_at DESC LIMIT 1`,
            [project_id]
        );

        res.status(201).json({ message: 'Tasks saved successfully', tasks: created });
    } catch (err) { next(err); }
});
//  POST /api/ai/team-matching
router.post('/team-matching', authenticate, authorize('expert', 'admin'), validate(teamMatchingSchema), async (req, res, next) => {
    const { project_id } = req.body;

    try {
        const projectRes = await db.query(
            'SELECT title, service_type, team_size, description FROM project WHERE id = $1',
            [project_id]
        );
        if (!projectRes.rows.length) return res.status(404).json({ error: 'Project not found' });
        const project = projectRes.rows[0];
        const applicantsRes = await db.query(
            `SELECT a.id AS application_id, a.referral_priority, a.message,
                    u.id AS student_id, u.first_name, u.last_name, u.domain,
                    s.global_rating, s.consecutive_projects, s.university,
                    COUNT(DISTINCT cert.id) AS certificates_count
             FROM application a
             JOIN "user" u ON u.id = a.student_id
             JOIN student s ON s.user_id = a.student_id
             LEFT JOIN certificate cert ON cert.student_id = a.student_id
             WHERE a.project_id = $1 AND a.status = 'pending'
             GROUP BY a.id, a.referral_priority, a.message, u.id, u.first_name, u.last_name,
                      u.domain, s.global_rating, s.consecutive_projects, s.university`,
            [project_id]
        );

        if (!applicantsRes.rows.length) {
            return res.status(400).json({ error: 'No pending applicants for this project' });
        }

        const applicants = applicantsRes.rows;

        const systemPrompt = `You are a team selection assistant for a software agency.
Your job is to select the best team for a project from a list of applicants.
Return ONLY a valid JSON array of selected students. No explanation, no markdown, no preamble.
Each object must have:
- student_id (string, copy from input)
- rank (integer, 1 = best fit)
- reasoning (string, 1 sentence explaining why this student fits)
Rules:
- Select exactly the number of students specified in team_size
- Prioritize: referral_priority=true students, then higher global_rating, then fewer consecutive_projects
- domain must match the project service_type
- Do not include students with consecutive_projects >= 2 unless no other option
- Return only selected students, not all applicants`;

        const userMessage = `Project: ${project.title}
Service type: ${project.service_type}
Description: ${project.description}
Team size needed: ${project.team_size}

Applicants:
${JSON.stringify(applicants.map(a => ({
            student_id: a.student_id,
            name: `${a.first_name} ${a.last_name}`,
            domain: a.domain,
            global_rating: a.global_rating,
            consecutive_projects: a.consecutive_projects,
            referral_priority: a.referral_priority,
            certificates_count: a.certificates_count,
        })), null, 2)}

Select the best ${project.team_size} student(s) for this project.`;

        let aiOutput, parsed;

        try {
            aiOutput = await callClaude(systemPrompt, userMessage);
            parsed = parseClaudeJSON(aiOutput);

            if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('Invalid array');
            for (const s of parsed) {
                if (!s.student_id || !s.rank || !s.reasoning) throw new Error('Missing fields');
            }
            const logRes = await db.query(
                `INSERT INTO ai_log (project_id, agent_type, input_summary, output_valid)
                 VALUES ($1, 'team_matching', $2, TRUE) RETURNING id`,
                [project_id, `${applicants.length} applicants, team_size: ${project.team_size}`]
            );

            await db.query(
                `INSERT INTO team_suggestion (project_id, log_id, ai_output)
                 VALUES ($1, $2, $3)`,
                [project_id, logRes.rows[0].id, JSON.stringify(parsed)]
            );

            res.json({
                success: true,
                suggested_team: parsed,
                all_applicants: applicants,
                message: 'Review the suggestion, then call /api/ai/team-matching/approve to confirm the team.',
            });

        } catch (err) {
            await db.query(
                `INSERT INTO ai_log (project_id, agent_type, input_summary, output_valid)
                 VALUES ($1, 'team_matching', $2, FALSE)`,
                [project_id, `${applicants.length} applicants`]
            ).catch(() => { });

            if (err.message.includes('Claude API')) return next(err);

            return res.status(422).json({
                success: false,
                error: 'AI returned invalid output. Please select the team manually.',
                all_applicants: applicants,
            });
        }

    } catch (err) { next(err); }
});
//  POST /api/ai/team-matching/approve
router.post('/team-matching/approve', authenticate, authorize('expert', 'admin'), validate(approveTeamSchema), async (req, res, next) => {
    const { project_id } = req.query;
    if (!project_id) return res.status(400).json({ error: 'project_id is required' });

    const { selected_student_ids } = req.body;

    try {
        await db.query(
            `UPDATE application SET status = 'selected'
             WHERE project_id = $1 AND student_id = ANY($2::uuid[])`,
            [project_id, selected_student_ids]
        );
        await db.query(
            `UPDATE application SET status = 'rejected'
             WHERE project_id = $1 AND status = 'pending'`,
            [project_id]
        );
        let group = await db.query('SELECT id FROM project_group WHERE project_id = $1', [project_id]);
        if (!group.rows.length) {
            group = await db.query(
                'INSERT INTO project_group (project_id) VALUES ($1) RETURNING id',
                [project_id]
            );
        }
        const group_id = group.rows[0].id;
        for (const student_id of selected_student_ids) {
            await db.query(
                'INSERT INTO group_member (group_id, student_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
                [group_id, student_id]
            );
            await db.query(
                'UPDATE student SET consecutive_projects = consecutive_projects + 1 WHERE user_id = $1',
                [student_id]
            );
            await db.query(
                `INSERT INTO notification (user_id, type, message)
                 VALUES ($1, 'team_selected', 'You have been selected for a project team. Your workspace is now open.')`,
                [student_id]
            );
        }
        await db.query(
            `UPDATE project SET status = 'in_progress' WHERE id = $1`,
            [project_id]
        );
        await db.query(
            `UPDATE ai_log SET expert_approved = TRUE
             WHERE project_id = $1 AND agent_type = 'team_matching'
             ORDER BY called_at DESC LIMIT 1`,
            [project_id]
        );
        await db.query(
            `UPDATE team_suggestion SET expert_approved = TRUE
             WHERE project_id = $1
             ORDER BY created_at DESC LIMIT 1`,
            [project_id]
        );

        res.json({
            message: 'Team confirmed. Project workspace opened for all selected students.',
            group_id,
            selected_students: selected_student_ids,
        });

    } catch (err) { next(err); }
});
//  GET /api/ai/logs
router.get('/logs', authenticate, authorize('admin'), async (req, res, next) => {
    const { project_id, agent_type } = req.query;
    try {
        const conditions = [];
        const params = [];
        let i = 1;
        if (project_id) { conditions.push(`project_id = $${i++}`); params.push(project_id); }
        if (agent_type) { conditions.push(`agent_type = $${i++}`); params.push(agent_type); }
        const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

        const result = await db.query(
            `SELECT l.*, p.title AS project_title
             FROM ai_log l LEFT JOIN project p ON p.id = l.project_id
             ${where} ORDER BY l.called_at DESC LIMIT 100`,
            params
        );
        res.json(result.rows);
    } catch (err) { next(err); }
});

module.exports = router;