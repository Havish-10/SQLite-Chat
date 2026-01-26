# Security Verification Checklist (Manual Testing)

## 1. SQL Injection (SQLi) Defense
**Goal**: Verify that login inputs cannot manipulate the SQL query.
- **Action**: Go to the Login screen.
- **Input**:
  - Username: `' OR 1=1 --`
  - Password: `password`
- **Expected Result**: "Invalid credentials" or login failure. The application SHOULD NOT log you in as the first user (admin/general).
- **Mechanism**: We use `better-sqlite3` prepared statements (`db.prepare(...)`), which treats inputs as data, not executable code.

## 2. Cross-Site Scripting (XSS) Defense
**Goal**: Verify that message content is treated as text, not HTML/JS.
- **Action**: Log in and select a channel.
- **Input**: Send the following message:
  ```html
  <script>alert("XSS")</script> <b>Bold</b>
  ```
- **Expected Result**: The message appears in the chat feed exactly as written: `<script>alert("XSS")</script> <b>Bold</b>`. No alert popup should appear, and "Bold" should not be bolded.
- **Mechanism**: The frontend uses `element.textContent = msg.content` instead of `element.innerHTML`, preventing browser execution of tags.

## 3. Broken Access Control Defense
**Goal**: Verify that API endpoints are protected against unauthenticated access.
- **Action**: Open a terminal and run:
  ```bash
  curl -v http://localhost:3000/api/channels
  ```
- **Expected Result**: HTTP `401 Unauthorized` or `403 Forbidden`.
- **Mechanism**: The `authenticateToken` middleware verifies the presence and validity of the HttpOnly `token` cookie before allowing access to the route.
