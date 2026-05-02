const router = require('express').Router();
const db = require('../config/db');
const { authenticate } = require('../middleware/auth');

// ─────────────────────────────────────────────────────────────────────────────
// SHARED DB HELPERS (also imported by socket handler in index.js)
// ─────────────────────────────────────────────────────────────────────────────

async function getOrCreateConversation(userIdA, userIdB, projectId = null) {
    const [ua, ub] = [userIdA, userIdB].sort();
    const result = await db.query(
        `INSERT INTO conversation (user_a, user_b, project_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_a, user_b, project_id)
         DO UPDATE SET project_id = EXCLUDED.project_id
         RETURNING *`,
        [ua, ub, projectId]
    );
    return result.rows[0];
}

async function saveMessage(conversationId, senderId, content) {
    const ins = await db.query(
        `INSERT INTO message (conversation_id, sender_id, content)
         VALUES ($1, $2, $3) RETURNING *`,
        [conversationId, senderId, content.trim()]
    );
    const enriched = await db.query(
        `SELECT m.*,
                u.first_name || ' ' || u.last_name AS sender_name,
                u.role AS sender_role
         FROM message m
         JOIN "user" u ON u.id = m.sender_id
         WHERE m.id = $1`,
        [ins.rows[0].id]
    );
    return enriched.rows[0];
}

module.exports.helpers = { getOrCreateConversation, saveMessage };

// ─────────────────────────────────────────────────────────────────────────────
// REST ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/messages/conversations
router.get('/conversations', authenticate, async (req, res, next) => {
    try {
        const { rows } = await db.query(
            `SELECT
                c.id,
                c.project_id,
                p.title                                    AS project_title,
                CASE WHEN c.user_a = $1 THEN c.user_b
                     ELSE c.user_a END                     AS other_user_id,
                ou.first_name || ' ' || ou.last_name       AS other_user_name,
                ou.role                                    AS other_user_role,
                lm.content                                 AS last_message,
                lm.created_at                              AS last_message_at,
                COUNT(um.id)
                    FILTER (WHERE um.sender_id != $1 AND um.read = FALSE)
                                                           AS unread
             FROM conversation c
             JOIN "user" ou
                ON ou.id = CASE WHEN c.user_a = $1 THEN c.user_b ELSE c.user_a END
             LEFT JOIN project p ON p.id = c.project_id
             LEFT JOIN LATERAL (
                 SELECT content, created_at FROM message
                 WHERE  conversation_id = c.id
                 ORDER  BY created_at DESC LIMIT 1
             ) lm ON TRUE
             LEFT JOIN message um ON um.conversation_id = c.id
             WHERE c.user_a = $1 OR c.user_b = $1
             GROUP BY c.id, c.project_id, p.title,
                      ou.id, ou.first_name, ou.last_name, ou.role,
                      lm.content, lm.created_at
             ORDER BY lm.created_at DESC NULLS LAST`,
            [req.user.id]
        );
        res.json(rows);
    } catch (err) { next(err); }
});

// GET /api/messages/conversations/:id  (history, paginated)
router.get('/conversations/:id', authenticate, async (req, res, next) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const before = req.query.before;
    try {
        const conv = await db.query(
            `SELECT id FROM conversation
             WHERE id = $1 AND (user_a = $2 OR user_b = $2)`,
            [req.params.id, req.user.id]
        );
        if (!conv.rows.length) return res.status(403).json({ error: 'Access denied' });

        const params = [req.params.id, limit];
        const cursor = before ? `AND m.created_at < $3` : '';
        if (before) params.push(before);

        const { rows } = await db.query(
            `SELECT m.id, m.conversation_id, m.sender_id, m.content,
                    m.read, m.created_at,
                    u.first_name || ' ' || u.last_name AS sender_name,
                    u.role AS sender_role
             FROM   message m
             JOIN   "user" u ON u.id = m.sender_id
             WHERE  m.conversation_id = $1 ${cursor}
             ORDER  BY m.created_at DESC LIMIT $2`,
            params
        );

        // Mark as read
        await db.query(
            `UPDATE message SET read = TRUE
             WHERE conversation_id = $1 AND sender_id != $2 AND read = FALSE`,
            [req.params.id, req.user.id]
        );

        res.json(rows.reverse());
    } catch (err) { next(err); }
});

// POST /api/messages/conversations  (get-or-create)
router.post('/conversations', authenticate, async (req, res, next) => {
    const { other_user_id, project_id } = req.body;
    if (!other_user_id) return res.status(400).json({ error: 'other_user_id required' });
    try {
        const conv = await getOrCreateConversation(req.user.id, other_user_id, project_id);
        res.status(201).json(conv);
    } catch (err) { next(err); }
});

// POST /api/messages/conversations/:id  (REST send — fallback)
router.post('/conversations/:id', authenticate, async (req, res, next) => {
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'content required' });
    try {
        const conv = await db.query(
            `SELECT * FROM conversation WHERE id = $1 AND (user_a = $2 OR user_b = $2)`,
            [req.params.id, req.user.id]
        );
        if (!conv.rows.length) return res.status(403).json({ error: 'Access denied' });

        const msg = await saveMessage(req.params.id, req.user.id, content);

        const otherId = conv.rows[0].user_a === req.user.id
            ? conv.rows[0].user_b : conv.rows[0].user_a;
        await db.query(
            `INSERT INTO notification (user_id, type, message) VALUES ($1, 'new_message', $2)`,
            [otherId, `New message from ${req.user.first_name}`]
        );

        res.status(201).json(msg);
    } catch (err) { next(err); }
});

// PATCH /api/messages/conversations/:id/read
router.patch('/conversations/:id/read', authenticate, async (req, res, next) => {
    try {
        await db.query(
            `UPDATE message SET read = TRUE
             WHERE conversation_id = $1 AND sender_id != $2 AND read = FALSE`,
            [req.params.id, req.user.id]
        );
        res.json({ ok: true });
    } catch (err) { next(err); }
});

module.exports.router = router;