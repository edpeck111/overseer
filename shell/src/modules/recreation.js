// RECREATION module -- games, fortune, wiki, reader, chess, zork-lite.
//
// Sprint 15. Hotkey R from HOME. Sub-screens:
//   F -- FORTUNE  random prepper fortune
//   W -- WIKI     wiki roulette (ZIM stub articles)
//   G -- GAMES    game registry (Chess, Zork, Dragon coming S16)
//   C -- CHESS    text-mode chess board
//   Z -- ZORK     bunker adventure
//   R -- READER   reading progress tracker
//
// Green sub-theme (.screen-recreation): --accent #6dcc6d

import { el } from "../chrome/_dom.js";

const SUBS = { F:"fortune", W:"wiki", G:"games", C:"chess", Z:"zork", R:"reader" };

const local = {
  sub: "fortune",
  fortune: null,
  wiki: null,
  games: null,
  // chess
  chessGame: null,
  chessMoveInput: "",
  // zork
  zorkSession: null,
  zorkHistory: [],
  zorkInput: "",
  zorkDone: false,
  // reader
  reading: null,
};

export function mountRecreation(root, store, ctx) {
  const screen = el("div", "screen-recreation recreation");
  root.replaceChildren(screen);
  const tabs = el("div", "kb-tabs");
  const body = el("div", "kb-body");
  screen.append(tabs, body);

  function paint() {
    const labels = ["fortune","wiki","games","chess","zork","reader"];
    const keys   = "FWGCZR";
    tabs.replaceChildren(...labels.map((s, i) => {
      const t = el("span", "kb-tab" + (local.sub === s ? " active" : ""));
      t.append(el("span", "k", keys[i]), el("span", "l", s));
      t.addEventListener("click", () => { local.sub = s; paint(); });
      return t;
    }));
    body.replaceChildren();
    switch (local.sub) {
      case "fortune": paintFortune(body); break;
      case "wiki":    paintWiki(body);    break;
      case "games":   paintGames(body);   break;
      case "chess":   paintChess(body);   break;
      case "zork":    paintZork(body);    break;
      case "reader":  paintReader(body);  break;
    }
  }

  // ── FORTUNE ──────────────────────────────────────────────────────────────
  function paintFortune(c) {
    const hdr = el("div", "rec-hdr");
    hdr.append(el("div", "rec-title", "FORTUNE"));
    const draw = el("button", "kb-btn", "D DRAW");
    hdr.append(draw);
    c.append(hdr);

    if (local.fortune) {
      const box = el("div", "rec-fortune-box");
      const q = el("blockquote", "rec-fortune-quote", local.fortune.quote);
      box.append(q);
      c.append(box);
    } else {
      c.append(el("div", "rec-empty", "Press D to draw a fortune."));
    }

    draw.addEventListener("click", () => {
      fetch("/api/r/fortune").then(r => r.json()).then(d => {
        local.fortune = d; paint();
      });
    });
  }

  // ── WIKI ─────────────────────────────────────────────────────────────────
  function paintWiki(c) {
    const hdr = el("div", "rec-hdr");
    hdr.append(el("div", "rec-title", "WIKI ROULETTE"));
    const spin = el("button", "kb-btn", "S SPIN");
    hdr.append(spin);
    c.append(hdr);

    if (local.wiki) {
      const art = el("div", "rec-article");
      art.append(
        el("div", "rec-article-title", local.wiki.title),
        el("div", "rec-article-body", local.wiki.summary),
        el("div", "rec-article-src rec-dim", "Source: " + local.wiki.zim),
      );
      c.append(art);
    } else {
      c.append(el("div", "rec-empty", "Press S to spin the wiki wheel."));
    }

    spin.addEventListener("click", () => {
      fetch("/api/r/wiki/random").then(r => r.json()).then(d => {
        local.wiki = d; paint();
      });
    });
  }

  // ── GAMES ─────────────────────────────────────────────────────────────────
  function paintGames(c) {
    c.append(el("div", "rec-title", "GAME REGISTRY"));

    if (!local.games) {
      fetch("/api/r/games").then(r => r.json()).then(d => {
        local.games = d.games; paint();
      });
      return;
    }

    const grid = el("div", "rec-games-grid");
    for (const g of local.games) {
      const row = el("div", "rec-game-row" + (g.status === "available" ? " rec-avail" : " rec-coming"));
      const key  = el("span", "k rec-game-key", g.hotkey);
      const name = el("span", "rec-game-name" + (g.status === "available" ? " rec-accent" : " rec-dim"), g.name);
      const stat = el("span", "rec-game-stat rec-dim", g.status);
      row.append(key, name, stat);
      row.addEventListener("click", () => {
        if (g.status !== "available") return;
        const sub = {chess:"chess", zork:"zork", wiki:"wiki", fortune:"fortune", reader:"reader"}[g.id];
        if (sub) { local.sub = sub; paint(); }
      });
      grid.append(row);
    }
    c.append(grid);
  }

  // ── CHESS ─────────────────────────────────────────────────────────────────
  function paintChess(c) {
    const hdr = el("div", "rec-hdr");
    hdr.append(el("div", "rec-title", "CHESS"));
    const newGame = el("button", "kb-btn", "N NEW GAME");
    hdr.append(newGame);
    c.append(hdr);

    if (!local.chessGame) {
      c.append(el("div", "rec-empty", "Press N to start a game."));
    } else {
      const g = local.chessGame;
      const info = el("div", "rec-chess-info");
      info.append(
        el("span", "rec-chess-turn rec-accent",
          "To move: " + g.to_move.toUpperCase()),
        el("span", "rec-dim", " | Moves: " + g.pgn.length),
      );
      c.append(info);

      const board = el("pre", "rec-chess-board", g.board);
      c.append(board);

      const pgn = el("div", "rec-pgn rec-dim rec-mono",
        g.pgn.length ? g.pgn.join(" ") : "(no moves yet)");
      c.append(pgn);

      const moveRow = el("div", "rec-move-row");
      const inp = el("input", "rec-move-inp");
      inp.placeholder = "e4, Nf3, O-O ...";
      inp.value = local.chessMoveInput;
      const submit = el("button", "kb-btn", "ENTER");
      moveRow.append(inp, submit);
      c.append(moveRow);

      const doMove = () => {
        const mv = inp.value.trim();
        if (!mv) return;
        fetch("/api/r/chess/" + g.id + "/move", {
          method: "POST",
          headers: {"Content-Type":"application/json"},
          body: JSON.stringify({move: mv}),
        }).then(r => r.json()).then(d => {
          local.chessGame = d;
          local.chessMoveInput = "";
          paint();
        });
      };
      submit.addEventListener("click", doMove);
      inp.addEventListener("keydown", e => { if (e.key === "Enter") doMove(); });
      inp.focus();
    }

    newGame.addEventListener("click", () => {
      fetch("/api/r/chess/new", {method:"POST", headers:{"Content-Type":"application/json"}, body:"{}"})
        .then(r => r.json()).then(d => { local.chessGame = d; paint(); });
    });
  }

  // ── ZORK ─────────────────────────────────────────────────────────────────
  function paintZork(c) {
    const hdr = el("div", "rec-hdr");
    hdr.append(el("div", "rec-title", "BUNKER ADVENTURE"));
    const startBtn = el("button", "kb-btn", "N NEW GAME");
    hdr.append(startBtn);
    c.append(hdr);

    if (!local.zorkSession) {
      c.append(el("div", "rec-empty", "Press N to enter the bunker."));
    } else {
      const hist = el("div", "rec-zork-hist");
      for (const [cmd, resp] of local.zorkHistory) {
        if (cmd) {
          const cmdEl = el("div", "rec-zork-cmd");
          cmdEl.append(el("span", "rec-accent", "> "), el("span", "", cmd));
          hist.append(cmdEl);
        }
        hist.append(el("div", "rec-zork-resp", resp));
      }
      c.append(hist);

      if (!local.zorkDone) {
        const inputRow = el("div", "rec-zork-input-row");
        const prompt = el("span", "rec-accent", "> ");
        const inp = el("input", "rec-zork-inp");
        inp.placeholder = "look, go north, take torch...";
        inputRow.append(prompt, inp);
        c.append(inputRow);

        inp.focus();
        inp.addEventListener("keydown", e => {
          if (e.key !== "Enter") return;
          const cmd = inp.value.trim();
          if (!cmd) return;
          fetch("/api/r/zork/" + local.zorkSession + "/cmd", {
            method: "POST",
            headers: {"Content-Type":"application/json"},
            body: JSON.stringify({cmd}),
          }).then(r => r.json()).then(d => {
            local.zorkHistory.push([cmd, d.response]);
            local.zorkDone = d.done;
            paint();
            // scroll history to bottom
            setTimeout(() => {
              const h = body.querySelector(".rec-zork-hist");
              if (h) h.scrollTop = h.scrollHeight;
            }, 10);
          });
        });
      } else {
        c.append(el("div", "rec-dim", "-- GAME OVER -- Press N to play again."));
      }
    }

    startBtn.addEventListener("click", () => {
      const sid = "z" + Date.now();
      fetch("/api/r/zork/start", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({session: sid}),
      }).then(r => r.json()).then(d => {
        local.zorkSession = d.session;
        local.zorkHistory = [["", d.response]];
        local.zorkDone = false;
        paint();
      });
    });
  }

  // ── READER ───────────────────────────────────────────────────────────────
  function paintReader(c) {
    const hdr = el("div", "rec-hdr");
    hdr.append(el("div", "rec-title", "READING PROGRESS"));
    const refresh = el("button", "kb-btn", "R REFRESH");
    hdr.append(refresh);
    c.append(hdr);

    if (!local.reading) {
      fetch("/api/r/reader/progress").then(r => r.json()).then(d => {
        local.reading = d.progress; paint();
      });
      return;
    }

    if (local.reading.length === 0) {
      c.append(el("div", "rec-empty", "No reading progress stored yet."));
    } else {
      for (const rp of local.reading) {
        const row = el("div", "rec-reader-row");
        const pct = Math.round(rp.position * 100);
        const bar = el("div", "rec-reader-bar");
        const fill = el("div", "rec-reader-fill");
        fill.style.width = pct + "%";
        bar.append(fill);
        row.append(
          el("div", "rec-reader-title rec-accent", rp.article),
          el("div", "rec-reader-src rec-dim", rp.archive),
          bar,
          el("div", "rec-reader-pct rec-mono", pct + "%"),
        );
        if (rp.bookmark) {
          row.append(el("div", "rec-reader-bk rec-dim", "Bookmark: " + rp.bookmark));
        }
        c.append(row);
      }
    }

    refresh.addEventListener("click", () => { local.reading = null; paint(); });
  }

  // ── keyboard ──────────────────────────────────────────────────────────────
  function onKey(e) {
    const k = e.key.toUpperCase();
    if (SUBS[k]) { local.sub = SUBS[k]; paint(); return; }
  }

  screen.setAttribute("tabindex", "0");
  screen.addEventListener("keydown", onKey);
  screen.focus();
  paint();

  return () => screen.removeEventListener("keydown", onKey);
}
