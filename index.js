const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const jwt = require('jsonwebtoken');
const db = require('./config/db');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

const ORIGINS = [
    'http://localhost:5173',
    'http://localhost:3000',
    'http://localhost:4173',
    'https://orbite-platform.netlify.app'

];

// ── Socket.IO ─────────────────────────────────────────────────────────────────
const io = new Server(server, {
    cors: { origin: ORIGINS, methods: ['GET', 'POST'], credentials: true },
});

// ── Express middleware ────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: ORIGINS, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// ── REST routes ───────────────────────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/applications', require('./routes/applications'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/interviews', require('./routes/interviews'));
app.use('/api/ratings', require('./routes/ratings'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/certificates', require('./routes/certificates'));
app.use('/api/referrals', require('./routes/referrals'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/messages', require('./routes/chat').router);

app.get('/api/health', (_req, res) =>
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
);
app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));
app.use((err, _req, res, _next) => {
    console.error(err.stack);
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ── Socket.IO JWT middleware ──────────────────────────────────────────────────
io.use((socket, next) => {
    const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace('Bearer ', '');
    if (!token) return next(new Error('Authentication required'));
    try {
        socket.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch {
        next(new Error('Invalid token'));
    }
});

// ── Online user registry  userId → Set<socketId> ─────────────────────────────
const online = new Map();
const addOnline = (uid, sid) => { if (!online.has(uid)) online.set(uid, new Set()); online.get(uid).add(sid); };
const removeOnline = (uid, sid) => { online.get(uid)?.delete(sid); if (!online.get(uid)?.size) online.delete(uid); };
const isOnline = (uid) => online.has(uid);

// ── Helpers (imported from messages route) ────────────────────────────────────
const { helpers } = require('./routes/chat');

// ── Socket.IO connection ──────────────────────────────────────────────────────
io.on('connection', (socket) => {
    const userId = socket.user.id;
    addOnline(userId, socket.id);
    io.emit('user:online', { userId, online: true });

    // ─── conversation:start ───────────────────────────────────────────────────
    // { otherUserId, projectId? }  →  conversation:ready { conversationId }
    socket.on('conversation:start', async ({ otherUserId, projectId }) => {
        try {
            const conv = await helpers.getOrCreateConversation(userId, otherUserId, projectId);
            socket.emit('conversation:ready', { conversationId: conv.id });
            socket.join(conv.id);
        } catch (e) { console.error('conversation:start', e); }
    });

    // ─── conversation:join ────────────────────────────────────────────────────
    // { conversationId }
    socket.on('conversation:join', async ({ conversationId }) => {
        try {
            const { rows } = await db.query(
                `SELECT id FROM conversation WHERE id=$1 AND (user_a=$2 OR user_b=$2)`,
                [conversationId, userId]
            );
            if (!rows.length) return socket.emit('error', { message: 'Access denied' });
            socket.join(conversationId);
            // mark read
            await db.query(
                `UPDATE message SET read=TRUE WHERE conversation_id=$1 AND sender_id!=$2 AND read=FALSE`,
                [conversationId, userId]
            );
        } catch (e) { console.error('conversation:join', e); }
    });

    // ─── conversation:leave ───────────────────────────────────────────────────
    socket.on('conversation:leave', ({ conversationId }) => socket.leave(conversationId));

    // ─── message:send ─────────────────────────────────────────────────────────
    // { conversationId, content }  →  broadcast message:new to room
    socket.on('message:send', async ({ conversationId, content }) => {
        if (!content?.trim()) return;
        try {
            const conv = await db.query(
                `SELECT * FROM conversation WHERE id=$1 AND (user_a=$2 OR user_b=$2)`,
                [conversationId, userId]
            );
            if (!conv.rows.length) return socket.emit('error', { message: 'Access denied' });

            const msg = await helpers.saveMessage(conversationId, userId, content);
            io.to(conversationId).emit('message:new', msg);

            // notify other user if not in room
            const otherId = conv.rows[0].user_a === userId
                ? conv.rows[0].user_b : conv.rows[0].user_a;

            const inRoom = [...(online.get(otherId) || [])].some(sid =>
                io.sockets.sockets.get(sid)?.rooms?.has(conversationId)
            );

            if (!inRoom) {
                await db.query(
                    `INSERT INTO notification (user_id,type,message) VALUES($1,'new_message',$2)`,
                    [otherId, `New message from ${msg.sender_name}`]
                );
                if (isOnline(otherId)) {
                    online.get(otherId).forEach(sid =>
                        io.to(sid).emit('notification:new', {
                            type: 'new_message',
                            message: `New message from ${msg.sender_name}`,
                            conversationId,
                        })
                    );
                }
            }
        } catch (e) {
            console.error('message:send', e);
            socket.emit('error', { message: 'Failed to send' });
        }
    });

    // ─── typing ───────────────────────────────────────────────────────────────
    socket.on('typing:start', ({ conversationId }) =>
        socket.to(conversationId).emit('typing:start', { userId, conversationId })
    );
    socket.on('typing:stop', ({ conversationId }) =>
        socket.to(conversationId).emit('typing:stop', { userId, conversationId })
    );

    // ─── disconnect ───────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
        removeOnline(userId, socket.id);
        if (!isOnline(userId)) io.emit('user:online', { userId, online: false });
    });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
server.listen(PORT, () =>
    console.log(`✅ TalentBridge API + Socket.IO → http://localhost:${PORT}`)
);