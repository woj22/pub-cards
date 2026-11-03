(function () {
  "use strict";
  const $ = (sel) => document.querySelector(sel);
  const app = $("#app");

  // ---------- small helpers ----------
  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem(k);
        return v == null ? d : JSON.parse(v);
      } catch (e) {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch (e) {}
    },
    del(k) {
      try {
        localStorage.removeItem(k);
      } catch (e) {}
    },
  };
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function code4() {
    const L = "BCDFGHJKLMNPQRSTVWXZ";
    let s = "";
    for (let i = 0; i < 4; i++) s += L[Math.floor(Math.random() * L.length)];
    return s;
  }
  function toast(msg, ms) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    $("#toasts").appendChild(t);
    setTimeout(() => t.remove(), ms || 3500);
  }
  function fill(prompt, cards) {
    let i = 0;
    const parts = esc(prompt).split("_");
    if (parts.length === 1) return esc(prompt) + " <b>" + cards.map(esc).join(" / ") + "</b>";
    return parts.reduce((acc, p, k) => acc + (k ? "<b>" + esc(trimDot(cards[i++] || "____")) + "</b>" : "") + p, "");
  }
  function trimDot(s) {
    return s.replace(/[.!]$/, "");
  }
  function plainFill(prompt, cards) {
    const d = document.createElement("div");
    d.innerHTML = fill(prompt, cards);
    return d.textContent;
  }

  const params = new URLSearchParams(location.search);
  const local = Net.local;

  // In local test mode every tab is its own player, so keep the id per tab.
  function tabId() {
    try {
      let id = sessionStorage.getItem("pc-id");
      if (!id) sessionStorage.setItem("pc-id", (id = Math.random().toString(36).slice(2, 12)));
      return id;
    } catch (e) {
      return Math.random().toString(36).slice(2, 12);
    }
  }
  const myId = local ? tabId() : store.get("pc-id") || Math.random().toString(36).slice(2, 12);
  if (!local) store.set("pc-id", myId);
  let myName = store.get("pc-name", "");

  // ---------- state ----------
  let role = null; // "host" | "guest"
  let code = null;
  let net = null; // host: {send, drop, close}; guest: {send, close}
  let game = null; // host only: full state
  const connPlayer = new Map(); // host only: connId -> playerId
  let v = null; // the view this browser renders
  let ui = { sel: [], custom: "", writing: false };
  let lastSpoken = null;
  let pundit = store.get("pc-pundit", true);
  const calm = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  let sith = store.get("pc-sith", !calm);
  let status = "";

  function rnd() {
    return Math.random();
  }

  function link() {
    const u = new URL(location.href);
    u.search = "";
    u.hash = "";
    u.searchParams.set("room", code);
    if (local) u.searchParams.set("local", "");
    return u.toString().replace("local=", "local");
  }

  // ---------- host ----------
  function hostSave() {
    store.set("pc-host", { code, game, at: Date.now() });
  }

  function hostSync() {
    hostSave();
    for (const [cid, pid] of connPlayer) net.send(cid, { t: "view", v: Core.view(game, pid) });
    setView(Core.view(game, myId));
  }

  function hostHandle(pid, m, cid) {
    let r = { ok: false };
    switch (m.t) {
      case "settings":
        r = Core.updateSettings(game, pid, m.patch || {});
        break;
      case "start":
        r = Core.start(game, pid, rnd);
        break;
      case "play":
        r = Core.play(game, pid, m.plays, rnd);
        break;
      case "judge":
        r = Core.judge(game, pid, Core.entryOwner(game, m.key));
        break;
      case "vote":
        r = Core.vote(game, pid, Core.entryOwner(game, m.key));
        break;
      case "next":
        r = Core.next(game, pid, rnd);
        break;
      case "skip":
        r = Core.skip(game, pid, rnd);
        break;
      case "swap":
        r = Core.swapHand(game, pid, rnd);
        break;
      case "lobby":
        r = Core.backToLobby(game, pid);
        break;
      case "kick":
        r = Core.kick(game, pid, m.id, rnd);
        if (r.ok) {
          for (const [c, p] of connPlayer)
            if (p === m.id) {
              net.send(c, { t: "kicked" });
              net.drop(c);
              connPlayer.delete(c);
            }
        }
        break;
      case "react": {
        const p = game.players.find((x) => x.id === pid);
        const e = String(m.e || "").slice(0, 4);
        if (p && REACTIONS.includes(e)) {
          const msg = { t: "react", e, name: p.name };
          for (const c of connPlayer.keys()) net.send(c, msg);
          showReaction(msg);
        }
        return;
      }
      default:
        return;
    }
    if (!r.ok && r.error) {
      if (cid) net.send(cid, { t: "err", msg: r.error });
      else toast(r.error);
    }
    if (r.ok) hostSync();
  }

  async function startHosting(resume) {
    role = "host";
    if (resume) {
      code = resume.code;
      game = resume.game;
      for (const p of game.players) if (!p.bot && p.id !== myId) p.connected = false;
      const me = game.players.find((p) => p.id === myId);
      if (me) me.connected = true;
    } else {
      code = code4();
      game = Core.newGame(window.PROMPTS, window.ANSWERS, myId, myName);
      Core.updateSettings(game, myId, {});
    }
    status = "Opening the pub…";
    render();
    const handlers = {
      onOpen() {},
      onMsg(cid, m) {
        if (!m || typeof m !== "object") return;
        if (m.t === "hello") {
          const pid = String(m.id || "").slice(0, 24);
          if (!pid || pid === myId || Core.isBotId(pid)) return;
          // One connection per player: a reconnect replaces the old one.
          for (const [c, p] of connPlayer) if (p === pid && c !== cid) connPlayer.delete(c);
          const r = Core.addPlayer(game, pid, m.name);
          if (!r.ok) {
            net.send(cid, { t: "err", msg: r.error, fatal: true });
            return;
          }
          connPlayer.set(cid, pid);
          hostSync();
          return;
        }
        const pid = connPlayer.get(cid);
        if (pid) hostHandle(pid, m, cid);
      },
      onClose(cid) {
        const pid = connPlayer.get(cid);
        connPlayer.delete(cid);
        if (pid && ![...connPlayer.values()].includes(pid)) {
          Core.setConnected(game, pid, false, rnd);
          hostSync();
        }
      },
      onError(err) {
        console.warn(err);
      },
    };
    // If we just reloaded, the broker may still think our old tab owns the
    // code for a few seconds. Keep trying.
    for (let attempt = 0; attempt < 12; attempt++) {
      try {
        net = await Net.host(code, handlers);
        break;
      } catch (err) {
        if (err && err.type === "unavailable-id" && resume) {
          status = "Reopening room " + code + "… (" + (attempt + 1) + ")";
          render();
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
        if (err && err.type === "unavailable-id") {
          code = code4();
          continue;
        }
        status = "";
        role = null;
        toast("Couldn't open a room: " + ((err && (err.type || err.message)) || "unknown error"), 6000);
        render();
        return;
      }
    }
    if (!net) {
      role = null;
      status = "";
      toast("Couldn't reopen that room. Start a new game instead.", 6000);
      render();
      return;
    }
    status = "";
    history.replaceState(null, "", link().replace("room=", "hosting="));
    hostSync();
  }

  // ---------- guest ----------
  let retry = 0;
  async function joinGame(c, quiet) {
    role = "guest";
    code = c.toUpperCase();
    status = quiet ? "Reconnecting…" : "Finding the pub…";
    render();
    try {
      net = await Net.join(code, {
        onMsg(m) {
          if (!m) return;
          if (m.t === "view") {
            retry = 0;
            status = "";
            setView(m.v);
          } else if (m.t === "err") {
            toast(m.msg);
            if (m.fatal) leave();
          } else if (m.t === "react") showReaction(m);
          else if (m.t === "kicked") {
            toast("The host showed you the door.", 6000);
            net = null;
            leave();
          }
        },
        onClose() {
          if (role !== "guest") return;
          net = null;
          reconnect();
        },
      });
      net.send({ t: "hello", id: myId, name: myName });
      history.replaceState(null, "", link());
    } catch (err) {
      net = null;
      if (quiet) return reconnect();
      role = null;
      status = "";
      toast(err.message, 6000);
      render();
    }
  }

  function reconnect() {
    if (retry > 20) {
      status = "";
      role = null;
      v = null;
      toast("Lost the connection to the host.", 6000);
      render();
      return;
    }
    const wait = Math.min(8000, 1000 * Math.pow(1.5, retry++));
    status = "Connection lost. Reconnecting…";
    render();
    setTimeout(() => role === "guest" && !net && joinGame(code, true), wait);
  }

  function leave() {
    const wasHost = role === "host";
    role = null;
    v = null;
    if (net) net.close();
    net = null;
    if (wasHost) store.del("pc-host");
    history.replaceState(null, "", location.pathname + (local ? "?local" : ""));
    render();
  }

  function send(m) {
    if (role === "host") hostHandle(myId, m, null);
    else if (net) net.send(m);
  }

  // ---------- view handling ----------
  function setView(nv) {
    const old = v;
    v = nv;
    const oldRound = old && old.round ? old.roundNo + ":" + old.phase : null;
    const newRound = v.round ? v.roundNo + ":" + v.phase : null;
    if (oldRound !== newRound && v.phase === "playing") {
      ui = { sel: [], custom: "", writing: false };
      if (v.round.event && old && old.roundNo !== v.roundNo) toast(v.round.event.name + "! " + v.round.event.text, 5000);
      if (v.round.gift) toast("Rail Replacement: you got “" + v.round.gift + "”", 5000);
    }
    if ((v.phase === "reveal" || v.phase === "gameover") && lastSpoken !== v.roundNo && v.round && v.round.winners.length) {
      lastSpoken = v.roundNo;
      speakWinner();
      if (window.Sith) Sith.celebrate();
    }
    render();
  }

  function speakWinner() {
    if (!pundit || !("speechSynthesis" in window)) return;
    const r = v.round;
    const e = r.entries.find((x) => r.winners.includes(x.pid));
    if (!e) return;
    const u = new SpeechSynthesisUtterance(plainFill(r.prompt, e.cards));
    const voices = speechSynthesis.getVoices();
    const gb = voices.filter((x) => /en[-_]GB/i.test(x.lang));
    u.voice = gb.find((x) => /male|daniel|ryan|thomas|arthur|george/i.test(x.name)) || gb[0] || null;
    u.lang = "en-GB";
    u.rate = 0.95;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  // ---------- reactions ----------
  const REACTIONS = ["😂", "💀", "🤢", "👏", "🍺", "🫖", "😬"];
  function showReaction(m) {
    const el = document.createElement("div");
    el.className = "float";
    el.style.left = 10 + Math.random() * 80 + "%";
    el.innerHTML = '<span class="emo">' + esc(m.e) + '</span><span class="who">' + esc(m.name) + "</span>";
    $("#floats").appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  // ---------- rendering ----------
  function name(id) {
    const p = v.players.find((x) => x.id === id);
    return p ? p.name : "Someone";
  }

  function render() {
    const active = document.activeElement;
    const keepFocus = active && active.id === "custom";
    let html;
    if (status && !v) html = '<div class="center"><div class="spinner"></div><p>' + esc(status) + "</p></div>";
    else if (!role || !v) html = homeHTML();
    else if (v.phase === "lobby") html = lobbyHTML();
    else html = gameHTML();
    app.innerHTML = (status && v ? '<div class="banner warn">' + esc(status) + "</div>" : "") + html;
    if (keepFocus) {
      const c = $("#custom");
      if (c) {
        c.focus();
        c.setSelectionRange(c.value.length, c.value.length);
      }
    }
  }

  function homeHTML() {
    const join = params.get("room");
    const saved = store.get("pc-host");
    const canResume = saved && saved.game && Date.now() - saved.at < 12 * 3600e3 && saved.game.hostId === myId;
    return (
      '<div class="home">' +
      '<h1 class="logo">Pub<span>Cards</span></h1>' +
      '<p class="tag">A filthy little card game for terrible people. Proper British edition.</p>' +
      '<label class="field">Your name<input id="name" maxlength="20" autocomplete="nickname" value="' +
      esc(myName) +
      '" placeholder="e.g. Big Steve"></label>' +
      (join
        ? '<button class="btn primary" data-act="join" data-code="' + esc(join) + '">Join game ' + esc(join.toUpperCase()) + "</button>" +
          '<button class="btn ghost" data-act="forget">Start my own game instead</button>'
        : '<button class="btn primary" data-act="host">Start a game</button>' +
          (canResume ? '<button class="btn" data-act="resume">Resume game ' + esc(saved.code) + "</button>" : "") +
          '<div class="or">or join a friend</div>' +
          '<div class="row"><input id="code" maxlength="4" placeholder="CODE" autocapitalize="characters" class="code-in">' +
          '<button class="btn" data-act="join">Join</button></div>') +
      '<details class="how"><summary>How to play</summary>' +
      "<p>Each round one player is the judge and reads out a black card. Everyone else plays the funniest white card from their hand. The judge picks a winner, who gets a point. First to the target score wins.</p>" +
      "<p><b>Extras:</b> Up to three bots play random cards and sometimes win, so you can even play on your own. Random events can shake up a round. Write-your-own cards let you go off-script. You can spend a point to swap your whole hand. The Pundit reads out each winning card.</p>" +
      "</details>" +
      (local ? '<p class="small">Local test mode: only works between tabs in this browser.</p>' : "") +
      "</div>"
    );
  }

  function playersHTML(showKick) {
    const r = v.round;
    return (
      '<ul class="players">' +
      v.players
        .slice()
        .sort((a, b) => b.score - a.score)
        .map((p) => {
          let tag = "";
          if (r && v.phase === "playing") tag = r.judgeId === p.id ? "judging" : p.played ? "played" : p.connected ? "thinking…" : "away";
          else if (r && v.phase === "judging" && r.event && r.event.key === "pubVote") tag = p.voted ? "voted" : p.bot ? "" : "voting…";
          else if (!p.connected && !p.bot) tag = "away";
          const cls = [p.id === v.me ? "me" : "", !p.connected && !p.bot ? "off" : "", r && r.judgeId === p.id ? "judge" : ""].join(" ");
          return (
            '<li class="' + cls + '"><span class="pname">' + esc(p.name) + (p.id === v.hostId ? ' <i title="Host">🍺</i>' : "") + (p.bot ? " 🤖" : "") + "</span>" +
            (v.phase !== "lobby" ? '<span class="score">' + p.score + "</span>" : "") +
            (tag ? '<span class="ptag">' + tag + "</span>" : "") +
            (showKick && p.id !== v.me && !p.bot ? '<button class="x" data-act="kick" data-id="' + esc(p.id) + '" title="Remove">×</button>' : "") +
            "</li>"
          );
        })
        .join("") +
      "</ul>"
    );
  }

  function lobbyHTML() {
    const host = v.me === v.hostId;
    const st = v.settings;
    const enough = v.players.filter((p) => p.bot || p.connected).length >= 3;
    return (
      '<div class="lobby">' +
      '<div class="roomcode">Room <b>' + esc(code) + "</b></div>" +
      '<div class="share"><input readonly value="' + esc(link()) + '" id="link"><button class="btn" data-act="share">' + (navigator.share ? "Share" : "Copy") + "</button></div>" +
      "<h3>In the pub (" + v.players.length + ")</h3>" +
      playersHTML(host) +
      (host
        ? '<div class="settings">' +
          '<label>First to <select data-set="target">' + [3, 5, 7, 10, 15].map((n) => "<option" + (n === st.target ? " selected" : "") + ">" + n + "</option>").join("") + "</select> points</label>" +
          '<label>Write-your-own cards each <select data-set="blanks">' + [0, 1, 2, 3, 5].map((n) => "<option" + (n === st.blanks ? " selected" : "") + ">" + n + "</option>").join("") + "</select></label>" +
          '<label>Bots <select data-set="bots">' + [0, 1, 2, 3].map((n) => "<option" + (n === st.bots ? " selected" : "") + ">" + n + "</option>").join("") + "</select> (they play random cards)</label>" +
          '<label class="tog"><input type="checkbox" data-set="events"' + (st.events ? " checked" : "") + "> Random events</label>" +
          "</div>" +
          '<button class="btn primary" data-act="start"' + (enough ? "" : " disabled") + ">" + (enough ? "Start the game" : "Need 3 players: add mates or bots") + "</button>"
        : '<p class="wait">Waiting for ' + esc(name(v.hostId)) + " to start…</p>") +
      punditToggle() +
      '<button class="btn ghost" data-act="leave">Leave</button>' +
      "</div>"
    );
  }

  function punditToggle() {
    return (
      '<label class="tog small"><input type="checkbox" data-act="pundit"' + (pundit ? " checked" : "") + "> The Pundit reads winning cards aloud</label>" +
      '<label class="tog small"><input type="checkbox" data-act="sith"' + (sith ? " checked" : "") + "> Little Sith runs about</label>"
    );
  }

  function promptHTML(r, cards) {
    return '<div class="card black">' + (cards ? fill(r.prompt, cards) : esc(r.prompt).replace(/_/g, "<u>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</u>")) +
      (r.pick > 1 ? '<span class="pick">Pick ' + r.pick + "</span>" : "") + "</div>";
  }

  function gameHTML() {
    const r = v.round;
    const host = v.me === v.hostId;
    const isJudge = r.judgeId === v.me;
    const pubVote = r.event && r.event.key === "pubVote";
    let main = "";
    let head = "";

    if (v.phase === "gameover") {
      const w = v.players.find((p) => p.id === v.winnerId);
      main =
        '<div class="gameover"><div class="trophy">🏆</div><h2>' + esc(w ? w.name : "Somebody") + " wins!</h2>" +
        "<p>Last round:</p>" + revealHTML() +
        (host ? '<button class="btn primary" data-act="lobby">Another game</button>' : '<p class="wait">The host can start another game.</p>') +
        "</div>";
    } else if (v.phase === "playing") {
      if (isJudge) {
        head = '<p class="role">You’re the judge. Read the card out and wait for the others.</p>';
        main = waitingHTML();
      } else if (r.mySub) {
        head = '<p class="role">Played. Waiting for the others…</p>';
        main = '<div class="cards">' + r.mySub.map((c) => '<div class="card white mine">' + esc(c) + "</div>").join("") + "</div>" + waitingHTML();
      } else {
        head = '<p class="role">' + (pubVote ? "Pub Vote round. Play your best card." : esc(r.judgeId ? name(r.judgeId) : "Everyone") + " is judging. Pick " + (r.pick > 1 ? r.pick + " cards, in order." : "your funniest card.")) + "</p>";
        main = handHTML();
      }
    } else if (v.phase === "judging") {
      if (pubVote) {
        head = r.mySub ? (r.myVote ? '<p class="role">Vote in. Waiting for the others…</p>' : '<p class="role">Vote for your favourite. Not your own, cheeky.</p>') : '<p class="role">Everyone else is voting.</p>';
      } else head = isJudge ? '<p class="role">Pick the winner.</p>' : '<p class="role">' + esc(name(r.judgeId)) + " is choosing…</p>";
      const canPick = (isJudge && !pubVote) || (pubVote && r.mySub && !r.myVote);
      main =
        '<div class="entries">' +
        r.entries
          .map(
            (e) =>
              '<button class="entry' + (e.mine ? " mine" : "") + (r.myVote != null && false ? "" : "") + '"' +
              (canPick && !e.mine ? ' data-act="' + (pubVote ? "vote" : "judge") + '" data-key="' + e.key + '"' : " disabled") + ">" +
              '<div class="fill">' + fill(r.prompt, e.cards) + "</div>" + (e.mine ? '<span class="yours">yours</span>' : "") + "</button>"
          )
          .join("") +
        "</div>";
    } else if (v.phase === "reveal") {
      const winNames = r.winners.map(name);
      head = '<p class="role win">' + (winNames.length ? esc(winNames.join(" and ")) + " won" + (r.event && r.event.key === "bankHoliday" ? " double points" : "") + "!" : "No votes, no winner.") + "</p>";
      const canNext = host || r.judgeId === v.me || r.winners.includes(v.me);
      main = revealHTML() + (canNext ? '<button class="btn primary" data-act="next">Next round</button>' : '<p class="wait">Waiting for the next round…</p>');
    }

    const showSkip =
      host &&
      ((v.phase === "playing" && v.players.filter((p) => p.played).length >= 2) || (v.phase === "judging" && (!pubVote ? r.judgeId !== v.me : v.players.some((p) => p.voted))));
    return (
      '<div class="game">' +
      '<div class="top"><span>Round ' + v.roundNo + "</span><span>First to " + v.settings.target + "</span><span>Room " + esc(code) + "</span></div>" +
      (r.event ? '<div class="banner event"><b>' + esc(r.event.name) + "</b> " + esc(r.event.text) + "</div>" : "") +
      (v.phase === "reveal" || v.phase === "gameover" ? "" : promptHTML(r)) +
      head +
      main +
      (showSkip ? '<button class="btn ghost small" data-act="skip">' + (v.phase === "playing" ? "Stop waiting for slowcoaches" : pubVote ? "Count the votes now" : "Judge gone AWOL? Pick at random") + "</button>" : "") +
      '<div class="reacts">' + REACTIONS.map((e) => '<button data-act="react" data-e="' + e + '">' + e + "</button>").join("") + "</div>" +
      "<h3>Scores</h3>" + playersHTML(host) +
      '<ul class="log">' + v.log.slice().reverse().map((l) => "<li>" + esc(l) + "</li>").join("") + "</ul>" +
      punditToggle() +
      '<button class="btn ghost small" data-act="leave">' + (host ? "End game for everyone" : "Leave game") + "</button>" +
      "</div>"
    );
  }

  function waitingHTML() {
    const waiting = v.players.filter((p) => p.id !== v.round.judgeId && !p.played && p.connected && !p.bot);
    return waiting.length ? '<p class="wait">Still thinking: ' + waiting.map((p) => esc(p.name)).join(", ") + "</p>" : "";
  }

  function revealHTML() {
    const r = v.round;
    return (
      '<div class="entries">' +
      r.entries
        .slice()
        .sort((a, b) => (r.winners.includes(b.pid) ? 1 : 0) - (r.winners.includes(a.pid) ? 1 : 0))
        .map(
          (e) =>
            '<div class="entry' + (r.winners.includes(e.pid) ? " won" : "") + '"><div class="fill">' + fill(r.prompt, e.cards) + "</div>" +
            '<span class="by">' + esc(name(e.pid)) + (e.votes ? " · " + e.votes + " vote" + (e.votes > 1 ? "s" : "") : "") + "</span></div>"
        )
        .join("") +
      "</div>"
    );
  }

  function handHTML() {
    const r = v.round;
    const order = (k) => ui.sel.indexOf(k);
    const me = v.players.find((p) => p.id === v.me);
    let h = '<div class="hand">';
    v.hand.forEach((c, i) => {
      const o = order(i);
      h += '<button class="card white' + (o >= 0 ? " sel" : "") + '" data-act="sel" data-i="' + i + '">' + esc(c) + (o >= 0 && r.pick > 1 ? '<span class="num">' + (o + 1) + "</span>" : "") + "</button>";
    });
    if (v.blanks > 0) {
      const o = order("w");
      h +=
        '<div class="card white blank' + (o >= 0 ? " sel" : "") + '">' +
        (ui.writing || o >= 0
          ? '<textarea id="custom" maxlength="80" placeholder="Write your own…">' + esc(ui.custom) + "</textarea>" +
            '<button class="mini" data-act="selw">' + (o >= 0 ? "Selected" + (r.pick > 1 ? " (" + (o + 1) + ")" : "") : "Use this") + "</button>"
          : '<button class="mini" data-act="write">✏️ Write your own (' + v.blanks + " left)</button>") +
        "</div>";
    }
    h += "</div>";
    const ready = ui.sel.length === r.pick && (!ui.sel.includes("w") || ui.custom.trim());
    h += '<div class="actions"><button class="btn primary" data-act="play"' + (ready ? "" : " disabled") + ">Play " + (r.pick > 1 ? "cards" : "card") + "</button>";
    h += '<button class="btn ghost small" data-act="swap"' + (me && me.score >= v.settings.swapCost ? "" : " disabled") + ">Swap hand (costs 1 point)</button></div>";
    return h;
  }

  // ---------- events ----------
  function toggleSel(k) {
    const r = v.round;
    const at = ui.sel.indexOf(k);
    if (at >= 0) ui.sel.splice(at, 1);
    else {
      if (ui.sel.length >= r.pick) ui.sel.shift();
      ui.sel.push(k);
    }
    render();
  }

  function readName() {
    const n = $("#name");
    myName = (n ? n.value : myName).trim().slice(0, 20);
    if (!myName) {
      toast("Put your name in first.");
      if (n) n.focus();
      return false;
    }
    store.set("pc-name", myName);
    return true;
  }

  app.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-act]");
    if (!b || b.disabled) return;
    const act = b.dataset.act;
    switch (act) {
      case "host":
        if (readName()) startHosting(null);
        break;
      case "resume":
        if (readName()) startHosting(store.get("pc-host"));
        break;
      case "forget":
        params.delete("room");
        history.replaceState(null, "", location.pathname + (local ? "?local" : ""));
        render();
        break;
      case "join": {
        const c = (b.dataset.code || ($("#code") && $("#code").value) || "").trim().toUpperCase();
        if (!readName()) break;
        if (!/^[A-Z]{4}$/.test(c)) {
          toast("Room codes are 4 letters.");
          break;
        }
        joinGame(c, false);
        break;
      }
      case "share": {
        const url = link();
        if (navigator.share) navigator.share({ title: "Pub Cards", text: "Come and play Pub Cards. Room " + code, url }).catch(() => {});
        else {
          const done = () => toast("Link copied. Send it to your mates.");
          if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => ($("#link").select(), document.execCommand("copy"), done()));
          else ($("#link").select(), document.execCommand("copy"), done());
        }
        break;
      }
      case "start":
        send({ t: "start" });
        break;
      case "kick":
        if (confirm("Remove " + name(b.dataset.id) + " from the game?")) send({ t: "kick", id: b.dataset.id });
        break;
      case "sel":
        toggleSel(+b.dataset.i);
        break;
      case "write":
        ui.writing = true;
        render();
        $("#custom").focus();
        break;
      case "selw":
        toggleSel("w");
        break;
      case "play": {
        const plays = ui.sel.map((k) => (k === "w" ? { text: ui.custom } : { hand: k }));
        send({ t: "play", plays });
        break;
      }
      case "swap":
        if (confirm("Spend 1 point to swap your whole hand?")) {
          ui.sel = [];
          send({ t: "swap" });
        }
        break;
      case "judge":
        send({ t: "judge", key: +b.dataset.key });
        break;
      case "vote":
        send({ t: "vote", key: +b.dataset.key });
        break;
      case "next":
        send({ t: "next" });
        break;
      case "skip":
        send({ t: "skip" });
        break;
      case "lobby":
        send({ t: "lobby" });
        break;
      case "react":
        send({ t: "react", e: b.dataset.e });
        break;
      case "leave":
        if (confirm(role === "host" ? "End the game for everyone?" : "Leave the game?")) leave();
        break;
    }
  });

  app.addEventListener("change", (ev) => {
    const t = ev.target;
    if (t.dataset.set) {
      const val = t.type === "checkbox" ? t.checked : +t.value;
      send({ t: "settings", patch: { [t.dataset.set]: val } });
    } else if (t.dataset.act === "sith") {
      sith = t.checked;
      store.set("pc-sith", sith);
      if (window.Sith) Sith.enable(sith);
    } else if (t.dataset.act === "pundit") {
      pundit = t.checked;
      store.set("pc-pundit", pundit);
      if (pundit && "speechSynthesis" in window) speechSynthesis.speak(new SpeechSynthesisUtterance("Right then."));
    }
  });

  app.addEventListener("input", (ev) => {
    if (ev.target.id === "custom") {
      const had = !!ui.custom.trim();
      ui.custom = ev.target.value;
      if (!ui.sel.includes("w") && ui.custom.trim()) {
        toggleSel("w");
      } else if (had !== !!ui.custom.trim()) render();
    } else if (ev.target.id === "code") ev.target.value = ev.target.value.toUpperCase().replace(/[^A-Z]/g, "");
  });

  app.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && (ev.target.id === "code" || ev.target.id === "name")) {
      const b = app.querySelector('[data-act="join"], [data-act="host"]');
      if (ev.target.id === "code") app.querySelector('.row [data-act="join"]').click();
      else if (b) b.click();
    }
  });

  if ("speechSynthesis" in window) speechSynthesis.getVoices();
  if (window.Sith) Sith.enable(sith);

  // Host reload: pick the game straight back up.
  const hosting = params.get("hosting");
  const saved = store.get("pc-host");
  if (hosting && saved && saved.code === hosting && saved.game && saved.game.hostId === myId) {
    myName = myName || "Host";
    startHosting(saved);
  } else render();
})();
