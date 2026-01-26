const app = {
    user: null,
    currentChannelId: null,
    ws: null,

    // UI Elements
    ui: {
        authScreen: document.getElementById('auth-screen'),
        chatScreen: document.getElementById('chat-screen'),
        loginForm: document.getElementById('login-form'),
        registerForm: document.getElementById('register-form'),
        authError: document.getElementById('auth-error'),
        channelsList: document.getElementById('channels-list'),
        activeChannelName: document.getElementById('active-channel-name'),
        messageFeed: document.getElementById('message-feed'),
        messageForm: document.getElementById('message-form'),
        messageInput: document.getElementById('message-input'),
        sendBtn: document.getElementById('send-btn'),
        currentUserDisplay: document.getElementById('current-user-display'),
        logoutBtn: document.getElementById('logout-btn')
    },

    init: async () => {
        app.bindEvents();
        await app.checkSession();
    },

    bindEvents: () => {
        app.ui.loginForm.addEventListener('submit', app.handleLogin);
        app.ui.registerForm.addEventListener('submit', app.handleRegister);
        app.ui.logoutBtn.addEventListener('click', app.handleLogout);
        app.ui.messageForm.addEventListener('submit', app.handleSendMessage);

        // Debounce Send Button/Input (User Requirement: Prevention of duplicate submissions)
        // Note: Disabling button on submit handles basic double-submit. 
        // We can also add a brief timeout if needed.
    },

    checkSession: async () => {
        try {
            const res = await fetch('/api/auth/me');
            if (res.ok) {
                app.user = await res.json();
                app.showChat();
            } else {
                app.showAuth();
            }
        } catch (e) {
            app.showAuth();
        }
    },

    showAuth: () => {
        app.ui.authScreen.classList.remove('hidden');
        app.ui.chatScreen.classList.add('hidden');
    },

    showChat: async () => {
        app.ui.authScreen.classList.add('hidden');
        app.ui.chatScreen.classList.remove('hidden');
        app.ui.currentUserDisplay.textContent = `Logged in as: ${app.user.username}`;

        await app.loadChannels();
        app.connectWebSocket();
    },

    // --- Authentication --- //

    handleLogin: async (e) => {
        e.preventDefault();
        const username = e.target.querySelector('#login-username').value;
        const password = e.target.querySelector('#login-password').value;

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            if (res.ok) {
                app.user = await res.json();
                app.ui.loginForm.reset();
                app.showChat();
                app.ui.authError.textContent = '';
            } else {
                const data = await res.json();
                app.ui.authError.textContent = data.error || 'Login failed';
            }
        } catch (err) {
            app.ui.authError.textContent = 'Network error';
        }
    },

    handleRegister: async (e) => {
        e.preventDefault();
        const username = e.target.querySelector('#reg-username').value;
        const password = e.target.querySelector('#reg-password').value;

        try {
            const res = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            if (res.ok) {
                alert('Registration successful! Please log in.');
                app.ui.registerForm.reset();
            } else {
                const data = await res.json();
                app.ui.authError.textContent = data.error || 'Registration failed';
            }
        } catch (err) {
            app.ui.authError.textContent = 'Network error';
        }
    },

    handleLogout: async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        app.user = null;
        if (app.ws) app.ws.close();
        window.location.reload();
    },

    // --- Channels & Messages --- //

    loadChannels: async () => {
        const res = await fetch('/api/channels');
        const channels = await res.json();

        app.ui.channelsList.innerHTML = '';
        channels.forEach(ch => {
            const div = document.createElement('div');
            div.className = 'channel-item';
            div.textContent = ch.name;
            div.dataset.id = ch.id;
            div.addEventListener('click', () => app.switchChannel(ch));
            app.ui.channelsList.appendChild(div);
        });
    },

    switchChannel: async (channel) => {
        app.currentChannelId = channel.id;
        app.ui.activeChannelName.textContent = `# ${channel.name}`;

        // Update UI active state
        document.querySelectorAll('.channel-item').forEach(el => {
            el.classList.toggle('active', el.dataset.id == channel.id);
        });

        // Enable Inputs
        app.ui.messageInput.disabled = false;
        app.ui.sendBtn.disabled = false;

        // Load History
        const res = await fetch(`/api/channels/${channel.id}/messages`);
        const messages = await res.json();

        app.ui.messageFeed.innerHTML = ''; // Clear feed
        // API returns reverse chronological (newest first).
        // We rendered feed with flex-direction: column-reverse, so we prepend items?
        // Wait, standard chat is bottom-up.
        // If API returns [newest, ..., oldest]
        // We want to render them such that newest is at bottom.
        // Actually simpler: API returns reversed [oldest, ..., newest] or we reverse it in FE.
        // Server sends `messages.reverse()` which implies [oldest, ..., newest].
        // So we appendChild in order.

        messages.forEach(msg => app.appendMessage(msg));

        // Join WS Room
        if (app.ws && app.ws.readyState === WebSocket.OPEN) {
            app.ws.send(JSON.stringify({
                type: 'join_channel',
                channelId: channel.id
            }));
        }
    },

    // --- WebSocket --- //

    connectWebSocket: () => {
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        app.ws = new WebSocket(`${protocol}://${window.location.host}`);

        app.ws.onopen = () => {
            console.log('Connected to WS');
            if (app.currentChannelId) {
                app.ws.send(JSON.stringify({
                    type: 'join_channel',
                    channelId: app.currentChannelId
                }));
            }
        };

        app.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'new_message') {
                if (data.channel_id === app.currentChannelId) {
                    app.appendMessage(data);
                }
            }
        };

        app.ws.onclose = () => {
            console.log('WS Disconnected. Reconnecting...');
            setTimeout(app.connectWebSocket, 3000);
        };
    },

    handleSendMessage: (e) => {
        e.preventDefault();
        const content = app.ui.messageInput.value.trim();
        if (!content || !app.currentChannelId) return;

        // Debounce/Disable
        app.ui.sendBtn.disabled = true;

        app.ws.send(JSON.stringify({
            type: 'message',
            content
        }));

        app.ui.messageInput.value = '';
        setTimeout(() => app.ui.sendBtn.disabled = false, 200); // Simple debounce re-enable
    },

    appendMessage: (msg) => {
        // SECURITY: Prevent XSS by building DOM nodes manually
        const msgDiv = document.createElement('div');
        msgDiv.className = 'message';

        const metaDiv = document.createElement('div');
        metaDiv.className = 'message-meta';

        const userSpan = document.createElement('span');
        userSpan.className = 'message-username';
        userSpan.textContent = msg.username; // Safe

        const timeSpan = document.createElement('span');
        timeSpan.textContent = new Date(msg.created_at).toLocaleTimeString();

        metaDiv.appendChild(userSpan);
        metaDiv.appendChild(timeSpan);

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.textContent = msg.content; // Safe XSS Prevention

        msgDiv.appendChild(metaDiv);
        msgDiv.appendChild(contentDiv);

        app.ui.messageFeed.appendChild(msgDiv);
        app.ui.messageFeed.scrollTop = app.ui.messageFeed.scrollHeight;
    }
};

app.init();
