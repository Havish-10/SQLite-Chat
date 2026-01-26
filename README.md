# Secure Workplace Efficiency System

A real-time, secure workplace messaging application designed as a functional MVP. It prioritizes security-by-design principles, clean architecture, and module separation using a robust Node.js + SQLite stack.

## 🚀 Features

- **Real-time Messaging**: Instant message delivery using WebSockets (`ws`).
- **Channel System**: Organized communication through persistent channels.
- **Message Persistence**: Messages are stored in SQLite and the last 50 messages of a channel are loaded upon entry.
- **Secure Authentication**: User registration and login using `bcrypt` (12 salt rounds) and `JWT` (HttpOnly cookies).
- **Security-First Architecture**: 
    - SQL Injection prevention via Parameterized Queries.
    - XSS protection via DOM Text Node insertion.
    - Brute-force protection on login endpoints.
- **Responsive UI**: Clean, sidebar-layout interface built with Vanilla CSS/JS.

## 🛠️ Technology Stack

- **Runtime**: [Node.js](https://nodejs.org/)
- **Framework**: [Express.js](https://expressjs.com/)
- **Database**: [SQLite](https://www.sqlite.org/) (via `better-sqlite3` for performance and synchronous transaction support)
- **Real-time**: [ws](https://github.com/websockets/ws) (WebSocket implementation)
- **Frontend**: Vanilla JavaScript (ES6+), HTML5, CSS3
- **Security**: 
    - `helmet` (Secure HTTP Headers)
    - `express-rate-limit` (Rate Limiting)
    - `bcrypt` (Password Hashing)
    - `jsonwebtoken` (Session Management)

## ⚙️ How It Works

1. **Client-Server Architecture**: The app serves a static frontend (`public/`) which communicates with the backend via REST APIs (for Auth/Data) and WebSockets (for live updates).
2. **Data Integrity**: All database modifications use `better-sqlite3`'s transaction support to ensure atomic writes. WAL (Write-Ahead-Logging) mode is enabled for concurrency.
3. **Session Management**: Upon login, a JWT is generated and stored in a secure, `HttpOnly` cookie. This cookie is automatically sent with both HTTP requests and the WebSocket handshake, ensuring consistent authentication across protocols.
4. **Broadcast Logic**: The WebSocket server maintains a registry of connected clients. When a user sends a message, it is validated, saved to the database, and then broadcast only to other users currently viewing the same channel.

## 📡 API Documentation

### Authentication

#### `POST /api/auth/register`
Creates a new user account.
- **Body**: `{ "username": "...", "password": "..." }`
- **Response**: `201 Created`

#### `POST /api/auth/login`
Authenticates a user and sets the Session Cookie.
- **Body**: `{ "username": "...", "password": "..." }`
- **Response**: `200 OK` (with JSON User object)
- **Rate Limit**: Max 5 attempts per 15 minutes.

#### `POST /api/auth/logout`
Clears the session cookie.
- **Response**: `200 OK`

#### `GET /api/auth/me`
Returns the currently logged-in user profile.
- **Headers**: Requires `Cookie: token=...`
- **Response**: `200 OK` `{ "id": 1, "username": "..." }`

### Data Resources

#### `GET /api/channels`
Retrieves list of all available channels.
- **Response**: `200 OK` `[ { "id": 1, "name": "General" }, ... ]`

#### `GET /api/channels/:id/messages`
Retrieves the most recent 50 messages for a specific channel.
- **Response**: `200 OK` `[ { "id": 1, "content": "...", "username": "..." }, ... ]`

## 🛡️ Security Measures

This application implements protections against the **OWASP Top 10** vulnerabilities:

1. **Broken Access Control**: 
   - All API routes and WebSocket connections are gated behind the `authenticateToken` middleware.
   - Unauthorized requests receive `401 Unauthorized` or `403 Forbidden`.

2. **Cryptographic Failures**:
   - Passwords are **never** stored in plain text. We use `bcrypt` with 12 salt rounds.
   - JWTs are signed with a secret key and expire in 8 hours.

3. **Injection (SQLi)**:
   - All database queries use **Prepared Statements** (e.g., `db.prepare('...?').run(input)`).
   - This ensures user input is treated strictly as data, neutralizing SQL injection attacks.

4. **Security Misconfiguration**:
   - `helmet` middleware sets various HTTP headers (Content-Security-Policy, X-Frame-Options, etc.) to harden the server.
   - `express-rate-limit` protects the login route from brute-force dictionary attacks.

5. **Cross-Site Scripting (XSS)**:
   - The frontend explicitly uses `textContent` (via `document.createTextNode` or `.textContent`) to render user messages.
   - Usage of `.innerHTML` is strictly avoided for user content, preventing the execution of malicious scripts injected into chat messages.

6. **Identification and Authentication Failures**:
   - Session tokens are stored in `HttpOnly` cookies, making them inaccessible to client-side JavaScript (mitigating XSS token theft).
   - `SameSite=Strict` cookie policy prevents CSRF protections for the auth token.

## 🧪 Running the Project

1. **Install Dependencies**:
   ```bash
   npm install
   ```
2. **Start Server**:
   ```bash
   node server.js
   ```
3. **Access App**:
   Open [http://localhost:3000](http://localhost:3000)
