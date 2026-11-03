// A little Sith who runs along the bottom of the screen, jumps about and
// shows off with his lightsaber. Purely decorative: he never blocks clicks.
(function (root) {
  "use strict";
  const SHEET = { src: "img/sith.png", w: 242, h: 116, foot: 109 };
  const A = {
    idle: [0, 1, 2, 3],
    run: [4, 5, 6, 7],
    crouch: [9],
    rise: [10],
    apex: [11],
    fall: [12],
    land: [13, 14],
    slash: [15, 16, 17],
    spin: [18, 19, 20, 18, 19, 20],
    dash: [21, 22, 23],
  };
  const SCALE = 0.7;
  const W = SHEET.w * SCALE;
  const GROUND = 4; // px above the bottom edge
  const SPEED = 150; // px per second
  const GRAVITY = 1500;

  let el = null;
  let on = false;
  let raf = 0;
  let last = 0;
  const s = { x: 60, y: 0, vy: 0, dir: 1, state: "run", t: 0, frame: 0, next: 2, queue: [] };

  function make() {
    el = document.createElement("div");
    el.className = "sith";
    el.setAttribute("aria-hidden", "true");
    Object.assign(el.style, {
      position: "fixed",
      left: "0",
      bottom: "0",
      width: W + "px",
      height: SHEET.h * SCALE + "px",
      backgroundImage: "url(" + SHEET.src + ")",
      backgroundRepeat: "no-repeat",
      backgroundSize: 24 * W + "px " + SHEET.h * SCALE + "px",
      imageRendering: "pixelated",
      pointerEvents: "none",
      zIndex: 8,
      willChange: "transform",
    });
    document.body.appendChild(el);
  }

  function set(state) {
    s.state = state;
    s.t = 0;
  }

  function anim(name, fps, loop) {
    const f = A[name];
    const i = Math.floor(s.t * fps);
    return { frame: f[loop ? i % f.length : Math.min(i, f.length - 1)], done: !loop && i >= f.length };
  }

  function jump(power) {
    s.vy = power || 560 + Math.random() * 180;
    set("crouch");
  }

  function decide() {
    const r = Math.random();
    if (r < 0.35) jump();
    else if (r < 0.5) set("slash");
    else if (r < 0.6) set("spin");
    else if (r < 0.72) set("dash");
    else if (r < 0.85) set("idle");
    s.next = 1.5 + Math.random() * 3;
  }

  function step(dt) {
    const maxX = innerWidth - W * 0.25;
    const minX = W * 0.25;
    s.t += dt;
    let frame;
    switch (s.state) {
      case "run": {
        frame = anim("run", 11, true).frame;
        s.x += s.dir * SPEED * dt;
        s.next -= dt;
        if (s.queue.length) set(s.queue.shift());
        else if (s.next <= 0) decide();
        break;
      }
      case "idle": {
        frame = anim("idle", 6, true).frame;
        if (s.t > 1.2) set("run");
        break;
      }
      case "crouch": {
        frame = A.crouch[0];
        if (s.t > 0.09) set("air");
        break;
      }
      case "air": {
        s.vy -= GRAVITY * dt;
        s.y += s.vy * dt;
        s.x += s.dir * SPEED * 1.15 * dt;
        frame = s.vy > 250 ? A.rise[0] : s.vy > -200 ? A.apex[0] : A.fall[0];
        if (s.y <= 0) {
          s.y = 0;
          s.vy = 0;
          set("land");
        }
        break;
      }
      case "land": {
        const a = anim("land", 10, false);
        frame = a.frame;
        if (a.done) set("run");
        break;
      }
      case "slash":
      case "spin": {
        const a = anim(s.state, s.state === "spin" ? 14 : 9, false);
        frame = a.frame;
        if (a.done) set("run");
        break;
      }
      case "dash": {
        const a = anim("dash", 8, false);
        frame = a.frame;
        s.x += s.dir * SPEED * 2.6 * dt;
        if (a.done) set("run");
        break;
      }
    }
    // Hitting the edge of the screen: turn round, sometimes with a hop.
    if (s.x > maxX || s.x < minX) {
      s.x = Math.max(minX, Math.min(maxX, s.x));
      s.dir = s.x >= maxX ? -1 : 1;
      if (s.state === "run" && Math.random() < 0.4) jump(480);
    }
    const px = s.x - W / 2;
    const py = -(GROUND + s.y) + (SHEET.h - SHEET.foot) * SCALE;
    el.style.transform = "translate(" + px.toFixed(1) + "px," + py.toFixed(1) + "px) scaleX(" + s.dir + ")";
    el.style.backgroundPosition = -frame * W + "px 0";
  }

  function loop(t) {
    const dt = Math.min(0.05, (t - (last || t)) / 1000);
    last = t;
    step(dt);
    raf = requestAnimationFrame(loop);
  }

  function enable(yes) {
    if (yes === on) return;
    on = yes;
    if (on) {
      if (!el) make();
      el.style.display = "";
      s.x = Math.min(s.x, innerWidth - W);
      last = 0;
      raf = requestAnimationFrame(loop);
    } else {
      cancelAnimationFrame(raf);
      if (el) el.style.display = "none";
    }
  }

  // Someone won a round: a spin, then a victory leap.
  function celebrate() {
    if (!on) return;
    s.queue = ["spin"];
    setTimeout(() => s.state === "run" && jump(820), 900);
  }

  root.Sith = { enable, celebrate };
})(this);
