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

// ===================== v2 additions (wrap/override the functions above) =====================
let inboxFilter = 'all', inboxQuery = '', cachedConversations = [];
const QUICK_REPLIES = ['Is this still available?', 'Can I schedule a viewing?', 'What is the deposit?', 'Are utilities included?'];

(function injectV2Chrome() {
    const modal = document.querySelector('#messagesModal .modal-content');
    const listView = document.getElementById('conversationsListView');
    const threadView = document.getElementById('conversationThreadView');
    const msgList = document.getElementById('threadMessagesList');
    if (!modal || !listView || !threadView || !msgList) return;

    const tb = document.createElement('div');
    tb.id = 'inboxToolbar';
    tb.className = 'inbox-toolbar';
    tb.innerHTML = `
        <div class="inbox-search"><i class="fas fa-search"></i>
            <input type="text" id="inboxSearchInput" placeholder="Search people, listings, messages..." autocomplete="off"></div>
        <div class="inbox-tabs">
            <button type="button" class="inbox-tab active" data-filter="all">All</button>
            <button type="button" class="inbox-tab" data-filter="unread">Unread</button>
        </div>`;
    modal.insertBefore(tb, listView);
    tb.querySelector('#inboxSearchInput').oninput = (e) => { inboxQuery = e.target.value.trim().toLowerCase(); renderInbox(); };
    tb.querySelectorAll('.inbox-tab').forEach(btn => btn.onclick = () => {
        inboxFilter = btn.dataset.filter;
        tb.querySelectorAll('.inbox-tab').forEach(x => x.classList.toggle('active', x === btn));
        renderInbox();
    });

    const qr = document.createElement('div');
    qr.id = 'quickReplies';
    qr.className = 'quick-replies';
    qr.style.display = 'none';
    qr.innerHTML = QUICK_REPLIES.map(t => `<button type="button" class="quick-reply-chip">${t}</button>`).join('');
    threadView.insertBefore(qr, threadView.querySelector('.thread-compose-row'));
    qr.querySelectorAll('button').forEach(b => b.onclick = () => {
        document.getElementById('threadMessageInput').value = b.textContent;
        sendThreadMessage();
    });

    const jb = document.createElement('button');
    jb.id = 'jumpLatestBtn';
    jb.type = 'button';
    jb.className = 'jump-latest-btn';
    jb.style.display = 'none';
    jb.setAttribute('aria-label', 'Jump to latest message');
    jb.innerHTML = '<i class="fas fa-arrow-down"></i>';
    threadView.appendChild(jb);
    jb.onclick = () => msgList.scrollTo({ top: msgList.scrollHeight, behavior: 'smooth' });
    msgList.addEventListener('scroll', () => {
        jb.style.display = (msgList.scrollHeight - msgList.scrollTop - msgList.clientHeight > 160) ? 'flex' : 'none';
    });
})();

function setV2Visibility(inThread) {
    const tb = document.getElementById('inboxToolbar');
    const qr = document.getElementById('quickReplies');
    const jb = document.getElementById('jumpLatestBtn');
    if (tb) tb.style.display = inThread ? 'none' : 'flex';
    if (qr) qr.style.display = (inThread && currentUser && currentUser.role === 'tenant') ? 'flex' : 'none';
    if (jb) jb.style.display = 'none';
}

const _showListV1 = showConversationsListView;
showConversationsListView = function () { _showListV1(); setV2Visibility(false); };

const _openThreadV1 = openConversationThread;
openConversationThread = function (conv) { _openThreadV1(conv); setV2Visibility(true); };

const _sendV1 = sendThreadMessage;
sendThreadMessage = async function () {
    await _sendV1();
    const qr = document.getElementById('quickReplies');
    if (qr) qr.style.display = 'none'; // chips are only for opening the conversation
};

function buildConversationRow(conv) {
    const name = conv.other_user_name || 'Unknown';
    const unread = Number(conv.unread_count) || 0;
    const hasThumb = /^(https?:|data:image)/.test(conv.listing_thumbnail || '');
    const listingIcon = hasThumb ? `<img src="${escapeHtmlAttr(conv.listing_thumbnail)}" alt="">` : '<i class="fas fa-house"></i>';
    return `
        <div class="conversation-item${unread > 0 ? ' is-unread' : ''}" data-conv-id="${conv.id}">
            <div class="conversation-avatar" style="${avatarStyle(name)}">${name.trim().charAt(0).toUpperCase() || '?'}</div>
            <div class="conversation-body">
                <div class="conversation-top-row">
                    <span class="conversation-name">${escapeHtml(name)}</span>
                    <span class="conversation-time">${formatMessageTime(conv.last_message_at)}</span>
                </div>
                <div class="conversation-listing">${listingIcon} ${escapeHtml(conv.listing_title || 'Listing')}</div>
                <div class="conversation-preview">${conv.last_message ? escapeHtml(conv.last_message) : 'Say hello!'}</div>
            </div>
            ${unread > 0 ? `<span class="conversation-unread-dot">${unread > 9 ? '9+' : unread}</span>` : ''}
        </div>`;
}

function renderInbox() {
    const listView = document.getElementById('conversationsListView');
    if (!listView) return;
    const rows = cachedConversations.filter(c => {
        if (inboxFilter === 'unread' && !(Number(c.unread_count) > 0)) return false;
        if (!inboxQuery) return true;
        return [c.other_user_name, c.listing_title, c.last_message].some(v => (v || '').toLowerCase().includes(inboxQuery));
    });
    if (rows.length === 0) {
        const msg = cachedConversations.length === 0
            ? (currentUser.role === 'landlord' ? 'Messages from tenants will show up here.' : 'Tap "Message Landlord" on any listing to start a conversation.')
            : 'No conversations match.';
        listView.innerHTML = `<div class="thread-empty" style="padding:50px 20px;"><i class="fas fa-inbox" style="font-size:26px; display:block; margin-bottom:8px; color:#cbd5e1;"></i>${msg}</div>`;
        return;
    }
    listView.innerHTML = rows.map(buildConversationRow).join('');
    listView.querySelectorAll('.conversation-item').forEach(el => {
        el.onclick = () => {
            const conv = cachedConversations.find(c => String(c.id) === el.getAttribute('data-conv-id'));
            if (conv) openConversationThread(conv);
        };
    });
}

async function loadConversationsList() {
    const listView = document.getElementById('conversationsListView');
    if (!listView || !currentUser) return;
    listView.innerHTML = '<div class="skeleton-block conv-skeleton"></div>'.repeat(3);
    try {
        const res = await fetch(`${API_BASE}/conversations/${currentUser.id}`);
        const data = await res.json();
        cachedConversations = Array.isArray(data) ? data : [];
        renderInbox();
    } catch (err) {
        console.error("Load conversations error:", err);
        listView.innerHTML = `<p style="text-align:center; color:#ff5252; font-size:13px; padding:30px 0;">Couldn't load your messages.</p>`;
    }
}

// ===================== v3 additions =====================

// 12-hour clock everywhere (e.g. "2:35 PM"), never 24-hour or "14h".
function formatBubbleTime(iso) {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatDayLabel(iso) {
    const d = new Date(iso), t = new Date(), y = new Date();
    y.setDate(t.getDate() - 1);
    if (d.toDateString() === t.toDateString()) return 'Today';
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(d.getFullYear() !== t.getFullYear() ? { year: 'numeric' } : {}) });
}

// Replaces home.js's relative "14h" label (inbox rows) with a real time/date.
function formatMessageTime(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const now = new Date(), y = new Date();
    y.setDate(now.getDate() - 1);
    if (d.toDateString() === now.toDateString()) return formatBubbleTime(iso);
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    if (now - d < 6 * 86400000) return d.toLocaleDateString('en-US', { weekday: 'short' });
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

function fullDateTime(iso) {
    return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

// Makes links and PH mobile numbers tappable. Input must already be HTML-escaped.
function linkifyMessage(escaped) {
    return escaped
        .replace(/(https?:\/\/[^\s<]+)/g, '<a class="msg-link" href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
        .replace(/(^|[\s>])(09\d{9})(?=$|[\s<.,!?])/g, '$1<a class="msg-link" href="tel:$2">$2</a>');
}

let threadDividerState = { convId: null, msgId: null, captured: false };

const _openThreadV2 = openConversationThread;
openConversationThread = function (conv) {
    threadDividerState = { convId: conv.id, msgId: null, captured: false };
    _openThreadV2(conv);
};

const _renderInboxV1 = renderInbox;
renderInbox = function () {
    _renderInboxV1();
    const unreadTotal = cachedConversations.filter(c => Number(c.unread_count) > 0).length;
    const tab = document.querySelector('#inboxToolbar .inbox-tab[data-filter="unread"]');
    if (tab) tab.innerHTML = `Unread${unreadTotal > 0 ? `<span class="inbox-tab-count">${unreadTotal}</span>` : ''}`;
};

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

        // The server marks messages read right after this fetch, so remember the first
        // unread one from the person on the FIRST load and keep the divider there.
        if (!threadDividerState.captured || threadDividerState.convId !== activeConversationId) {
            const firstUnread = messages.find(m => String(m.sender_id) !== String(currentUser.id) && Number(m.is_read) === 0);
            threadDividerState = { convId: activeConversationId, msgId: firstUnread ? firstUnread.id : null, captured: true };
        }

        let html = '', prev = null;
        messages.forEach((msg, i) => {
            const isMine = String(msg.sender_id) === String(currentUser.id);
            const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(msg.created_at).toDateString();
            if (newDay) html += `<div class="msg-day-sep">${formatDayLabel(msg.created_at)}</div>`;
            if (threadDividerState.msgId !== null && msg.id === threadDividerState.msgId) {
                html += `<div class="msg-new-divider">New messages</div>`;
            }
            const grouped = prev && !newDay && prev.sender_id === msg.sender_id
                && (new Date(msg.created_at) - new Date(prev.created_at)) < 5 * 60000
                && !(threadDividerState.msgId !== null && msg.id === threadDividerState.msgId);
            html += `
                <div class="msg-bubble ${isMine ? 'msg-bubble-sent' : 'msg-bubble-received'}${grouped ? ' msg-grouped' : ''}" title="${fullDateTime(msg.created_at)}">
                    ${linkifyMessage(escapeHtml(msg.message))}
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

// ===================== v4: Messenger-style rendering =====================
let threadOtherName = '';

const _openThreadV3 = openConversationThread;
openConversationThread = function (conv) {
    threadOtherName = conv.other_user_name || '';
    _openThreadV3(conv);
    const av = document.getElementById('messagesHeaderAvatar');
    if (av) av.setAttribute('style', 'display:flex;' + avatarStyle(threadOtherName));
};

const _showListV3 = showConversationsListView;
showConversationsListView = function () {
    _showListV3();
    const t = document.getElementById('messagesHeaderTitle');
    if (t) t.innerText = 'Chats';
};

function buildConversationRow(conv) {
    const name = conv.other_user_name || 'Unknown';
    const unread = Number(conv.unread_count) || 0;
    const hasThumb = /^(https?:|data:image)/.test(conv.listing_thumbnail || '');
    const listingIcon = hasThumb ? `<img src="${escapeHtmlAttr(conv.listing_thumbnail)}" alt="">` : '<i class="fas fa-house"></i>';
    return `
        <div class="conversation-item${unread > 0 ? ' is-unread' : ''}" data-conv-id="${conv.id}">
            <div class="conversation-avatar" style="${avatarStyle(name)}">${name.trim().charAt(0).toUpperCase() || '?'}</div>
            <div class="conversation-body">
                <div class="conversation-top-row"><span class="conversation-name">${escapeHtml(name)}</span></div>
                <div class="conversation-preview-row">
                    <span class="conversation-preview">${conv.last_message ? escapeHtml(conv.last_message) : 'Say hello!'}</span>
                    <span class="conversation-time">· ${formatMessageTime(conv.last_message_at)}</span>
                </div>
                <div class="conversation-listing">${listingIcon} ${escapeHtml(conv.listing_title || 'Listing')}</div>
            </div>
            ${unread > 0 ? `<span class="conversation-unread-dot">${unread > 9 ? '9+' : unread}</span>` : ''}
        </div>`;
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

        if (!threadDividerState.captured || threadDividerState.convId !== activeConversationId) {
            const firstUnread = messages.find(m => String(m.sender_id) !== String(currentUser.id) && Number(m.is_read) === 0);
            threadDividerState = { convId: activeConversationId, msgId: firstUnread ? firstUnread.id : null, captured: true };
        }

        const GAP = 15 * 60000, GROUP = 5 * 60000;
        const initial = (threadOtherName || '?').trim().charAt(0).toUpperCase() || '?';
        const otherStyle = avatarStyle(threadOtherName);
        const isDivider = (m) => threadDividerState.msgId !== null && m && m.id === threadDividerState.msgId;
        const linked = (a, b) => a && b && a.sender_id === b.sender_id && !isDivider(b)
            && (new Date(b.created_at) - new Date(a.created_at)) < GROUP
            && new Date(a.created_at).toDateString() === new Date(b.created_at).toDateString();

        let html = '';
        messages.forEach((msg, i) => {
            const prev = messages[i - 1], next = messages[i + 1];
            const isMine = String(msg.sender_id) === String(currentUser.id);
            const t = new Date(msg.created_at);

            const newStamp = !prev || (t - new Date(prev.created_at)) > GAP || new Date(prev.created_at).toDateString() !== t.toDateString();
            if (newStamp) html += `<div class="msg-time-sep"><b>${formatDayLabel(msg.created_at)}</b> ${formatBubbleTime(msg.created_at)}</div>`;
            if (isDivider(msg)) html += `<div class="msg-new-divider">New messages</div>`;

            const lp = linked(prev, msg), ln = linked(msg, next);
            const pos = lp && ln ? 'mid' : lp ? 'last' : ln ? 'first' : 'single';
            const showAvatar = !isMine && (pos === 'last' || pos === 'single');

            html += `
                <div class="msg-row ${isMine ? 'msg-row-sent' : 'msg-row-received'}${(pos === 'single' || pos === 'first') ? ' row-start' : ''}">
                    ${isMine ? '' : (showAvatar ? `<div class="msg-avatar" style="${otherStyle}">${initial}</div>` : '<div class="msg-avatar-spacer"></div>')}
                    <div class="msg-bubble ${isMine ? 'msg-bubble-sent' : 'msg-bubble-received'} grp-${pos}" title="${fullDateTime(msg.created_at)}">
                        ${linkifyMessage(escapeHtml(msg.message))}
                    </div>
                </div>`;

            if (i === messages.length - 1 && isMine && Number(msg.is_read) === 1) {
                html += `<div class="msg-seen-row"><div class="msg-seen-avatar" style="${otherStyle}" title="Seen">${initial}</div></div>`;
            }
        });
        listEl.innerHTML = html;

        if (wasNearBottom || messages.length <= 1) listEl.scrollTop = listEl.scrollHeight;
    } catch (err) {
        console.error("Load messages error:", err);
    }
}
