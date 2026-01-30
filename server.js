const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const db = require('./database');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const JWT_SECRET = 'super-secret-key-change-in-production'; // In real app, from process.env

// === Middleware & Security ===
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            "default-src": ["'self'"],
            "script-src": ["'self'"],
            "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            "font-src": ["'self'", "https://fonts.gstatic.com"],
            "img-src": ["'self'", "data:", "blob:"],
            "connect-src": ["'self'", "ws:", "wss:"]
        }
    }
}));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Serve Uploads - In production, use S3/Cloud Storage or protect this route
app.use('/uploads', express.static(path.join(__dirname, 'uploaded_files')));

// Rate Limiting for Login
const loginLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 20, // Limit each IP to 20 requests per windowMs
    message: { error: 'Too many login attempts, please try again later.' } // return JSON error
});

// Multer Configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploaded_files/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname)); // Secure filename
    }
});
const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Authentication Middleware
const authenticateToken = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// === API Routes ===

// Auth: Register
app.post('/api/auth/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    try {
        const hash = await bcrypt.hash(password, 12);
        try {
            db.createUser.run(username, hash);
            res.status(201).json({ message: 'User created' });
        } catch (e) {
            if (e.message.includes('UNIQUE')) {
                return res.status(409).json({ error: 'Username already exists' });
            }
            throw e;
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Auth: Login
app.post('/api/auth/login', loginLimiter, async (req, res) => {
    const { username, password } = req.body;
    const user = db.getUserByUsername.get(username);

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '8h' });

    // Secure, HttpOnly, SameSite=Strict Cookie
    res.cookie('token', token, {
        httpOnly: true,
        secure: false, // Set to true in production (HTTPS)
        sameSite: 'strict',
        maxAge: 8 * 60 * 60 * 1000 // 8 hours
    });

    res.json({ id: user.id, username: user.username });
});

// Auth: Logout
app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('token');
    res.sendStatus(200);
});

// Auth: Me
app.get('/api/auth/me', authenticateToken, (req, res) => {
    res.json(req.user);
});

// Channels: List
app.get('/api/channels', authenticateToken, (req, res) => {
    const channels = db.getAllChannels.all();
    res.json(channels);
});

// Messages: History
app.get('/api/channels/:id/messages', authenticateToken, (req, res) => {
    const messages = db.getMessagesByChannel.all(req.params.id);
    res.json(messages.reverse());
});

// Upload Endpoint
app.post('/api/upload', authenticateToken, upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    // Return path for WS message
    res.json({
        path: `/uploads/${req.file.filename}`,
        originalName: req.file.originalname
    });
});

// === WebSocket Handling ===

// Helper to parse cookie from handshake
function parseCookies(request) {
    const list = {};
    const rc = request.headers.cookie;

    rc && rc.split(';').forEach(function (cookie) {
        const parts = cookie.split('=');
        list[parts.shift().trim()] = decodeURI(parts.join('='));
    });

    return list;
}

// Global Online Users Set
// Using a Map to track unique users by ID: userId -> { username, count }
// count allows multiple tabs for same user
const onlineUsers = new Map();

function broadcastOnlineUsers() {
    const userList = Array.from(onlineUsers.values()).map(u => ({
        id: u.id,
        username: u.username
    }));

    const payload = JSON.stringify({
        type: 'online_users',
        users: userList
    });

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}

wss.on('connection', (ws, req) => {
    const cookies = parseCookies(req);
    const token = cookies.token;

    if (!token) {
        ws.close();
        return;
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            ws.close();
            return;
        }
        ws.user = user;

        // Add to online users
        if (!onlineUsers.has(user.id)) {
            onlineUsers.set(user.id, { id: user.id, username: user.username, count: 0 });
        }
        onlineUsers.get(user.id).count++;

        broadcastOnlineUsers();
    });

    ws.currentChannelId = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'join_channel') {
                ws.currentChannelId = data.channelId;
            } else if (data.type === 'message') {
                if (!ws.currentChannelId) return;

                // Persist to DB
                // Using transaction safe wrapper from db module
                const result = db.createMessage(
                    ws.user.id,
                    ws.currentChannelId,
                    data.content,
                    data.attachment ? data.attachment.path : null,
                    data.attachment ? data.attachment.name : null
                );

                // Broadcast to all clients in this channel
                const payload = JSON.stringify({
                    type: 'new_message',
                    id: result.lastInsertRowid,
                    content: data.content,
                    attachment: data.attachment,
                    user_id: ws.user.id,
                    username: ws.user.username,
                    channel_id: ws.currentChannelId,
                    created_at: new Date().toISOString()
                });

                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN && client.currentChannelId === ws.currentChannelId) {
                        client.send(payload);
                    }
                });
            } else if (data.type === 'typing') {
                if (!ws.currentChannelId) return;

                // Broadcast typing status to others in channel
                const payload = JSON.stringify({
                    type: 'user_typing',
                    username: ws.user.username,
                    channel_id: ws.currentChannelId
                });

                wss.clients.forEach(client => {
                    if (client !== ws &&
                        client.readyState === WebSocket.OPEN &&
                        client.currentChannelId === ws.currentChannelId) {
                        client.send(payload);
                    }
                });
            }
        } catch (e) {
            console.error('WS Error', e);
        }
    });

    ws.on('close', () => {
        if (ws.user) {
            const entry = onlineUsers.get(ws.user.id);
            if (entry) {
                entry.count--;
                if (entry.count <= 0) {
                    onlineUsers.delete(ws.user.id);
                }
                broadcastOnlineUsers();
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
