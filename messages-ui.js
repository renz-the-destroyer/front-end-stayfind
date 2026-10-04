// messages-ui.js — load AFTER home.js. Later function declarations replace the earlier
// ones of the same name, so home.js stays untouched. Uses home.js globals:
// currentUser, API_BASE, activeConversationId, messagePollInterval, escapeHtml,
// formatMessageTime, stopThreadPolling, refreshUnreadBadge, loadThreadMessages.

(function injectMessagesChrome() {
    const header = document.querySelector('#messagesModal .messages-header');
    const textEl = document.querySelector('#messagesModal .messages-header-text');
    if (header && textEl && !document.getElementById('messagesHeaderAvatar')) {
        const av = document.createElement('div');
        av.id = 'messagesHeaderAvatar';
        av.className = 'messages-header-avatar';
        av.style.display = 'none';
        header.insertBefore(av, textEl);
    }
    const thread = document.getElementById('conversationThreadView');
    const list = document.getElementById('threadMessagesList');
    if (thread && list && !document.getElementById('threadContextBar')) {
        const bar = document.createElement('div');
        bar.id = 'threadContextBar';
        bar.className = 'thread-context-bar';
        bar.style.display = 'none';
        thread.insertBefore(bar, list);
    }
})();

function avatarStyle(name) {
    let h = 0;
    for (const c of (name || '?')) h = (h * 31 + c.charCodeAt(0)) % 360;
    return `--av1:hsl(${h},70%,55%);--av2:hsl(${h},75%,36%)`;
}

function formatBubbleTime(iso) {
    return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatDayLabel(iso) {
    const d = new Date(iso), t = new Date(), y = new Date();
    y.setDate(t.getDate() - 1);
    if (d.toDateString() === t.toDateString()) return 'Today';
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === t.getFullYear() ? undefined : 'numeric' });
}

function showConversationsListView() {
    stopThreadPolling();
    activeConversationId = null;

    const listView = document.getElementById('conversationsListView');
    const threadView = document.getElementById('conversationThreadView');
    const backBtn = document.getElementById('messagesBackBtn');
    const title = document.getElementById('messagesHeaderTitle');
    const subtitle = document.getElementById('messagesHeaderSubtitle');
    const hdrAvatar = document.getElementById('messagesHeaderAvatar');
    const ctxBar = document.getElementById('threadContextBar');

    if (listView) listView.style.display = 'block';
    if (threadView) threadView.style.display = 'none';
    if (backBtn) backBtn.style.display = 'none';
    if (title) title.innerText = 'Messages';
    if (subtitle) subtitle.style.display = 'none';
    if (hdrAvatar) hdrAvatar.style.display = 'none';
    if (ctxBar) ctxBar.style.display = 'none';

    loadConversationsList();
    refreshUnreadBadge();
}

async function loadConversationsList() {
    const listView = document.getElementById('conversationsListView');
    if (!listView || !currentUser) return;

    listView.innerHTML = `<p style="text-align:center; color:#94a3b8; font-size:13px; padding:30px 0;">Loading conversations...</p>`;

    try {
        const res = await fetch(`${API_BASE}/conversations/${currentUser.id}`);
        const conversations = await res.json();

        if (!Array.isArray(conversations) || conversations.length === 0) {
            listView.innerHTML = `
                <div class="empty-state" style="padding:50px 20px;">
                    <div class="empty-state-icon"><i class="fas fa-envelope-open-text"></i></div>
                    <h3>No messages yet</h3>
                    <p>${currentUser.role === 'landlord' ? 'Messages from tenants will show up here.' : 'Tap "Message Landlord" on any listing to start a conversation.'}</p>
                </div>`;
            return;
        }

        listView.innerHTML = conversations.map(conv => {
            const name = conv.other_user_name || 'Unknown';
            const initial = name.trim().charAt(0).toUpperCase() || '?';
            const preview = conv.last_message ? escapeHtml(conv.last_message) : 'Say hello!';
            const unread = Number(conv.unread_count) || 0;
            return `
                <div class="conversation-item${unread > 0 ? ' is-unread' : ''}" data-conv-id="${conv.id}">
                    <div class="conversation-avatar" style="${avatarStyle(name)}">${initial}</div>
                    <div class="conversation-body">
                        <div class="conversation-top-row">
                            <span class="conversation-name">${escapeHtml(name)}</span>
                            <span class="conversation-time">${formatMessageTime(conv.last_message_at)}</span>
                        </div>
                        <div class="conversation-listing"><i class="fas fa-house"></i> ${escapeHtml(conv.listing_title || 'Listing')}</div>
                        <div class="conversation-preview">${preview}</div>
                    </div>
                    ${unread > 0 ? `<span class="conversation-unread-dot">${unread > 9 ? '9+' : unread}</span>` : ''}
                </div>`;
        }).join('');

        listView.querySelectorAll('.conversation-item').forEach(el => {
            el.onclick = () => {
                const conv = conversations.find(c => String(c.id) === el.getAttribute('data-conv-id'));
                if (conv) openConversationThread(conv);
            };
        });
    } catch (err) {
        console.error("Load conversations error:", err);
        listView.innerHTML = `<p style="text-align:center; color:#ff5252; font-size:13px; padding:30px 0;">Couldn't load your messages.</p>`;
    }
}

function openConversationThread(conv) {
    stopThreadPolling();
    activeConversationId = conv.id;

    const listView = document.getElementById('conversationsListView');
    const threadView = document.getElementById('conversationThreadView');
    const backBtn = document.getElementById('messagesBackBtn');
    const title = document.getElementById('messagesHeaderTitle');
    const subtitle = document.getElementById('messagesHeaderSubtitle');
    const hdrAvatar = document.getElementById('messagesHeaderAvatar');
    const ctxBar = document.getElementById('threadContextBar');
    const inputEl = document.getElementById('threadMessageInput');
    const sendBtn = document.getElementById('threadSendBtn');

    if (listView) listView.style.display = 'none';
    if (threadView) threadView.style.display = 'flex';
    if (backBtn) backBtn.style.display = 'flex';
    if (title) title.innerText = conv.other_user_name || 'Conversation';
    if (subtitle) subtitle.style.display = 'none'; // listing now lives in the context bar
    if (hdrAvatar) {
        hdrAvatar.innerText = (conv.other_user_name || '?').trim().charAt(0).toUpperCase() || '?';
        hdrAvatar.style.display = 'flex';
    }
    if (ctxBar) {
        ctxBar.innerHTML = `<i class="fas fa-house"></i><span>About</span><strong>${escapeHtml(conv.listing_title || 'Listing')}</strong>`;
        ctxBar.style.display = conv.listing_title ? 'flex' : 'none';
    }
    if (inputEl) inputEl.value = '';
    if (inputEl && sendBtn) {
        sendBtn.disabled = true;
        inputEl.oninput = () => { sendBtn.disabled = !inputEl.value.trim(); };
    }

    loadThreadMessages();
    messagePollInterval = setInterval(loadThreadMessages, 5000);
}

async function loadThreadMessages() {
    if (!activeConversationId || !currentUser) return;
    const listEl = document.getElementById('threadMessagesList');
    if (!listEl) return;

    try {
        const res = await fetch(`${API_BASE}/messages/${activeConversationId}?user_id=${currentUser.id}`);
        const messages = await res.json();
        if (!Array.isArray(messages)) return;

        const wasNearBottom = (listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight) < 80;

        if (messages.length === 0) {
            listEl.innerHTML = `<div class="thread-empty"><i class="fas fa-comments" style="font-size:26px; display:block; margin-bottom:8px; color:#cbd5e1;"></i>No messages yet. Say hello!</div>`;
            return;
        }

        let html = '', prev = null;
        messages.forEach((msg, i) => {
            const isMine = String(msg.sender_id) === String(currentUser.id);
            const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(msg.created_at).toDateString();
            if (newDay) html += `<div class="msg-day-sep">${formatDayLabel(msg.created_at)}</div>`;
            const grouped = prev && !newDay && prev.sender_id === msg.sender_id
                && (new Date(msg.created_at) - new Date(prev.created_at)) < 5 * 60000;
            html += `
                <div class="msg-bubble ${isMine ? 'msg-bubble-sent' : 'msg-bubble-received'}${grouped ? ' msg-grouped' : ''}">
                    ${escapeHtml(msg.message)}
                    <span class="msg-bubble-time">${formatBubbleTime(msg.created_at)}</span>
                </div>`;
            if (i === messages.length - 1 && isMine && Number(msg.is_read) === 1) {
                html += `<div class="msg-seen"><i class="fas fa-check-double"></i> Seen</div>`;
            }
            prev = msg;
        });
        listEl.innerHTML = html;

        if (wasNearBottom || messages.length <= 1) listEl.scrollTop = listEl.scrollHeight;
    } catch (err) {
        console.error("Load messages error:", err);
    }
}

async function sendThreadMessage() {
    const input = document.getElementById('threadMessageInput');
    const sendBtn = document.getElementById('threadSendBtn');
    const message = (input?.value || '').trim();
    if (!message || !activeConversationId || !currentUser) return;

    if (sendBtn) sendBtn.disabled = true;
    input.value = '';

    try {
        const res = await fetch(`${API_BASE}/messages/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conversation_id: activeConversationId, sender_id: currentUser.id, message })
        });
        if (!res.ok) throw new Error('Failed to send');
        await loadThreadMessages();
        const listEl = document.getElementById('threadMessagesList');
        if (listEl) listEl.scrollTop = listEl.scrollHeight;
    } catch (err) {
        console.error("Send message error:", err);
        Swal.fire({ title: 'Error', text: 'Message failed to send. Please try again.', icon: 'error', toast: true, position: 'top-end', timer: 2500, showConfirmButton: false });
        input.value = message; // give the text back so it isn't lost
    } finally {
        if (sendBtn) sendBtn.disabled = !(input.value || '').trim();
        input.focus();
    }
}
