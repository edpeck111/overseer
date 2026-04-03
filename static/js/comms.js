/* === COMMS MODULE: Messaging, Contacts, Trust System === */

let commsUserId = null;
let commsCallsign = '';
let commsCurrentTab = 'inbox';

async function commsLoadUserList() {
  try {
    const resp = await fetch('/comms/users');
    const data = await resp.json();
    const container = document.getElementById('comms-user-list');
    if (data.users.length === 0) {
      container.innerHTML = '<div class="comms-empty">No operators registered.<br>Use SYSTEM > ADMIN to add operators.</div>';
      return;
    }
    let html = '';
    data.users.forEach(u => {
      html += '<div class="comms-user-btn" onclick="commsLogin(' + u.id + ',\'' + esc(u.callsign).replace(/'/g, "\\'") + '\')">' + esc(u.callsign) + '</div>';
    });
    container.innerHTML = html;
  } catch(e) {
    document.getElementById('comms-user-list').innerHTML = '<div class="comms-empty">Connection error</div>';
  }
}

function commsLogin(userId, callsign) {
  commsUserId = userId;
  commsCallsign = callsign;
  document.getElementById('comms-login').style.display = 'none';
  document.getElementById('comms-interface').classList.add('active');
  document.getElementById('comms-identity').textContent = callsign;
  switchCommsTab('inbox');
  commsLoadRecipients();
}

function commsLogout() {
  commsUserId = null;
  commsCallsign = '';
  document.getElementById('comms-interface').classList.remove('active');
  document.getElementById('comms-login').style.display = '';
  commsLoadUserList();
}

function switchCommsTab(tab) {
  commsCurrentTab = tab;
  document.querySelectorAll('.comms-tabs button').forEach(b => b.classList.remove('active'));
  document.getElementById('ctab-' + tab).classList.add('active');

  document.getElementById('comms-inbox').style.display = tab === 'inbox' ? 'block' : 'none';
  document.getElementById('comms-sent').style.display = tab === 'sent' ? 'block' : 'none';
  document.getElementById('comms-compose').classList.toggle('active', tab === 'compose');
  document.getElementById('comms-msg-view').classList.remove('active');

  if (tab === 'inbox') commsLoadInbox();
  if (tab === 'sent') commsLoadSent();
}

async function commsLoadInbox() {
  if (!commsUserId) return;
  const container = document.getElementById('comms-inbox');
  try {
    const resp = await fetch('/comms/inbox/' + commsUserId);
    const data = await resp.json();
    if (data.messages.length === 0) {
      container.innerHTML = '<div class="comms-empty">No messages received.</div>';
      document.getElementById('comms-badge').style.display = 'none';
      return;
    }
    const unread = data.messages.filter(m => !m.read_at).length;
    const badge = document.getElementById('comms-badge');
    if (unread > 0) {
      badge.textContent = unread;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
    const blockedSenders = {};
    data.messages.forEach(m => {
      if (m.contact_status === 'blocked' && m.dropped_count > 0 && !blockedSenders[m.from_id]) {
        blockedSenders[m.from_id] = m.dropped_count;
      }
    });

    let html = '';
    data.messages.forEach(m => {
      const isBlocked = m.contact_status === 'blocked';
      const isPending = (m.contact_status === 'pending' || m.contact_status === 'none') && !isBlocked;
      const isAccepted = m.contact_status === 'accepted';
      const isOverseer = m.from_callsign === 'OVERSEER';
      const showRequest = isPending && !isOverseer;
      const canBlock = (isAccepted || showRequest) && !isOverseer;
      let cls = m.read_at ? '' : ' unread';
      if (showRequest) cls = ' pending';
      if (isBlocked) cls = '';
      const subj = m.subject || '(no subject)';
      html += '<div class="msg-item' + cls + '" style="' + (isBlocked ? 'opacity:0.4;' : '') + '">';
      html += '<div class="msg-from" onclick="commsViewMessage(' + m.id + ', \'inbox\')" style="cursor:pointer;">FROM: ' + esc(m.from_callsign);
      if (showRequest) html += '<span class="msg-request-label">NEW CONTACT</span>';
      if (isBlocked) {
        html += '<span class="msg-request-label" style="background:var(--red-dim);color:#fff;">BLOCKED</span>';
        if (blockedSenders[m.from_id]) {
          html += '<span style="color:var(--amber);font-size:0.65em;margin-left:6px;">' + blockedSenders[m.from_id] + ' msg intercepted</span>';
          blockedSenders[m.from_id] = 0;
        }
      }
      html += '</div>';
      html += '<div class="msg-subject" onclick="commsViewMessage(' + m.id + ', \'inbox\')" style="cursor:pointer;">' + esc(subj) + '</div>';
      html += '<div class="msg-date">' + formatTime(m.sent_at) + '</div>';
      if (showRequest) {
        html += '<div class="msg-request-actions">';
        html += '<button class="msg-accept" onclick="event.stopPropagation();commsAcceptContact(' + m.from_id + ')">ACCEPT</button>';
        html += '<button class="msg-block" onclick="event.stopPropagation();commsBlockContact(' + m.from_id + ')">BLOCK</button>';
        html += '</div>';
      } else if (isAccepted && !isOverseer) {
        html += '<div class="msg-request-actions">';
        html += '<button class="msg-block" onclick="event.stopPropagation();commsBlockContact(' + m.from_id + ')" style="font-size:0.55em;">BLOCK</button>';
        html += '</div>';
      }
      html += '</div>';
    });
    container.innerHTML = html;
  } catch(e) {
    container.innerHTML = '<div class="comms-empty">Connection error</div>';
  }
}

async function commsLoadSent() {
  if (!commsUserId) return;
  const container = document.getElementById('comms-sent');
  try {
    const resp = await fetch('/comms/sent/' + commsUserId);
    const data = await resp.json();
    if (data.messages.length === 0) {
      container.innerHTML = '<div class="comms-empty">No messages sent.</div>';
      return;
    }
    let html = '';
    data.messages.forEach(m => {
      const subj = m.subject || '(no subject)';
      html += '<div class="msg-item" onclick="commsViewMessage(' + m.id + ', \'sent\')">';
      html += '<div class="msg-from">TO: ' + esc(m.to_callsign) + '</div>';
      html += '<div class="msg-subject">' + esc(subj) + '</div>';
      html += '<div class="msg-date">' + formatTime(m.sent_at) + '</div>';
      html += '</div>';
    });
    container.innerHTML = html;
  } catch(e) {
    container.innerHTML = '<div class="comms-empty">Connection error</div>';
  }
}

let currentViewMsg = null;
let currentViewSource = null;

async function commsViewMessage(msgId, source) {
  document.getElementById('comms-inbox').style.display = 'none';
  document.getElementById('comms-sent').style.display = 'none';
  document.getElementById('comms-compose').classList.remove('active');
  document.getElementById('comms-msg-view').classList.add('active');

  const endpoint = source === 'inbox' ? '/comms/inbox/' : '/comms/sent/';
  try {
    const resp = await fetch(endpoint + commsUserId);
    const data = await resp.json();
    const msg = data.messages.find(m => m.id === msgId);
    if (!msg) {
      document.getElementById('msg-view-body').textContent = 'Message not found';
      return;
    }

    currentViewMsg = msg;
    currentViewSource = source;

    document.getElementById('msg-view-subject').textContent = msg.subject || '(no subject)';
    const who = source === 'inbox' ? 'FROM: ' + msg.from_callsign : 'TO: ' + msg.to_callsign;
    document.getElementById('msg-view-meta').textContent = who + '  |  ' + formatTime(msg.sent_at);
    document.getElementById('msg-view-body').textContent = msg.body;

    const actions = document.getElementById('msg-view-actions');
    let btns = '';
    if (source === 'inbox') {
      btns += '<button class="admin-btn" style="padding:3px 10px;font-size:0.65em;" onclick="commsReply()">REPLY</button>';
    }
    btns += '<button class="admin-btn" style="padding:3px 10px;font-size:0.65em;" onclick="commsForward()">FORWARD</button>';
    actions.innerHTML = btns;

    if (source === 'inbox' && !msg.read_at) {
      fetch('/comms/read/' + msgId, {method: 'POST'});
    }
  } catch(e) {
    document.getElementById('msg-view-body').textContent = 'Failed to load message';
  }
}

function commsReply() {
  if (!currentViewMsg) return;
  document.getElementById('comms-msg-view').classList.remove('active');
  document.getElementById('comms-compose').classList.add('active');
  document.querySelectorAll('.comms-tabs button').forEach(b => b.classList.remove('active'));
  document.getElementById('ctab-compose').classList.add('active');
  commsCurrentTab = 'compose';

  const subj = currentViewMsg.subject || '';
  const reSubj = subj.startsWith('RE: ') ? subj : 'RE: ' + subj;
  document.getElementById('compose-subject').value = reSubj;

  const sel = document.getElementById('compose-to');
  for (let i = 0; i < sel.options.length; i++) {
    if (sel.options[i].text === currentViewMsg.from_callsign) {
      sel.selectedIndex = i;
      break;
    }
  }

  const quote = '\n\n--- ' + currentViewMsg.from_callsign + ' wrote ---\n' + currentViewMsg.body;
  document.getElementById('compose-body').value = quote;
  document.getElementById('compose-body').setSelectionRange(0, 0);
  document.getElementById('compose-body').focus();
  document.getElementById('compose-msg').textContent = '';
}

function commsForward() {
  if (!currentViewMsg) return;
  document.getElementById('comms-msg-view').classList.remove('active');
  document.getElementById('comms-compose').classList.add('active');
  document.querySelectorAll('.comms-tabs button').forEach(b => b.classList.remove('active'));
  document.getElementById('ctab-compose').classList.add('active');
  commsCurrentTab = 'compose';

  const subj = currentViewMsg.subject || '';
  const fwSubj = subj.startsWith('FW: ') ? subj : 'FW: ' + subj;
  document.getElementById('compose-subject').value = fwSubj;

  document.getElementById('compose-to').selectedIndex = 0;

  const sender = currentViewMsg.from_callsign || currentViewMsg.to_callsign || 'unknown';
  const quote = '\n\n--- Forwarded from ' + sender + ' ---\n' + currentViewMsg.body;
  document.getElementById('compose-body').value = quote;
  document.getElementById('compose-body').setSelectionRange(0, 0);
  document.getElementById('compose-body').focus();
  document.getElementById('compose-msg').textContent = '';
}

function closeMsgView() {
  document.getElementById('comms-msg-view').classList.remove('active');
  switchCommsTab(commsCurrentTab);
}

async function commsLoadRecipients() {
  try {
    const resp = await fetch('/comms/users?viewer=' + commsUserId);
    const data = await resp.json();
    const sel = document.getElementById('compose-to');
    sel.innerHTML = '<option value="">-- SELECT RECIPIENT --</option>';
    data.users.forEach(u => {
      if (u.id !== commsUserId && !u.blocked) {
        sel.innerHTML += '<option value="' + u.id + '">' + esc(u.callsign) + '</option>';
      }
    });
  } catch(e) {}
}

async function commsSend() {
  const toId = document.getElementById('compose-to').value;
  const subject = document.getElementById('compose-subject').value.trim();
  const body = document.getElementById('compose-body').value.trim();
  const msgEl = document.getElementById('compose-msg');

  if (!toId) { msgEl.className = 'admin-msg err'; msgEl.textContent = 'Select a recipient'; return; }
  if (!body) { msgEl.className = 'admin-msg err'; msgEl.textContent = 'Message body required'; return; }

  try {
    const resp = await fetch('/comms/send', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({from: commsUserId, to: parseInt(toId), subject, body})
    });
    const data = await resp.json();
    if (data.ok) {
      msgEl.className = 'admin-msg ok';
      msgEl.textContent = 'Message transmitted';
      document.getElementById('compose-subject').value = '';
      document.getElementById('compose-body').value = '';
    } else {
      msgEl.className = 'admin-msg err';
      msgEl.textContent = data.error;
    }
  } catch(e) {
    msgEl.className = 'admin-msg err';
    msgEl.textContent = 'Transmission failed';
  }
}

// === CONTACT TRUST SYSTEM ===
async function commsAcceptContact(contactId) {
  try {
    await fetch('/comms/contacts/accept', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({user_id: commsUserId, contact_id: contactId})
    });
    commsLoadInbox();
    commsLoadRecipients();
  } catch(e) {}
}

async function commsBlockContact(contactId) {
  try {
    await fetch('/comms/contacts/block', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({user_id: commsUserId, contact_id: contactId})
    });
    commsLoadInbox();
    commsLoadRecipients();
  } catch(e) {}
}
