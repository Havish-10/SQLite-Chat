const Database = require('better-sqlite3');
const path = require('path');

// Initialize DB
const db = new Database('slack_mvp.db');
db.pragma('journal_mode = WAL');

// Initialize Schema
const init = () => {
    // Users Table
    db.prepare(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    // Channels Table
    db.prepare(`
        CREATE TABLE IF NOT EXISTS channels (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    // Messages Table with Attachment Support
    db.prepare(`
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            channel_id INTEGER NOT NULL,
            content TEXT,
            attachment_path TEXT,
            attachment_name TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id),
            FOREIGN KEY (channel_id) REFERENCES channels (id)
        )
    `).run();

    // Migration: Add columns if they don't exist (primitive migration for MVP)
    try {
        db.prepare('ALTER TABLE messages ADD COLUMN attachment_path TEXT').run();
        db.prepare('ALTER TABLE messages ADD COLUMN attachment_name TEXT').run();
    } catch (e) {
        // Ignore "duplicate column name" error
    }

    // Seed Channels
    const createChannel = db.prepare('INSERT OR IGNORE INTO channels (name) VALUES (?)');
    createChannel.run('General');
    createChannel.run('Random');
    createChannel.run('Project-X');
};

init();

// Prepared Statements (Security: Parameterized Queries)
const stmts = {
    // User Queries
    createUser: db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)'),
    getUserByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
    getUserById: db.prepare('SELECT id, username, created_at FROM users WHERE id = ?'),

    // Channel Queries
    getAllChannels: db.prepare('SELECT * FROM channels ORDER BY name ASC'),
    getChannelById: db.prepare('SELECT * FROM channels WHERE id = ?'),

    // Message Queries
    // Transaction safe message creation
    createMessage: db.transaction((userId, channelId, content, attachmentPath, attachmentName) => {
        const insert = db.prepare('INSERT INTO messages (user_id, channel_id, content, attachment_path, attachment_name) VALUES (?, ?, ?, ?, ?)');
        return insert.run(userId, channelId, content || '', attachmentPath || null, attachmentName || null);
    }),

    getMessagesByChannel: db.prepare(`
        SELECT m.id, m.content, m.attachment_path, m.attachment_name, m.created_at, u.username, m.user_id
        FROM messages m
        JOIN users u ON m.user_id = u.id
        WHERE m.channel_id = ?
        ORDER BY m.created_at DESC
        LIMIT 50
    `)
};

module.exports = {
    db,
    ...stmts
};
