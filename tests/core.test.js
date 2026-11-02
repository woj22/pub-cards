const assert = require("assert");
const C = require("../core.js");
global.window = {}; require("../cards.js");
const P = window.PROMPTS, A = window.ANSWERS;
assert(P.length >= 60 && A.length >= 250, "deck size");
assert.strictEqual(new Set(A).size, A.length, "duplicate answers");
for (let seed = 1; seed <= 300; seed++) {
  let x = seed; const rnd = () => ((x = (x * 16807) % 2147483647) / 2147483647);
  const s = C.newGame(P, A, "h", "Host");
  const n = 2 + (seed % 5);
  for (let i = 1; i < n; i++) C.addPlayer(s, "p" + i, "P" + i);
  C.updateSettings(s, "h", { bot: seed % 2 === 0, events: true, target: 5 });
  const r0 = C.start(s, "h", rnd);
  if (!r0.ok) { assert(n === 2 && seed % 2 === 1, r0.error); continue; }
  let steps = 0;
  while (s.phase !== "gameover" && steps++ < 2000) {
    const humans = s.players.filter((p) => !p.bot && p.connected);
    if (s.phase === "playing") {
      for (const p of humans) {
        const v = C.view(s, p.id);
        if (v.round.judgeId === p.id || v.round.mySub) continue;
        assert.strictEqual(v.hand.length, 10, "hand size " + v.hand.length);
        if (rnd() < 0.05) C.swapHand(s, p.id, rnd);
        const plays = [];
        for (let k = 0; k < v.round.pick; k++) plays.push(k === 0 && v.blanks && rnd() < 0.2 ? { text: "custom" } : { hand: k });
        const res = C.play(s, p.id, plays, rnd); assert(res.ok, res.error);
        if (s.phase !== "playing") break;
      }
      if (seed % 7 === 0 && s.phase === "playing" && rnd() < 0.1) C.skip(s, "h", rnd);
    } else if (s.phase === "judging") {
      const v = C.view(s, "h");
      assert(v.round.entries.every((e) => e.pid === null || e.mine));
      if (v.round.event && v.round.event.key === "pubVote") {
        for (const p of humans) {
          const pv = C.view(s, p.id);
          if (!pv.round.mySub) continue;
          const e = pv.round.entries.find((e) => !e.mine);
          C.vote(s, p.id, C.entryOwner(s, e.key));
          if (s.phase !== "judging") break;
        }
      } else {
        const jid = s.round.judgeId;
        const e = C.view(s, jid).round.entries[0];
        assert(C.judge(s, jid, C.entryOwner(s, e.key)).ok);
      }
    } else if (s.phase === "reveal") {
      assert(C.next(s, "h", rnd).ok);
    }
    // occasional disconnect/reconnect of p1
    if (seed % 5 === 0 && rnd() < 0.05) { C.setConnected(s, "p1", false, rnd); C.setConnected(s, "p1", true, rnd); }
  }
  assert.strictEqual(s.phase, "gameover", "seed " + seed + " stuck in " + s.phase);
  // No card duplicated across hands/decks
  const all = [...s.answerDeck, ...s.answerDiscard, ...s.players.flatMap((p) => p.hand)];
  assert(new Set(all).size === all.length, "duplicate card ids seed " + seed);
}
console.log("core ok");
