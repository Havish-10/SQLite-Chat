const app = {
    user: null,
    currentChannelId: null,
    ws: null,
    pendingUpload: null, // Store selected file info

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
        logoutBtn: document.getElementById('logout-btn'),
        // Mobile UI
        menuBtn: document.getElementById('menu-btn'),
        sidebar: document.querySelector('.sidebar'),
        sidebarOverlay: document.getElementById('sidebar-overlay'),
        // File Upload UI
        fileInput: document.getElementById('file-upload'),
        uploadPreview: document.getElementById('upload-preview'),
        uploadFilename: document.getElementById('upload-filename'),
        clearUploadBtn: document.getElementById('clear-upload')
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

        // Mobile Menu Events
        if (app.ui.menuBtn) {
            app.ui.menuBtn.addEventListener('click', app.toggleSidebar);
            app.ui.sidebarOverlay.addEventListener('click', app.toggleSidebar);
        }

        // File Upload Events
        app.ui.fileInput.addEventListener('change', app.handleFileSelect);
        app.ui.clearUploadBtn.addEventListener('click', app.clearFileSelection);
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

    toggleSidebar: () => {
        app.ui.sidebar.classList.toggle('open');
        app.ui.sidebarOverlay.classList.toggle('active');
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
            div.addEventListener('click', () => {
                app.switchChannel(ch);
                // Auto close on mobile
                if (window.innerWidth <= 768) {
                    app.toggleSidebar();
                }
            });
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

        // Clear previous channel's upload data
        app.clearFileSelection();

        // Load History
        const res = await fetch(`/api/channels/${channel.id}/messages`);
        const messages = await res.json();

        app.ui.messageFeed.innerHTML = '';
        messages.forEach(msg => app.appendMessage(msg));

        // Join WS Room
        if (app.ws && app.ws.readyState === WebSocket.OPEN) {
            app.ws.send(JSON.stringify({
                type: 'join_channel',
                channelId: channel.id
            }));
        }

        // Scroll to bottom
        app.scrollToBottom();
    },

    scrollToBottom: () => {
        app.ui.messageFeed.scrollTop = app.ui.messageFeed.scrollHeight;
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
                    app.scrollToBottom();
                }
            }
        };

        app.ws.onclose = () => {
            console.log('WS Disconnected. Reconnecting...');
            setTimeout(app.connectWebSocket, 3000);
        };
    },

    // --- File Upload Logic --- //

    handleFileSelect: (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Basic Size Check (5MB) - Frontend
        if (file.size > 5 * 1024 * 1024) {
            alert('File too large (Max 5MB)');
            app.clearFileSelection();
            return;
        }

        app.pendingUpload = file;
        app.ui.uploadFilename.textContent = file.name;
        app.ui.uploadPreview.classList.remove('hidden');
    },

    clearFileSelection: () => {
        app.pendingUpload = null;
        app.ui.fileInput.value = ''; // Reset input
        app.ui.uploadPreview.classList.add('hidden');
        app.ui.uploadFilename.textContent = '';
    },

    handleSendMessage: async (e) => {
        e.preventDefault();
        const content = app.ui.messageInput.value.trim();

        if ((!content && !app.pendingUpload) || !app.currentChannelId) return;

        // Disable UI
        app.ui.sendBtn.disabled = true;

        let attachment = null;

        // Upload File if exists
        if (app.pendingUpload) {
            const formData = new FormData();
            formData.append('file', app.pendingUpload);

            try {
                const res = await fetch('/api/upload', {
                    method: 'POST',
                    body: formData
                });

                if (res.ok) {
                    const data = await res.json();
                    attachment = {
                        path: data.path,
                        name: data.originalName
                    };
                } else {
                    alert('Upload failed');
                    app.ui.sendBtn.disabled = false;
                    return;
                }
            } catch (err) {
                alert('Upload error');
                app.ui.sendBtn.disabled = false;
                return;
            }
        }

        app.ws.send(JSON.stringify({
            type: 'message',
            content,
            attachment
        }));

        app.ui.messageInput.value = '';
        app.clearFileSelection();
        setTimeout(() => app.ui.sendBtn.disabled = false, 200);
    },

    appendMessage: (msg) => {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'message';

        const metaDiv = document.createElement('div');
        metaDiv.className = 'message-meta';

        const userSpan = document.createElement('span');
        userSpan.className = 'message-username';
        userSpan.textContent = msg.username;

        const timeSpan = document.createElement('span');
        timeSpan.textContent = new Date(msg.created_at).toLocaleTimeString();

        metaDiv.appendChild(userSpan);
        metaDiv.appendChild(timeSpan);

        msgDiv.appendChild(metaDiv);

        // Content
        if (msg.content) {
            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';
            contentDiv.textContent = msg.content;
            msgDiv.appendChild(contentDiv);
        }

        // Attachment
        if (msg.attachment_path || (msg.attachment && msg.attachment.path)) {
            const path = msg.attachment_path || msg.attachment.path;
            const name = msg.attachment_name || msg.attachment.name;

            const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(name);

            if (isImage) {
                const imgContainer = document.createElement('div');
                imgContainer.className = 'attachment-preview';
                const img = document.createElement('img');
                img.src = path;
                img.alt = 'Attachment';
                img.loading = 'lazy';
                imgContainer.appendChild(img);
                msgDiv.appendChild(imgContainer);
            } else {
                const fileLink = document.createElement('a');
                fileLink.href = path;
                fileLink.className = 'attachment-link';
                fileLink.target = '_blank';
                fileLink.textContent = `📎 ${name}`;
                msgDiv.appendChild(fileLink);
            }
        }

        app.ui.messageFeed.appendChild(msgDiv);
    }
};

app.init();
