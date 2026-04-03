/* === KNOWLEDGE MODULE: Chat, Library, Article Reader === */

function bindInputEvents() {
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); send(); }
  });
  document.getElementById('library-search').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); librarySearch(); }
  });
}

// === KNOWLEDGE SUB-TABS ===
function switchKnowledgeTab(tab) {
  document.querySelectorAll('.knowledge-tabs button').forEach(b => b.classList.remove('active'));
  document.getElementById('ktab-' + tab).classList.add('active');

  document.getElementById('knowledge-chat').classList.toggle('active', tab === 'chat');
  document.getElementById('knowledge-library').classList.toggle('active', tab === 'library');

  if (tab === 'chat') input.focus();
  if (tab === 'library') document.getElementById('library-search').focus();
}

// === LIBRARY ===
let libraryHistory = [];

async function showBookList() {
  const contentDiv = document.getElementById('library-content');
  const readerDiv = document.getElementById('article-reader');
  readerDiv.classList.remove('active');
  contentDiv.style.display = '';
  libraryHistory = [];

  contentDiv.innerHTML = '<div class="library-loading"><span class="spinner"></span> LOADING CATALOG...</div>';

  try {
    const resp = await fetch('/library/books');
    const data = await resp.json();

    if (data.error) {
      contentDiv.innerHTML = '<div class="library-empty">[!] ' + esc(data.error) + '<br><br>' +
        '<button onclick="startKiwix()" style="font-family:monospace;padding:10px 20px;min-height:44px;background:transparent;color:var(--glow);border:1px solid var(--glow-dim);cursor:pointer;font-size:14px;">[ START KIWIX ]</button></div>';
      return;
    }

    if (data.books.length === 0) {
      contentDiv.innerHTML = '<div class="library-empty">No volumes loaded.<br>Check that ZIM files are in the /zim directory.</div>';
      return;
    }

    let html = '';
    if (data.warning) {
      html += '<div class="library-empty" style="padding:8px;margin-bottom:8px;font-size:11px;color:var(--amber);">' + esc(data.warning) +
        ' <button onclick="startKiwix()" style="font-family:monospace;padding:4px 12px;background:transparent;color:var(--amber);border:1px solid var(--amber-dim);cursor:pointer;font-size:11px;">[ START KIWIX ]</button></div>';
    }
    html += '<div class="library-result-count">' + data.books.length + ' volumes loaded</div>';
    data.books.forEach(b => {
      html += '<div class="library-result-item" onclick="openArticle(\'' + b.path.replace(/'/g, "\\'") + '\')">';
      html += '<div class="library-result-title">' + esc(b.title) + '</div>';
      let meta = '';
      if (b.articles) meta += b.articles + ' articles';
      if (b.summary) meta += (meta ? ' \u2014 ' : '') + b.summary.substring(0, 100);
      if (meta) html += '<div class="library-result-source">' + esc(meta) + '</div>';
      html += '</div>';
    });
    contentDiv.innerHTML = html;
  } catch(e) {
    contentDiv.innerHTML = '<div class="library-empty">[!] CATALOG FAILED \u2014 Cannot reach knowledge server.<br><br>' +
      '<button onclick="startKiwix()" style="font-family:monospace;padding:10px 20px;min-height:44px;background:transparent;color:var(--glow);border:1px solid var(--glow-dim);cursor:pointer;font-size:14px;">[ START KIWIX ]</button></div>';
  }
}

async function librarySearch() {
  const q = document.getElementById('library-search').value.trim();
  if (!q) return;

  const contentDiv = document.getElementById('library-content');
  const readerDiv = document.getElementById('article-reader');

  readerDiv.classList.remove('active');
  contentDiv.style.display = '';
  libraryHistory = [];

  contentDiv.innerHTML = '<div class="library-loading"><span class="spinner"></span> SEARCHING ARCHIVES...</div>';

  try {
    const resp = await fetch('/library/search?q=' + encodeURIComponent(q) + '&limit=30');
    const data = await resp.json();

    if (data.error) {
      contentDiv.innerHTML = '<div class="library-empty">[!] ' + esc(data.error) + '</div>';
      return;
    }

    if (data.results.length === 0) {
      contentDiv.innerHTML = '<div class="library-empty">No results found for "' + esc(q) + '".<br>Try different search terms.</div>';
      return;
    }

    let html = '<div class="library-result-count">' + data.results.length + ' results found</div>';
    data.results.forEach(r => {
      html += '<div class="library-result-item" onclick="openArticle(\'' + r.link.replace(/'/g, "\\'") + '\')">';
      html += '<div class="library-result-title">' + esc(r.title) + '</div>';
      html += '<div class="library-result-source">' + esc(r.source) + '</div>';
      html += '</div>';
    });
    contentDiv.innerHTML = html;
  } catch(e) {
    contentDiv.innerHTML = '<div class="library-empty">[!] SEARCH FAILED \u2014 Cannot reach knowledge server.<br><br>' +
      '<button onclick="startKiwix()" style="font-family:monospace;padding:10px 20px;min-height:44px;background:transparent;color:var(--glow);border:1px solid var(--glow-dim);cursor:pointer;font-size:14px;">[ START KIWIX ]</button></div>';
  }
}

async function startKiwix() {
  const contentDiv = document.getElementById('library-content');
  contentDiv.innerHTML = '<div class="library-empty"><span class="spinner"></span> STARTING KNOWLEDGE SERVER...<br><span style="font-size:0.8em;color:var(--glow-dim);">Loading ZIM archives — this may take up to 30 seconds</span></div>';
  try {
    const resp = await fetch('/api/start-kiwix', {method: 'POST'});
    const data = await resp.json();
    if (data.ok) {
      contentDiv.innerHTML = '<div class="library-empty" style="color:var(--glow);">' + esc(data.message) + '<br><br>Loading catalog...</div>';
      let attempts = 0;
      const pollKiwix = async () => {
        try {
          const status = await fetch('/api/kiwix-status');
          const sdata = await status.json();
          if (sdata.running) { showBookList(); return; }
        } catch(e) {}
        if (++attempts < 15) setTimeout(pollKiwix, 2000);
        else showBookList();
      };
      setTimeout(pollKiwix, 2000);
    } else {
      contentDiv.innerHTML = '<div class="library-empty" style="color:var(--red);">[!] ' + esc(data.message) + '</div>';
    }
  } catch(e) {
    contentDiv.innerHTML = '<div class="library-empty" style="color:var(--red);">[!] Failed to start Kiwix: ' + e.message + '</div>';
  }
}

async function openArticle(path) {
  const contentDiv = document.getElementById('library-content');
  const readerDiv = document.getElementById('article-reader');
  const titleBar = document.getElementById('article-title');
  const bodyDiv = document.getElementById('article-body');
  const linksPanel = document.getElementById('article-links');
  const linksList = document.getElementById('article-links-list');

  titleBar.textContent = 'LOADING...';
  bodyDiv.textContent = '';
  linksPanel.style.display = 'none';
  linksList.innerHTML = '';

  contentDiv.style.display = 'none';
  readerDiv.classList.add('active');

  try {
    const resp = await fetch('/library/article?path=' + encodeURIComponent(path));
    const data = await resp.json();

    if (data.error) {
      titleBar.textContent = 'ERROR';
      bodyDiv.textContent = data.error;
      return;
    }

    titleBar.textContent = data.title;
    bodyDiv.innerHTML = formatArticleText(data.text);
    bodyDiv.scrollTop = 0;

    if (data.links && data.links.length > 0) {
      linksPanel.style.display = '';
      let linksHtml = '';
      data.links.forEach(lnk => {
        linksHtml += '<span class="link-pill" onclick="navigateArticle(\'' + lnk.link.replace(/'/g, "\\'") + '\')" title="' + esc(lnk.title) + '">';
        linksHtml += esc(lnk.title);
        linksHtml += '</span>';
      });
      linksList.innerHTML = linksHtml;
    }
  } catch(e) {
    titleBar.textContent = 'ERROR';
    bodyDiv.textContent = 'Failed to load article. Knowledge server may be offline.';
  }
}

function navigateArticle(path) {
  const titleBar = document.getElementById('article-title');
  libraryHistory.push({
    title: titleBar.textContent,
    path: path
  });
  openArticle(path);
}

// === DRAG-RESIZE LINKED ARTICLES PANEL ===
(function() {
  let dragging = false;
  let startY = 0;
  let startH = 0;

  document.addEventListener('mousedown', e => {
    const handle = document.getElementById('article-links-handle');
    if (!handle || !handle.contains(e.target)) return;
    const panel = document.getElementById('article-links');
    dragging = true;
    startY = e.clientY;
    startH = panel.offsetHeight;
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const panel = document.getElementById('article-links');
    const delta = startY - e.clientY;
    const newH = Math.max(40, Math.min(window.innerHeight * 0.5, startH + delta));
    panel.style.height = newH + 'px';
  });

  document.addEventListener('mouseup', () => { dragging = false; });
})();

function closeArticle() {
  if (libraryHistory.length > 0) {
    const prev = libraryHistory.pop();
  }

  const contentDiv = document.getElementById('library-content');
  const readerDiv = document.getElementById('article-reader');

  readerDiv.classList.remove('active');
  contentDiv.style.display = '';
}

// === LOADING ===
function showLoading() {
  const loader = document.createElement('div');
  loader.className = 'loading-bar';
  loader.innerHTML = '<span class="spinner"></span> ACCESSING ARCHIVES <span class="dots"></span>';
  chat.appendChild(loader);
  chat.scrollTop = chat.scrollHeight;

  let dotCount = 0;
  let elapsed = 0;
  const phases = [
    'ACCESSING ARCHIVES',
    'CROSS-REFERENCING KNOWLEDGE BASE',
    'COMPILING RESPONSE',
    'PROCESSING QUERY',
    'SEARCHING RECORDS'
  ];
  loader._interval = setInterval(() => {
    elapsed++;
    dotCount = (dotCount % 3) + 1;
    const phase = phases[Math.min(Math.floor(elapsed / 5), phases.length - 1)];
    const dots = '.'.repeat(dotCount);
    const secs = elapsed + 's';
    const blocks = '\u2593'.repeat(Math.min(elapsed, 40));
    loader.innerHTML = '<span class="spinner"></span> ' + phase + dots + ' [' + secs + '] ' + blocks;
  }, 1000);

  return loader;
}

function hideLoading(loader) {
  if (loader && loader._interval) clearInterval(loader._interval);
  if (loader && loader.parentNode) loader.parentNode.removeChild(loader);
}

// === MAIN SEND ===
async function send() {
  const q = input.value.trim();
  if (!q) return;
  input.value = '';
  sendBtn.disabled = true;
  input.disabled = true;

  conversationHistory.push({role: 'user', content: q});
  localStorage.setItem('overseer_last_query_time', new Date().toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'}));

  const userDiv = document.createElement('div');
  userDiv.className = 'msg user';
  userDiv.textContent = q;
  chat.appendChild(userDiv);
  chat.scrollTop = chat.scrollHeight;

  const loader = showLoading();

  const assistantDiv = document.createElement('div');
  assistantDiv.className = 'msg assistant';

  const prefix = document.createElement('span');
  prefix.className = 'prefix';
  prefix.textContent = 'OVERSEER>';
  assistantDiv.appendChild(prefix);

  const area = document.createElement('span');
  area.className = 'output-area cursor-blink';
  assistantDiv.appendChild(area);

  let gotFirstToken = false;
  let fullResponse = '';

  try {
    const resp = await fetch('/query', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({query: q, rag: document.getElementById('rag').checked, history: conversationHistory.slice(0, -1)})
    });
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, {stream: true});
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.context !== undefined) {
              hideLoading(loader);
              chat.appendChild(assistantDiv);
              chat.scrollTop = chat.scrollHeight;
            }
            if (data.token) {
              if (!gotFirstToken) {
                gotFirstToken = true;
                hideLoading(loader);
                if (!assistantDiv.parentNode) chat.appendChild(assistantDiv);
              }
              fullResponse += data.token;
              typeCharacters(area, data.token);
            }
            if (data.done) {
              // Will remove cursor after drain
            }
            if (data.error) {
              hideLoading(loader);
              playError();
              const errDiv = document.createElement('div');
              errDiv.className = 'msg error';
              errDiv.textContent = data.error;
              chat.appendChild(errDiv);
              chat.scrollTop = chat.scrollHeight;
            }
          } catch(e) {}
        }
      }
    }
  } catch(e) {
    hideLoading(loader);
    playError();
    const errDiv = document.createElement('div');
    errDiv.className = 'msg error';
    errDiv.textContent = 'SIGNAL LOST \u2014 Server unreachable. Check hardware.';
    chat.appendChild(errDiv);
  }

  await new Promise(resolve => {
    const check = () => { if (!isTyping) resolve(); else setTimeout(check, 50); };
    check();
  });

  area.classList.remove('cursor-blink');
  conversationHistory.push({role: 'assistant', content: fullResponse});
  saveChat();
  sendBtn.disabled = false;
  input.disabled = false;
  input.focus();
  chat.scrollTop = chat.scrollHeight;
}

// === CLEAR CHAT ===
function clearChat() {
  if (chat) chat.innerHTML = '';
  conversationHistory.length = 0;
  localStorage.removeItem(STORAGE_KEY);
}

// === EXPORT CHAT ===
function exportChat() {
  if (conversationHistory.length === 0) return;
  const now = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  let text = 'O.V.E.R.S.E.E.R. \u2014 Chat Export\n';
  text += 'Date: ' + new Date().toLocaleString() + '\n';
  text += '========================================\n\n';
  conversationHistory.forEach(msg => {
    const prefix = msg.role === 'user' ? 'OPERATOR> ' : 'OVERSEER>\n';
    text += prefix + msg.content + '\n\n';
  });
  const blob = new Blob([text], {type: 'text/plain'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'overseer-log-' + now + '.txt';
  a.click();
  URL.revokeObjectURL(a.href);
}

// === CHAT PERSISTENCE ===
function saveChat() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversationHistory));
  } catch(e) {}
}

function restoreChat() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    const history = JSON.parse(saved);
    if (!history.length) return;

    const sep = document.createElement('div');
    sep.className = 'msg assistant';
    sep.innerHTML = '<span class="prefix">OVERSEER></span><span class="output-area" style="color:var(--glow-dim);">\u2014\u2014\u2014 RESTORED SESSION (' + history.length + ' messages) \u2014\u2014\u2014</span>';
    chat.appendChild(sep);

    history.forEach(msg => {
      if (msg.role === 'user') {
        const div = document.createElement('div');
        div.className = 'msg user';
        div.textContent = msg.content;
        chat.appendChild(div);
      } else {
        const div = document.createElement('div');
        div.className = 'msg assistant';
        div.innerHTML = '<span class="prefix">OVERSEER></span><span class="output-area">' + cleanMarkdown(esc(msg.content)) + '</span>';
        chat.appendChild(div);
      }
      conversationHistory.push(msg);
    });
    chat.scrollTop = chat.scrollHeight;
  } catch(e) {}
}
