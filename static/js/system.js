/* === SYSTEM MODULE: Status Tabs, Admin PIN, User Management === */

// === SYSTEM TABS ===
function switchSystemTab(tab) {
  document.querySelectorAll('#module-system .knowledge-tabs button').forEach(b => b.classList.remove('active'));
  document.getElementById('systab-' + tab).classList.add('active');
  document.getElementById('system-status').classList.toggle('active', tab === 'status');
  document.getElementById('system-admin').classList.toggle('active', tab === 'admin');
}

// === ADMIN PIN ===
let adminPin = '';
let adminUnlocked = false;

function pinPress(n) {
  if (adminPin.length >= 8) return;
  adminPin += n;
  document.getElementById('pin-display').textContent = '\u2022'.repeat(adminPin.length);
  document.getElementById('pin-status').textContent = '';
}

function pinClear() {
  adminPin = '';
  document.getElementById('pin-display').textContent = '';
  document.getElementById('pin-status').textContent = '';
}

async function pinSubmit() {
  if (!adminPin) return;
  try {
    const resp = await fetch('/admin/verify-pin', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({pin: adminPin})
    });
    const data = await resp.json();
    if (data.ok) {
      adminUnlocked = true;
      document.getElementById('admin-pin-screen').style.display = 'none';
      document.getElementById('admin-panel').style.display = '';
      adminLoadUsers();
      adminLoadBlocks();
    } else {
      document.getElementById('pin-status').textContent = 'ACCESS DENIED';
      adminPin = '';
      document.getElementById('pin-display').textContent = '';
    }
  } catch(e) {
    document.getElementById('pin-status').textContent = 'CONNECTION ERROR';
  }
}

// === ADMIN FUNCTIONS ===
async function adminLoadUsers() {
  try {
    const resp = await fetch('/admin/users');
    const data = await resp.json();
    const container = document.getElementById('admin-user-list');
    if (data.users.length === 0) {
      container.innerHTML = '<div style="color:var(--glow-dim);padding:8px;">No operators registered. Use the form below to add one.</div>';
      return;
    }
    let html = '';
    data.users.forEach(u => {
      const date = new Date(u.created_at * 1000).toLocaleDateString();
      html += '<div class="user-card">';
      html += '<span class="callsign">' + esc(u.callsign) + '</span>';
      html += '<span class="key-preview">' + esc(u.public_key.substring(0, 40)) + '...</span>';
      html += '<span style="color:var(--glow-dim);font-size:0.7em;">' + date + '</span>';
      html += '<button class="admin-btn danger" style="padding:3px 8px;font-size:0.65em;" onclick="adminDeleteUser(' + u.id + ',\'' + esc(u.callsign) + '\')">DEL</button>';
      html += '</div>';
    });
    container.innerHTML = html;
  } catch(e) {
    document.getElementById('admin-user-list').innerHTML = '<div class="admin-msg err">Failed to load users</div>';
  }
}

async function adminRegisterUser() {
  const callsign = document.getElementById('admin-callsign').value.trim();
  const pubkey = document.getElementById('admin-pubkey').value.trim();
  const msgEl = document.getElementById('admin-register-msg');

  if (!callsign || !pubkey) {
    msgEl.className = 'admin-msg err';
    msgEl.textContent = 'Callsign and public key required';
    return;
  }

  try {
    const resp = await fetch('/admin/users', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({callsign, public_key: pubkey})
    });
    const data = await resp.json();
    if (data.ok) {
      msgEl.className = 'admin-msg ok';
      msgEl.textContent = 'Operator ' + data.callsign + ' registered';
      document.getElementById('admin-callsign').value = '';
      document.getElementById('admin-pubkey').value = '';
      adminLoadUsers();
    } else {
      msgEl.className = 'admin-msg err';
      msgEl.textContent = data.error;
    }
  } catch(e) {
    msgEl.className = 'admin-msg err';
    msgEl.textContent = 'Connection error';
  }
}

async function adminGenerateKeypair() {
  const msgEl = document.getElementById('admin-register-msg');
  try {
    const resp = await fetch('/admin/generate-keypair', {method: 'POST'});
    const data = await resp.json();

    document.getElementById('admin-pubkey').value = data.public_key;

    const blob = new Blob([data.private_key], {type: 'text/plain'});
    const callsign = document.getElementById('admin-callsign').value.trim() || 'operator';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = callsign.toLowerCase() + '_private_key.pem';
    a.click();
    URL.revokeObjectURL(a.href);

    msgEl.className = 'admin-msg ok';
    msgEl.textContent = 'Keypair generated. Private key downloaded. Public key filled in above.';
  } catch(e) {
    msgEl.className = 'admin-msg err';
    msgEl.textContent = 'Failed to generate keypair';
  }
}

async function adminDeleteUser(id, callsign) {
  if (!confirm('Remove operator ' + callsign + '? This will delete all their messages.')) return;
  try {
    await fetch('/admin/users/' + id, {method: 'DELETE'});
    adminLoadUsers();
  } catch(e) {}
}

async function adminChangePin() {
  const oldPin = document.getElementById('admin-old-pin').value;
  const newPin = document.getElementById('admin-new-pin').value;
  const msgEl = document.getElementById('admin-pin-msg');

  try {
    const resp = await fetch('/admin/change-pin', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({current: oldPin, new: newPin})
    });
    const data = await resp.json();
    if (data.ok) {
      msgEl.className = 'admin-msg ok';
      msgEl.textContent = 'PIN updated';
      document.getElementById('admin-old-pin').value = '';
      document.getElementById('admin-new-pin').value = '';
    } else {
      msgEl.className = 'admin-msg err';
      msgEl.textContent = data.error;
    }
  } catch(e) {
    msgEl.className = 'admin-msg err';
    msgEl.textContent = 'Connection error';
  }
}

async function adminLoadBlocks() {
  try {
    const resp = await fetch('/admin/blocks');
    const data = await resp.json();
    const container = document.getElementById('admin-blocks-list');
    if (data.blocks.length === 0) {
      container.innerHTML = '<div style="color:var(--glow-dim);padding:8px;">No active blocks.</div>';
      return;
    }
    let html = '';
    data.blocks.forEach(b => {
      html += '<div class="user-card">';
      html += '<span style="color:var(--glow);">' + esc(b.blocker) + '</span>';
      html += '<span style="color:var(--red);">\u2192 blocked \u2192</span>';
      html += '<span style="color:var(--glow);">' + esc(b.blocked) + '</span>';
      if (b.undelivered > 0) {
        html += '<span style="color:var(--amber);font-size:0.7em;margin-left:8px;">' + b.undelivered + ' msg dropped</span>';
      }
      html += '<button class="admin-btn" style="padding:3px 8px;font-size:0.65em;margin-left:auto;" onclick="adminUnblock(' + b.user_id + ',' + b.contact_id + ')">UNBLOCK</button>';
      html += '</div>';
    });
    container.innerHTML = html;
  } catch(e) {
    document.getElementById('admin-blocks-list').innerHTML = '<div class="admin-msg err">Failed to load blocks</div>';
  }
}

async function adminUnblock(userId, contactId) {
  try {
    await fetch('/admin/unblock', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({user_id: userId, contact_id: contactId})
    });
    adminLoadBlocks();
  } catch(e) {}
}
