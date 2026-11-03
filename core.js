// Game rules for Pub Cards. Runs only on the host's browser (and in node for
// tests). Pure state in, state out: no DOM, no network.
(function (root) {
  "use strict";

  // "~" never appears in a real player's id, so bots can't be impersonated.
  const BOTS = [
    { id: "~bot1", name: "The Bloke Down the Pub" },
    { id: "~bot2", name: "Big Sandra from Bingo" },
    { id: "~bot3", name: "Your Uncle Clive" },
  ];
  const isBotId = (id) => typeof id === "string" && id.charAt(0) === "~";

  const EVENTS = {
    bankHoliday: { name: "Bank Holiday", text: "Double points this round." },
    railReplacement: { name: "Rail Replacement", text: "Everyone passed a random card to the left." },
    pubVote: { name: "Pub Vote", text: "No judge. Everyone votes for their favourite (not their own)." },
    springClean: { name: "Spring Clean", text: "Everyone got a brand new hand." },
    happyHour: { name: "Happy Hour", text: "Every player gets a free write-your-own card." },
  };
  const EVENT_KEYS = Object.keys(EVENTS);

  function shuffle(arr, rnd) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function blanks(prompt) {
    const n = (prompt.match(/_/g) || []).length;
    return Math.max(1, Math.min(2, n));
  }

  function newGame(prompts, answers, hostId, hostName) {
    return {
      v: 1,
      phase: "lobby",
      hostId,
      settings: { target: 7, handSize: 10, bots: 1, events: true, blanks: 2, swapCost: 1 },
      players: [mkPlayer(hostId, hostName)],
      promptDeck: [],
      answerDeck: [],
      answerDiscard: [],
      prompts,
      answers,
      round: null,
      roundNo: 0,
      judgeIdx: -1,
      log: [],
      winnerId: null,
    };
  }

  function mkPlayer(id, name) {
    return { id, name, score: 0, hand: [], blanks: 0, connected: true, bot: isBotId(id) };
  }

  function humans(s) {
    return s.players.filter((p) => !p.bot);
  }
  function active(s) {
    return s.players.filter((p) => p.bot || p.connected);
  }
  function player(s, id) {
    return s.players.find((p) => p.id === id);
  }

  function note(s, text) {
    s.log.push(text);
    if (s.log.length > 30) s.log.shift();
  }

  function addPlayer(s, id, name) {
    name = String(name || "").trim().slice(0, 20) || "Mystery Guest";
    let p = player(s, id);
    if (p) {
      p.connected = true;
      p.name = name;
      return { ok: true };
    }
    if (s.players.length >= 12) return { ok: false, error: "The pub is full (12 players max)." };
    p = mkPlayer(id, name);
    s.players.push(p);
    if (s.phase !== "lobby") {
      p.blanks = s.settings.blanks;
      deal(s, p, Math.random);
    }
    note(s, name + " walked in.");
    return { ok: true };
  }

  function draw(s, rnd) {
    if (!s.answerDeck.length) {
      s.answerDeck = shuffle(s.answerDiscard, rnd);
      s.answerDiscard = [];
    }
    if (!s.answerDeck.length) {
      s.answerDeck = shuffle(s.answers.map((_, i) => i), rnd);
    }
    return s.answerDeck.pop();
  }

  function deal(s, p, rnd) {
    while (p.hand.length < s.settings.handSize) p.hand.push(draw(s, rnd));
  }

  function setBot(s) {
    const want = BOTS.slice(0, s.settings.bots);
    s.players = s.players.filter((p) => !p.bot || want.some((b) => b.id === p.id));
    for (const b of want) if (!player(s, b.id)) s.players.push(mkPlayer(b.id, b.name));
  }

  function updateSettings(s, by, patch) {
    if (by !== s.hostId || s.phase !== "lobby") return { ok: false };
    const st = s.settings;
    if (patch.target != null) st.target = clamp(+patch.target, 3, 20);
    if (patch.blanks != null) st.blanks = clamp(+patch.blanks, 0, 5);
    if (patch.bots != null) st.bots = clamp(+patch.bots, 0, BOTS.length);
    if (patch.events != null) st.events = !!patch.events;
    setBot(s);
    return { ok: true };
  }

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, isNaN(n) ? lo : Math.round(n)));
  }

  function start(s, by, rnd) {
    if (by !== s.hostId) return { ok: false, error: "Only the host can start." };
    setBot(s);
    if (active(s).length < 3) return { ok: false, error: "You need 3 players. Add a bot or another mate." };
    s.promptDeck = shuffle(s.prompts.map((_, i) => i), rnd);
    s.answerDeck = shuffle(s.answers.map((_, i) => i), rnd);
    s.answerDiscard = [];
    s.roundNo = 0;
    s.judgeIdx = -1;
    s.winnerId = null;
    s.log = [];
    for (const p of s.players) {
      p.score = 0;
      p.hand = [];
      p.blanks = s.settings.blanks;
      deal(s, p, rnd);
    }
    note(s, "Game on! First to " + s.settings.target + " wins.");
    nextRound(s, rnd);
    return { ok: true };
  }

  function pickEvent(s, rnd) {
    if (!s.settings.events || s.roundNo < 2) return null;
    if (rnd() > 0.3) return null;
    let keys = EVENT_KEYS;
    // A pub vote needs at least 3 entries, so at least 3 non-judge voters' worth.
    if (active(s).length < 3) keys = keys.filter((k) => k !== "pubVote");
    return keys[Math.floor(rnd() * keys.length)];
  }

  function nextRound(s, rnd) {
    s.roundNo++;
    if (!s.promptDeck.length) s.promptDeck = shuffle(s.prompts.map((_, i) => i), rnd);
    const promptId = s.promptDeck.pop();
    const event = pickEvent(s, rnd);

    // The judge rotates among connected humans; the bot never judges.
    let judgeId = null;
    if (event !== "pubVote") {
      const ps = s.players;
      for (let k = 1; k <= ps.length; k++) {
        const i = (s.judgeIdx + k) % ps.length;
        if (!ps[i].bot && ps[i].connected) {
          s.judgeIdx = i;
          judgeId = ps[i].id;
          break;
        }
      }
    }

    s.round = {
      promptId,
      pick: blanks(s.prompts[promptId]),
      judgeId,
      event,
      subs: {}, // playerId -> [{card} or {text}]
      order: null, // shuffled list of playerIds once judging starts
      votes: {}, // voterId -> playerId (pub vote)
      winners: [],
      gift: {}, // playerId -> answer id received in Rail Replacement
    };
    s.phase = "playing";

    if (event === "springClean") {
      for (const p of s.players) {
        s.answerDiscard.push(...p.hand);
        p.hand = [];
        deal(s, p, rnd);
      }
    } else if (event === "railReplacement") {
      const ring = s.players.filter((p) => p.hand.length);
      const given = ring.map((p) => p.hand.splice(Math.floor(rnd() * p.hand.length), 1)[0]);
      ring.forEach((p, i) => {
        const card = given[(i - 1 + ring.length) % ring.length];
        p.hand.push(card);
        s.round.gift[p.id] = card;
      });
    } else if (event === "happyHour") {
      for (const p of s.players) if (!p.bot) p.blanks++;
    }
    if (event) note(s, EVENTS[event].name + "! " + EVENTS[event].text);

    for (const bot of s.players.filter((p) => p.bot)) {
      const idx = shuffle(bot.hand.map((_, i) => i), rnd).slice(0, s.round.pick);
      s.round.subs[bot.id] = idx.map((i) => ({ card: bot.hand[i] }));
      bot.hand = bot.hand.filter((_, i) => !idx.includes(i));
    }
    maybeJudge(s, rnd);
  }

  function needToPlay(s) {
    const r = s.round;
    return active(s).filter((p) => p.id !== r.judgeId && !r.subs[p.id]);
  }

  function maybeJudge(s, rnd) {
    if (s.phase !== "playing") return;
    const r = s.round;
    const entries = Object.keys(r.subs);
    if (needToPlay(s).length === 0 && entries.length >= 2) {
      r.order = shuffle(entries, rnd);
      s.phase = "judging";
    }
  }

  // play: an array of {hand: index} or {text: string}
  function play(s, by, plays, rnd) {
    const r = s.round;
    const p = player(s, by);
    if (!p || s.phase !== "playing") return { ok: false, error: "Not now." };
    if (r.judgeId === by) return { ok: false, error: "You're judging this round." };
    if (r.subs[by]) return { ok: false, error: "You've already played." };
    if (!Array.isArray(plays) || plays.length !== r.pick) return { ok: false, error: "Pick " + r.pick + "." };
    const idx = [];
    let texts = 0;
    const sub = [];
    for (const x of plays) {
      if (x && typeof x.text === "string") {
        const t = x.text.trim().slice(0, 80);
        if (!t) return { ok: false, error: "Your card is empty." };
        texts++;
        sub.push({ text: t });
      } else if (x && Number.isInteger(x.hand) && x.hand >= 0 && x.hand < p.hand.length && !idx.includes(x.hand)) {
        idx.push(x.hand);
        sub.push({ card: p.hand[x.hand] });
      } else {
        return { ok: false, error: "That card isn't in your hand." };
      }
    }
    if (texts > p.blanks) return { ok: false, error: "No write-your-own cards left." };
    p.blanks -= texts;
    r.subs[by] = sub;
    p.hand = p.hand.filter((_, i) => !idx.includes(i));
    maybeJudge(s, rnd);
    return { ok: true };
  }

  function award(s, ids) {
    const pts = s.round.event === "bankHoliday" ? 2 : 1;
    s.round.winners = ids;
    for (const id of ids) {
      const p = player(s, id);
      if (p) p.score += pts;
    }
    const names = ids.map((id) => (player(s, id) || {}).name).join(" and ");
    note(s, names + " won round " + s.roundNo + (pts > 1 ? " (double points)" : "") + ".");
    finishRound(s);
  }

  function finishRound(s) {
    for (const sub of Object.values(s.round.subs)) for (const c of sub) if (c.card != null) s.answerDiscard.push(c.card);
    s.phase = "reveal";
    const top = s.players.filter((p) => p.score >= s.settings.target).sort((a, b) => b.score - a.score);
    if (top.length) {
      s.winnerId = top[0].id;
      s.phase = "gameover";
      note(s, top[0].name + " wins the game!");
    }
  }

  function judge(s, by, playerId) {
    const r = s.round;
    if (s.phase !== "judging" || r.event === "pubVote") return { ok: false };
    if (by !== r.judgeId) return { ok: false, error: "You're not the judge." };
    if (!r.subs[playerId]) return { ok: false };
    award(s, [playerId]);
    return { ok: true };
  }

  function voters(s) {
    return s.players.filter((p) => !p.bot && p.connected && s.round.subs[p.id]);
  }

  function vote(s, by, playerId) {
    const r = s.round;
    if (s.phase !== "judging" || r.event !== "pubVote") return { ok: false };
    if (!r.subs[by] || !player(s, by) || player(s, by).bot) return { ok: false, error: "Only players who played can vote." };
    if (playerId === by) return { ok: false, error: "Nice try. You can't vote for yourself." };
    if (!r.subs[playerId]) return { ok: false };
    r.votes[by] = playerId;
    maybeCountVotes(s);
    return { ok: true };
  }

  function maybeCountVotes(s) {
    const r = s.round;
    if (s.phase !== "judging" || r.event !== "pubVote") return;
    if (voters(s).some((p) => !r.votes[p.id])) return;
    const tally = {};
    for (const id of Object.values(r.votes)) tally[id] = (tally[id] || 0) + 1;
    const best = Math.max(0, ...Object.values(tally));
    award(s, best ? Object.keys(tally).filter((id) => tally[id] === best) : []);
  }

  function next(s, by, rnd) {
    if (s.phase !== "reveal") return { ok: false };
    if (by !== s.hostId && by !== s.round.judgeId && !s.round.winners.includes(by)) return { ok: false };
    for (const p of s.players) deal(s, p, rnd);
    nextRound(s, rnd);
    return { ok: true };
  }

  // Host can push things along when someone has wandered off to the bar.
  function skip(s, by, rnd) {
    if (by !== s.hostId) return { ok: false };
    const r = s.round;
    if (s.phase === "playing") {
      if (Object.keys(r.subs).length < 2) return { ok: false, error: "Need at least 2 cards played first." };
      r.order = shuffle(Object.keys(r.subs), rnd);
      s.phase = "judging";
      // Anyone who missed the round keeps their hand untouched.
      return { ok: true };
    }
    if (s.phase === "judging") {
      if (r.event === "pubVote") {
        if (!Object.keys(r.votes).length) return { ok: false, error: "Nobody has voted yet." };
        const tally = {};
        for (const id of Object.values(r.votes)) tally[id] = (tally[id] || 0) + 1;
        const best = Math.max(...Object.values(tally));
        award(s, Object.keys(tally).filter((id) => tally[id] === best));
      } else {
        // The judge has gone AWOL: the host picks at random.
        award(s, [r.order[Math.floor(rnd() * r.order.length)]]);
        note(s, "The judge went to the bar, so a winner was drawn from a hat.");
      }
      return { ok: true };
    }
    return { ok: false };
  }

  function swapHand(s, by, rnd) {
    const p = player(s, by);
    if (!p || s.phase !== "playing" || s.round.subs[by]) return { ok: false };
    const cost = s.settings.swapCost;
    if (p.score < cost) return { ok: false, error: "You're skint. You need a point to swap your hand." };
    p.score -= cost;
    s.answerDiscard.push(...p.hand);
    p.hand = [];
    deal(s, p, rnd);
    note(s, p.name + " paid a point for a fresh hand.");
    return { ok: true };
  }

  function setConnected(s, id, on, rnd) {
    const p = player(s, id);
    if (!p || p.bot) return;
    p.connected = on;
    if (s.phase === "lobby" && !on && id !== s.hostId) {
      s.players = s.players.filter((x) => x.id !== id);
      return;
    }
    if (!on && s.round && s.phase !== "lobby") {
      if (s.round.judgeId === id && (s.phase === "playing" || s.phase === "judging")) {
        // Judge left: hand the gavel to the next person still here.
        const r = s.round;
        note(s, p.name + " left while judging, so the round was restarted.");
        for (const q of s.players) {
          if (r.subs[q.id]) {
            // Give played cards back so nobody loses out.
            for (const c of r.subs[q.id]) if (c.card != null) q.hand.push(c.card);
            q.blanks += r.subs[q.id].filter((c) => c.text != null).length;
          }
        }
        s.promptDeck.push(r.promptId);
        s.roundNo--;
        nextRound(s, rnd);
        return;
      }
      maybeJudge(s, rnd);
      if (s.phase === "judging") maybeCountVotes(s);
    }
  }

  function kick(s, by, id, rnd) {
    if (by !== s.hostId || id === s.hostId || isBotId(id)) return { ok: false };
    setConnected(s, id, false, rnd);
    const p = player(s, id);
    if (p) {
      s.answerDiscard.push(...p.hand);
      s.players = s.players.filter((x) => x.id !== id);
      note(s, p.name + " was shown the door.");
    }
    return { ok: true, kicked: id };
  }

  function backToLobby(s, by) {
    if (by !== s.hostId || s.phase !== "gameover") return { ok: false };
    s.phase = "lobby";
    s.round = null;
    s.players = s.players.filter((p) => p.bot || p.connected);
    for (const p of s.players) {
      p.score = 0;
      p.hand = [];
    }
    return { ok: true };
  }

  // What one player is allowed to see.
  function view(s, forId) {
    const r = s.round;
    const me = player(s, forId);
    const out = {
      phase: s.phase,
      hostId: s.hostId,
      me: forId,
      settings: s.settings,
      roundNo: s.roundNo,
      log: s.log.slice(-6),
      winnerId: s.winnerId,
      players: s.players.map((p) => ({
        id: p.id,
        name: p.name,
        score: p.score,
        bot: p.bot,
        connected: p.connected,
        played: !!(r && r.subs[p.id]),
        voted: !!(r && r.votes[p.id]),
      })),
      hand: me ? me.hand.map((id) => s.answers[id]) : [],
      blanks: me ? me.blanks : 0,
      round: null,
    };
    if (r) {
      const reveal = s.phase === "reveal" || s.phase === "gameover";
      out.round = {
        prompt: s.prompts[r.promptId],
        pick: r.pick,
        judgeId: r.judgeId,
        event: r.event ? { key: r.event, ...EVENTS[r.event] } : null,
        mySub: r.subs[forId] ? r.subs[forId].map((c) => text(s, c)) : null,
        gift: r.gift[forId] != null ? s.answers[r.gift[forId]] : null,
        myVote: r.votes[forId] || null,
        entries:
          s.phase === "playing"
            ? null
            : (r.order || Object.keys(r.subs)).map((pid) => ({
                pid: reveal || pid === forId ? pid : null,
                key: pid,
                cards: r.subs[pid].map((c) => text(s, c)),
                votes: reveal ? Object.values(r.votes).filter((v) => v === pid).length : undefined,
                mine: pid === forId,
              })),
        winners: reveal ? r.winners : [],
      };
      // Entries are keyed by playerId so the judge's pick can be sent back.
      // Before the reveal the key is an opaque index so nobody can tell whose
      // card is whose by reading messages.
      if (out.round.entries && !reveal) {
        out.round.entries.forEach((e, i) => {
          e.key = i;
        });
      }
    }
    return out;
  }

  function text(s, c) {
    return c.text != null ? c.text : s.answers[c.card];
  }

  // Map an entry index from a view back to a player id.
  function entryOwner(s, key) {
    const r = s.round;
    if (!r || !r.order) return null;
    return r.order[key] || null;
  }

  const api = {
    isBotId,
    EVENTS,
    newGame,
    addPlayer,
    updateSettings,
    start,
    play,
    judge,
    vote,
    next,
    skip,
    swapHand,
    setConnected,
    kick,
    backToLobby,
    view,
    entryOwner,
    blanks,
  };
  if (typeof module !== "undefined") module.exports = api;
  else root.Core = api;
})(this);
