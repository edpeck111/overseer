/**
 * OVERSEER Game Engine v1.0
 *
 * Self-contained game engine loaded dynamically by the OVERSEER UI.
 * All game logic runs client-side. Only stats sync to the server.
 *
 * Games register themselves in GAMES.catalog. The UI calls
 * GAMES.launch(gameId, container, userId, difficulty) to start a game.
 */

window.GAMES = {
  engineVersion: 1,

  catalog: [
    {id:'scenarios',   cat:'survival',  name:'Survival Scenarios', desc:'Make the right call or face the consequences', icon:'!'},
    {id:'morse',       cat:'survival',  name:'Morse Trainer',      desc:'Learn Morse code for emergency comms',        icon:'.-.'},
    {id:'hangman',     cat:'word',      name:'Hangman',            desc:'Guess the word before the operator is lost',   icon:'_'},
    {id:'scramble',    cat:'word',      name:'Word Scramble',      desc:'Unscramble the survival term',                 icon:'#'},
    {id:'codebreaker', cat:'strategy',  name:'Codebreaker',        desc:'Crack the secret code in limited attempts',    icon:'?'},
    {id:'numberhunt',  cat:'strategy',  name:'Number Hunt',        desc:'Find the target with limited guesses',         icon:'^'},
    {id:'tictactoe',   cat:'classic',   name:'Tic-Tac-Toe',       desc:'Classic grid game vs the OVERSEER AI',         icon:'X'},
  ],

  categories: [
    {id:'survival', name:'SURVIVAL',  icon:'!',  desc:'Scenarios & essential skills'},
    {id:'word',     name:'WORD',      icon:'A',  desc:'Vocabulary & language'},
    {id:'strategy', name:'STRATEGY',  icon:'?',  desc:'Logic & deduction'},
    {id:'classic',  name:'CLASSIC',   icon:'X',  desc:'Timeless games'},
  ],

  // Get game data from localStorage cache
  getData(gameId) {
    try {
      const raw = localStorage.getItem('games_data_' + gameId);
      return raw ? JSON.parse(raw) : null;
    } catch(e) { return null; }
  },

  // Get/set stats from localStorage
  getStats(userId, gameId) {
    try {
      const raw = localStorage.getItem('games_state_' + userId + '_' + gameId);
      return raw ? JSON.parse(raw) : {};
    } catch(e) { return {}; }
  },

  saveStats(userId, gameId, stats) {
    localStorage.setItem('games_state_' + userId + '_' + gameId, JSON.stringify(stats));
    // Queue server sync (non-blocking)
    if (typeof _gameSyncStat === 'function') _gameSyncStat(userId, gameId, stats);
  },

  // Increment a stat
  incStat(userId, gameId, key, amount) {
    const stats = this.getStats(userId, gameId);
    stats[key] = (parseInt(stats[key]) || 0) + (amount || 1);
    this.saveStats(userId, gameId, stats);
    return stats;
  },

  // Helper: create element
  el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html) e.innerHTML = html;
    return e;
  },

  // ═══════════════════════════════════════════════════════════
  // GAME: Hangman
  // ═══════════════════════════════════════════════════════════
  hangman: {
    launch(container, userId, difficulty) {
      const data = GAMES.getData('hangman');
      if (!data) { container.innerHTML = '<div class="game-msg">Game data not synced. Connect to OVERSEER base.</div>'; return; }

      const diff = difficulty || 'medium';
      const words = data.words[diff] || data.words.medium;
      const word = words[Math.floor(Math.random() * words.length)].toUpperCase();
      const maxWrong = 7;
      let guessed = new Set();
      let wrong = 0;

      const figures = [
        '  ┌──┐\n  │  \n  │  \n  │  \n──┴──',
        '  ┌──┐\n  │  O\n  │  \n  │  \n──┴──',
        '  ┌──┐\n  │  O\n  │  |\n  │  \n──┴──',
        '  ┌──┐\n  │  O\n  │ /|\n  │  \n──┴──',
        '  ┌──┐\n  │  O\n  │ /|\\\n  │  \n──┴──',
        '  ┌──┐\n  │  O\n  │ /|\\\n  │ / \n──┴──',
        '  ┌──┐\n  │  O\n  │ /|\\\n  │ / \\\n──┴──',
        '  ┌──┐\n  │  X\n  │ /|\\\n  │ / \\\n──┴──',
      ];

      function render() {
        const display = word.split('').map(c => guessed.has(c) ? c : '_').join(' ');
        const won = !display.includes('_');
        const lost = wrong >= maxWrong;

        let html = '<div class="game-board">' + figures[Math.min(wrong, figures.length-1)] + '</div>';
        html += '<div class="game-board" style="font-size:1.2em;letter-spacing:4px;">' + display + '</div>';

        if (won) {
          html += '<div class="game-msg win">WORD DECODED: ' + word + '</div>';
          html += '<div class="game-btn-row"><button class="game-btn" onclick="GAMES.hangman.launch(this.closest(\'.rec-play-area\'),\'' + userId + '\',\'' + diff + '\')">PLAY AGAIN</button></div>';
          GAMES.incStat(userId, 'hangman', 'wins', 1);
          GAMES.incStat(userId, 'hangman', 'played', 1);
        } else if (lost) {
          html += '<div class="game-msg lose">OPERATOR LOST. Word was: ' + word + '</div>';
          html += '<div class="game-btn-row"><button class="game-btn" onclick="GAMES.hangman.launch(this.closest(\'.rec-play-area\'),\'' + userId + '\',\'' + diff + '\')">PLAY AGAIN</button></div>';
          GAMES.incStat(userId, 'hangman', 'losses', 1);
          GAMES.incStat(userId, 'hangman', 'played', 1);
        } else {
          html += '<div style="font-size:0.65em;color:var(--glow-dim);margin:4px 0;">Remaining: ' + (maxWrong - wrong) + '</div>';
          html += '<div class="game-btn-row">';
          'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach(c => {
            const used = guessed.has(c);
            const cls = used ? (word.includes(c) ? 'game-btn active' : 'game-btn') : 'game-btn';
            const dis = used ? ' disabled style="opacity:0.3;"' : '';
            html += '<button class="' + cls + '"' + dis + ' onclick="GAMES.hangman._guess(\'' + c + '\')">' + c + '</button>';
          });
          html += '</div>';
        }

        container.innerHTML = html;
      }

      this._guess = function(c) {
        if (guessed.has(c)) return;
        guessed.add(c);
        if (!word.includes(c)) wrong++;
        render();
      };

      render();
    }
  },

  // ═══════════════════════════════════════════════════════════
  // GAME: Word Scramble
  // ═══════════════════════════════════════════════════════════
  scramble: {
    _current: null,
    launch(container, userId) {
      const data = GAMES.getData('scramble');
      if (!data) { container.innerHTML = '<div class="game-msg">Game data not synced.</div>'; return; }

      const item = data.words[Math.floor(Math.random() * data.words.length)];
      const word = item.word.toUpperCase();
      let scrambled = word.split('');
      for (let i = scrambled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [scrambled[i], scrambled[j]] = [scrambled[j], scrambled[i]];
      }
      if (scrambled.join('') === word) { scrambled.reverse(); }
      this._current = { word, hint: item.hint, userId, container };

      let html = '<div class="game-board" style="font-size:1.4em;letter-spacing:6px;">' + scrambled.join('') + '</div>';
      html += '<div style="font-size:0.7em;color:var(--glow-dim);margin:8px 0;">HINT: ' + item.hint + '</div>';
      html += '<input type="text" class="game-input" id="scramble-input" placeholder="YOUR ANSWER" maxlength="' + word.length + '" autocomplete="off" spellcheck="false" onkeydown="if(event.key===\'Enter\')GAMES.scramble._check()">';
      html += '<div class="game-btn-row"><button class="game-btn" onclick="GAMES.scramble._check()">SUBMIT</button></div>';
      html += '<div id="scramble-msg"></div>';
      container.innerHTML = html;
      container.querySelector('#scramble-input').focus();
    },

    _check() {
      const input = document.getElementById('scramble-input');
      const msg = document.getElementById('scramble-msg');
      const guess = input.value.trim().toUpperCase();
      const { word, userId, container } = this._current;

      if (guess === word) {
        msg.className = 'game-msg win';
        msg.textContent = 'CORRECT: ' + word;
        GAMES.incStat(userId, 'scramble', 'wins', 1);
        GAMES.incStat(userId, 'scramble', 'played', 1);
        setTimeout(() => this.launch(container, userId), 1500);
      } else {
        msg.className = 'game-msg lose';
        msg.textContent = 'INCORRECT — TRY AGAIN';
        input.value = '';
        input.focus();
      }
    }
  },

  // ═══════════════════════════════════════════════════════════
  // GAME: Codebreaker (Mastermind)
  // ═══════════════════════════════════════════════════════════
  codebreaker: {
    _state: null,
    launch(container, userId, difficulty) {
      const data = GAMES.getData('codebreaker');
      if (!data) { container.innerHTML = '<div class="game-msg">Game data not synced.</div>'; return; }

      const diff = difficulty || 'medium';
      const cfg = data.config[diff];
      const digits = cfg.digits;
      const range = cfg.range;
      const maxAttempts = cfg.attempts;

      // Generate secret code
      const code = [];
      for (let i = 0; i < digits; i++) code.push(Math.floor(Math.random() * range) + 1);

      this._state = { code, digits, range, maxAttempts, guesses: [], userId, container, diff };
      this._render();
    },

    _render() {
      const s = this._state;
      let html = '<div style="font-size:0.65em;color:var(--glow-dim);margin-bottom:8px;">Crack the ' + s.digits + '-digit code. Each digit is 1-' + s.range + '.</div>';
      html += '<div style="font-size:0.6em;color:var(--glow-dim);margin-bottom:12px;">';
      html += 'EXACT = right number, right position | CLOSE = right number, wrong position</div>';

      // Previous guesses
      s.guesses.forEach(g => {
        html += '<div class="game-board" style="font-size:0.85em;margin:2px 0;">';
        html += g.guess.join(' ') + '  |  EXACT: ' + g.exact + '  CLOSE: ' + g.close;
        html += '</div>';
      });

      const won = s.guesses.length > 0 && s.guesses[s.guesses.length-1].exact === s.digits;
      const lost = !won && s.guesses.length >= s.maxAttempts;

      if (won) {
        html += '<div class="game-msg win">CODE CRACKED in ' + s.guesses.length + ' attempts!</div>';
        html += '<div class="game-btn-row"><button class="game-btn" onclick="GAMES.codebreaker.launch(GAMES.codebreaker._state.container,\'' + s.userId + '\',\'' + s.diff + '\')">PLAY AGAIN</button></div>';
        GAMES.incStat(s.userId, 'codebreaker', 'wins', 1);
        GAMES.incStat(s.userId, 'codebreaker', 'played', 1);
        const best = GAMES.getStats(s.userId, 'codebreaker').best_attempts;
        if (!best || s.guesses.length < parseInt(best)) {
          GAMES.saveStats(s.userId, 'codebreaker', {...GAMES.getStats(s.userId,'codebreaker'), best_attempts: s.guesses.length});
        }
      } else if (lost) {
        html += '<div class="game-msg lose">CODE UNBROKEN. Answer: ' + s.code.join(' ') + '</div>';
        html += '<div class="game-btn-row"><button class="game-btn" onclick="GAMES.codebreaker.launch(GAMES.codebreaker._state.container,\'' + s.userId + '\',\'' + s.diff + '\')">PLAY AGAIN</button></div>';
        GAMES.incStat(s.userId, 'codebreaker', 'losses', 1);
        GAMES.incStat(s.userId, 'codebreaker', 'played', 1);
      } else {
        html += '<div style="font-size:0.6em;color:var(--glow-dim);margin:6px 0;">Attempt ' + (s.guesses.length+1) + '/' + s.maxAttempts + '</div>';
        html += '<div class="game-btn-row">';
        for (let i = 0; i < s.digits; i++) {
          html += '<select class="game-input" style="width:45px;text-align:center;padding:4px;" id="cb-d' + i + '">';
          for (let n = 1; n <= s.range; n++) html += '<option value="' + n + '">' + n + '</option>';
          html += '</select>';
        }
        html += '</div>';
        html += '<div class="game-btn-row"><button class="game-btn" onclick="GAMES.codebreaker._submit()">SUBMIT</button></div>';
      }

      s.container.innerHTML = html;
    },

    _submit() {
      const s = this._state;
      const guess = [];
      for (let i = 0; i < s.digits; i++) {
        guess.push(parseInt(document.getElementById('cb-d' + i).value));
      }

      // Calculate exact and close matches
      let exact = 0, close = 0;
      const codeCopy = [...s.code];
      const guessCopy = [...guess];

      // First pass: exact matches
      for (let i = 0; i < s.digits; i++) {
        if (guessCopy[i] === codeCopy[i]) {
          exact++;
          codeCopy[i] = -1;
          guessCopy[i] = -2;
        }
      }
      // Second pass: close matches
      for (let i = 0; i < s.digits; i++) {
        if (guessCopy[i] === -2) continue;
        const idx = codeCopy.indexOf(guessCopy[i]);
        if (idx !== -1) {
          close++;
          codeCopy[idx] = -1;
        }
      }

      s.guesses.push({ guess, exact, close });
      this._render();
    }
  },

  // ═══════════════════════════════════════════════════════════
  // GAME: Number Hunt
  // ═══════════════════════════════════════════════════════════
  numberhunt: {
    _state: null,
    launch(container, userId, difficulty) {
      const data = GAMES.getData('numberhunt');
      if (!data) { container.innerHTML = '<div class="game-msg">Game data not synced.</div>'; return; }

      const diff = difficulty || 'medium';
      const cfg = data.config[diff];
      const target = Math.floor(Math.random() * (cfg.max - cfg.min + 1)) + cfg.min;

      this._state = { target, min: cfg.min, max: cfg.max, maxAttempts: cfg.attempts, guesses: [], userId, container, diff };
      this._render();
    },

    _render() {
      const s = this._state;
      let html = '<div style="font-size:0.65em;color:var(--glow-dim);margin-bottom:12px;">Find the number between ' + s.min + ' and ' + s.max + '</div>';

      s.guesses.forEach(g => {
        const arrow = g.dir === 'high' ? ' [TOO HIGH]' : g.dir === 'low' ? ' [TOO LOW]' : ' [EXACT]';
        const cls = g.dir === 'exact' ? 'color:var(--glow-bright);' : 'color:var(--glow-dim);';
        html += '<div style="font-size:0.8em;' + cls + 'margin:2px 0;">' + g.value + arrow + '</div>';
      });

      const won = s.guesses.length > 0 && s.guesses[s.guesses.length-1].dir === 'exact';
      const lost = !won && s.guesses.length >= s.maxAttempts;

      if (won) {
        html += '<div class="game-msg win">TARGET FOUND in ' + s.guesses.length + ' guesses!</div>';
        html += '<div class="game-btn-row"><button class="game-btn" onclick="GAMES.numberhunt.launch(GAMES.numberhunt._state.container,\'' + s.userId + '\',\'' + s.diff + '\')">PLAY AGAIN</button></div>';
        GAMES.incStat(s.userId, 'numberhunt', 'wins', 1);
        GAMES.incStat(s.userId, 'numberhunt', 'played', 1);
      } else if (lost) {
        html += '<div class="game-msg lose">TARGET LOST. Answer: ' + s.target + '</div>';
        html += '<div class="game-btn-row"><button class="game-btn" onclick="GAMES.numberhunt.launch(GAMES.numberhunt._state.container,\'' + s.userId + '\',\'' + s.diff + '\')">PLAY AGAIN</button></div>';
        GAMES.incStat(s.userId, 'numberhunt', 'losses', 1);
        GAMES.incStat(s.userId, 'numberhunt', 'played', 1);
      } else {
        html += '<div style="font-size:0.6em;color:var(--glow-dim);margin:6px 0;">Guess ' + (s.guesses.length+1) + '/' + s.maxAttempts + '</div>';
        html += '<input type="number" class="game-input" id="nh-input" min="' + s.min + '" max="' + s.max + '" placeholder="' + s.min + '-' + s.max + '" onkeydown="if(event.key===\'Enter\')GAMES.numberhunt._submit()">';
        html += '<div class="game-btn-row"><button class="game-btn" onclick="GAMES.numberhunt._submit()">GUESS</button></div>';
      }

      s.container.innerHTML = html;
      const inp = s.container.querySelector('#nh-input');
      if (inp) inp.focus();
    },

    _submit() {
      const s = this._state;
      const val = parseInt(document.getElementById('nh-input').value);
      if (isNaN(val) || val < s.min || val > s.max) return;

      let dir;
      if (val === s.target) dir = 'exact';
      else if (val > s.target) dir = 'high';
      else dir = 'low';

      s.guesses.push({ value: val, dir });
      this._render();
    }
  },

  // ═══════════════════════════════════════════════════════════
  // GAME: Survival Scenarios
  // ═══════════════════════════════════════════════════════════
  scenarios: {
    _state: null,
    launch(container, userId) {
      const data = GAMES.getData('scenarios');
      if (!data) { container.innerHTML = '<div class="game-msg">Game data not synced.</div>'; return; }

      const scenarios = data.scenarios;
      const idx = Math.floor(Math.random() * scenarios.length);
      this._state = { scenario: scenarios[idx], userId, container, totalScore: 0, round: 0, maxRounds: Math.min(scenarios.length, 5), played: new Set([idx]), allScenarios: scenarios };
      this._render();
    },

    _render() {
      const s = this._state;
      const sc = s.scenario;
      let html = '<div style="font-size:0.65em;color:var(--glow-dim);margin-bottom:4px;">SCENARIO ' + (s.round+1) + '/' + s.maxRounds + ' | SCORE: ' + s.totalScore + '</div>';
      html += '<div class="game-msg" style="font-size:0.85em;margin:8px 0;">' + sc.title + '</div>';
      html += '<div style="font-size:0.78em;line-height:1.6;max-width:500px;text-align:left;margin:8px auto;color:var(--glow);">' + sc.text + '</div>';
      html += '<div style="margin-top:12px;max-width:500px;width:100%;">';
      sc.choices.forEach((c, i) => {
        html += '<button class="game-btn" style="display:block;width:100%;text-align:left;margin:4px 0;padding:8px 12px;font-size:0.75em;white-space:normal;" onclick="GAMES.scenarios._choose(' + i + ')">' + (i+1) + '. ' + c.text + '</button>';
      });
      html += '</div>';
      s.container.innerHTML = html;
    },

    _choose(idx) {
      const s = this._state;
      const choice = s.scenario.choices[idx];
      s.totalScore += choice.score;
      s.round++;

      // Show outcome
      let scoreColor = choice.score >= 70 ? 'var(--glow-bright)' : choice.score >= 40 ? 'var(--glow)' : 'var(--red)';
      let html = '<div class="game-msg" style="font-size:0.85em;">' + s.scenario.title + ' — RESULT</div>';
      html += '<div style="font-size:0.78em;line-height:1.6;max-width:500px;text-align:left;margin:8px auto;color:var(--glow);">' + choice.outcome + '</div>';
      html += '<div style="font-size:0.85em;color:' + scoreColor + ';margin:12px 0;">SCORE: +' + choice.score + '</div>';

      if (s.round >= s.maxRounds) {
        // Game over
        const avg = Math.round(s.totalScore / s.maxRounds);
        let rating;
        if (avg >= 80) rating = 'EXPERT SURVIVOR';
        else if (avg >= 60) rating = 'COMPETENT';
        else if (avg >= 40) rating = 'NEEDS IMPROVEMENT';
        else rating = 'DANGEROUS DECISIONS';

        html += '<div class="game-msg" style="margin-top:16px;">FINAL SCORE: ' + s.totalScore + '/' + (s.maxRounds * 100) + '</div>';
        html += '<div class="game-msg" style="font-size:0.7em;">RATING: ' + rating + '</div>';
        html += '<div class="game-btn-row"><button class="game-btn" onclick="GAMES.scenarios.launch(GAMES.scenarios._state.container,\'' + s.userId + '\')">PLAY AGAIN</button></div>';
        GAMES.incStat(s.userId, 'scenarios', 'played', 1);
        const best = GAMES.getStats(s.userId, 'scenarios').high_score;
        if (!best || s.totalScore > parseInt(best)) {
          GAMES.saveStats(s.userId, 'scenarios', {...GAMES.getStats(s.userId,'scenarios'), high_score: s.totalScore, played: (parseInt(GAMES.getStats(s.userId,'scenarios').played)||0)+1});
        }
      } else {
        html += '<div class="game-btn-row"><button class="game-btn" onclick="GAMES.scenarios._next()">NEXT SCENARIO</button></div>';
      }

      s.container.innerHTML = html;
    },

    _next() {
      const s = this._state;
      // Pick a scenario not yet played
      let idx;
      do { idx = Math.floor(Math.random() * s.allScenarios.length); } while (s.played.has(idx) && s.played.size < s.allScenarios.length);
      s.played.add(idx);
      s.scenario = s.allScenarios[idx];
      this._render();
    }
  },

  // ═══════════════════════════════════════════════════════════
  // GAME: Morse Trainer
  // ═══════════════════════════════════════════════════════════
  morse: {
    _state: null,
    launch(container, userId, difficulty) {
      const data = GAMES.getData('morse');
      if (!data) { container.innerHTML = '<div class="game-msg">Game data not synced.</div>'; return; }

      const diff = difficulty || 'beginner';
      let mode = 'decode'; // decode: see morse, type letter. encode: see letter, type morse.
      this._state = { data, diff, mode, userId, container, score: 0, round: 0, maxRounds: 10 };
      this._nextRound();
    },

    _nextRound() {
      const s = this._state;
      if (s.round >= s.maxRounds) {
        this._finish();
        return;
      }

      const drills = s.data.drills[s.diff] || s.data.drills.beginner;
      const char = drills[Math.floor(Math.random() * drills.length)];
      const morse = s.data.alphabet[char];

      s.currentChar = char;
      s.currentMorse = morse;

      let html = '<div style="font-size:0.6em;color:var(--glow-dim);margin-bottom:8px;">Round ' + (s.round+1) + '/' + s.maxRounds + ' | Score: ' + s.score + ' | Mode: ' + s.mode.toUpperCase() + '</div>';

      if (s.mode === 'decode') {
        // Show morse, guess the letter
        html += '<div class="game-board" style="font-size:1.8em;letter-spacing:8px;">' + morse + '</div>';
        html += '<div style="font-size:0.7em;color:var(--glow-dim);margin:4px 0;">What letter/number is this?</div>';
        html += '<input type="text" class="game-input" id="morse-input" maxlength="3" autocomplete="off" spellcheck="false" style="text-transform:uppercase;" onkeydown="if(event.key===\'Enter\')GAMES.morse._check()">';
      } else {
        // Show letter, type the morse
        html += '<div class="game-board" style="font-size:2em;">' + char + '</div>';
        html += '<div style="font-size:0.7em;color:var(--glow-dim);margin:4px 0;">Type the Morse code (dots and dashes)</div>';
        html += '<input type="text" class="game-input" id="morse-input" maxlength="10" autocomplete="off" spellcheck="false" onkeydown="if(event.key===\'Enter\')GAMES.morse._check()">';
      }

      html += '<div class="game-btn-row"><button class="game-btn" onclick="GAMES.morse._check()">SUBMIT</button>';
      html += '<button class="game-btn" onclick="GAMES.morse._toggleMode()">SWITCH TO ' + (s.mode === 'decode' ? 'ENCODE' : 'DECODE') + '</button></div>';
      html += '<div id="morse-msg"></div>';

      // Reference table
      html += '<div style="margin-top:16px;font-size:0.55em;color:var(--glow-dim);max-width:400px;text-align:left;">';
      html += '<div style="margin-bottom:4px;letter-spacing:2px;">REFERENCE:</div>';
      const drillChars = s.data.drills[s.diff] || [];
      drillChars.forEach(c => {
        html += c + ': ' + (s.data.alphabet[c] || '?') + '  ';
      });
      html += '</div>';

      s.container.innerHTML = html;
      s.container.querySelector('#morse-input').focus();
    },

    _check() {
      const s = this._state;
      const input = document.getElementById('morse-input').value.trim().toUpperCase();
      const msg = document.getElementById('morse-msg');

      let correct;
      if (s.mode === 'decode') {
        correct = input === s.currentChar;
      } else {
        // Normalise: accept . and - in various forms
        const normalised = input.replace(/\*/g, '.').replace(/–/g, '-');
        correct = normalised === s.currentMorse;
      }

      if (correct) {
        msg.className = 'game-msg win';
        msg.textContent = 'CORRECT!';
        s.score++;
      } else {
        msg.className = 'game-msg lose';
        msg.textContent = 'WRONG — ' + s.currentChar + ' = ' + s.currentMorse;
      }

      s.round++;
      setTimeout(() => this._nextRound(), 1200);
    },

    _toggleMode() {
      const s = this._state;
      s.mode = s.mode === 'decode' ? 'encode' : 'decode';
      this._nextRound();
    },

    _finish() {
      const s = this._state;
      const pct = Math.round(s.score / s.maxRounds * 100);
      let html = '<div class="game-msg">DRILL COMPLETE</div>';
      html += '<div class="game-board" style="font-size:1.2em;">' + s.score + '/' + s.maxRounds + ' (' + pct + '%)</div>';

      let rating;
      if (pct >= 90) rating = 'EXPERT OPERATOR';
      else if (pct >= 70) rating = 'COMPETENT';
      else if (pct >= 50) rating = 'NEEDS PRACTICE';
      else rating = 'KEEP DRILLING';

      html += '<div class="game-msg" style="font-size:0.7em;">' + rating + '</div>';
      html += '<div class="game-btn-row"><button class="game-btn" onclick="GAMES.morse.launch(GAMES.morse._state.container,\'' + s.userId + '\',\'' + s.diff + '\')">DRILL AGAIN</button></div>';

      GAMES.incStat(s.userId, 'morse', 'played', 1);
      GAMES.incStat(s.userId, 'morse', 'total_correct', s.score);
      GAMES.incStat(s.userId, 'morse', 'total_rounds', s.maxRounds);

      s.container.innerHTML = html;
    }
  },

  // ═══════════════════════════════════════════════════════════
  // GAME: Tic-Tac-Toe
  // ═══════════════════════════════════════════════════════════
  tictactoe: {
    _state: null,
    launch(container, userId, difficulty) {
      const data = GAMES.getData('tictactoe');
      const diff = difficulty || 'medium';
      const mistakeRate = data ? (data.config[diff] || {}).ai_mistakes || 0.15 : 0.15;

      this._state = {
        board: Array(9).fill(''),
        player: 'X',
        ai: 'O',
        turn: 'X',
        mistakeRate,
        userId, container, diff, gameOver: false
      };
      this._render();
    },

    _render() {
      const s = this._state;
      const b = s.board;

      let grid = '';
      for (let r = 0; r < 3; r++) {
        let row = '';
        for (let c = 0; c < 3; c++) {
          const i = r * 3 + c;
          const val = b[i] || ((s.turn === s.player && !s.gameOver) ? ' ' : ' ');
          const clickable = !b[i] && s.turn === s.player && !s.gameOver;
          const style = clickable ? 'cursor:pointer;' : '';
          const onclick = clickable ? ' onclick="GAMES.tictactoe._move(' + i + ')"' : '';
          row += (c > 0 ? ' | ' : '') + '<span style="' + style + (b[i] === 'X' ? 'color:var(--glow-bright);' : b[i] === 'O' ? 'color:var(--red);' : '') + '"' + onclick + '>' + (b[i] || (clickable ? '.' : ' ')) + '</span>';
        }
        grid += (r > 0 ? '\n--+---+--\n' : '') + ' ' + row;
      }

      let html = '<div class="game-board" style="font-size:1.4em;line-height:2;">' + grid + '</div>';

      const winner = this._checkWin(b);
      if (winner) {
        s.gameOver = true;
        if (winner === s.player) {
          html += '<div class="game-msg win">YOU WIN</div>';
          GAMES.incStat(s.userId, 'tictactoe', 'wins', 1);
        } else {
          html += '<div class="game-msg lose">OVERSEER WINS</div>';
          GAMES.incStat(s.userId, 'tictactoe', 'losses', 1);
        }
        GAMES.incStat(s.userId, 'tictactoe', 'played', 1);
        html += '<div class="game-btn-row"><button class="game-btn" onclick="GAMES.tictactoe.launch(GAMES.tictactoe._state.container,\'' + s.userId + '\',\'' + s.diff + '\')">PLAY AGAIN</button></div>';
      } else if (!b.includes('')) {
        s.gameOver = true;
        html += '<div class="game-msg">DRAW</div>';
        GAMES.incStat(s.userId, 'tictactoe', 'draws', 1);
        GAMES.incStat(s.userId, 'tictactoe', 'played', 1);
        html += '<div class="game-btn-row"><button class="game-btn" onclick="GAMES.tictactoe.launch(GAMES.tictactoe._state.container,\'' + s.userId + '\',\'' + s.diff + '\')">PLAY AGAIN</button></div>';
      } else if (s.turn === s.player) {
        html += '<div style="font-size:0.65em;color:var(--glow-dim);">Your move (X). Click a position.</div>';
      }

      s.container.innerHTML = html;
    },

    _move(i) {
      const s = this._state;
      if (s.board[i] || s.gameOver || s.turn !== s.player) return;
      s.board[i] = s.player;
      s.turn = s.ai;
      this._render();

      if (!s.gameOver && s.board.includes('')) {
        setTimeout(() => {
          this._aiMove();
          s.turn = s.player;
          this._render();
        }, 300);
      }
    },

    _aiMove() {
      const s = this._state;
      // Random mistake chance
      if (Math.random() < s.mistakeRate) {
        const empty = s.board.map((v,i) => v === '' ? i : -1).filter(i => i >= 0);
        s.board[empty[Math.floor(Math.random() * empty.length)]] = s.ai;
        return;
      }
      // Minimax
      let bestScore = -Infinity, bestMove = -1;
      for (let i = 0; i < 9; i++) {
        if (s.board[i] !== '') continue;
        s.board[i] = s.ai;
        const score = this._minimax(s.board, false, 0);
        s.board[i] = '';
        if (score > bestScore) { bestScore = score; bestMove = i; }
      }
      if (bestMove >= 0) s.board[bestMove] = s.ai;
    },

    _minimax(board, isMax, depth) {
      const s = this._state;
      const winner = this._checkWin(board);
      if (winner === s.ai) return 10 - depth;
      if (winner === s.player) return depth - 10;
      if (!board.includes('')) return 0;

      if (isMax) {
        let best = -Infinity;
        for (let i = 0; i < 9; i++) {
          if (board[i] !== '') continue;
          board[i] = s.ai;
          best = Math.max(best, this._minimax(board, false, depth+1));
          board[i] = '';
        }
        return best;
      } else {
        let best = Infinity;
        for (let i = 0; i < 9; i++) {
          if (board[i] !== '') continue;
          board[i] = s.player;
          best = Math.min(best, this._minimax(board, true, depth+1));
          board[i] = '';
        }
        return best;
      }
    },

    _checkWin(b) {
      const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
      for (const [a,c,d] of lines) {
        if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a];
      }
      return null;
    }
  },

  // ═══════════════════════════════════════════════════════════
  // LAUNCH — called by the UI to start a game
  // ═══════════════════════════════════════════════════════════
  launch(gameId, container, userId, difficulty) {
    const game = this[gameId];
    if (game && game.launch) {
      game.launch(container, userId, difficulty);
    } else {
      container.innerHTML = '<div class="game-msg">Game not found: ' + gameId + '</div>';
    }
  }
};
