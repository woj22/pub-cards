// Connections between players. Normally PeerJS (browser to browser, using the
// free public PeerJS broker to introduce players). Add ?local to the URL to use
// BroadcastChannel instead, which only links tabs in one browser: handy for
// testing on your own.
(function (root) {
  "use strict";
  const PREFIX = "pubcards-v1-";
  const local = new URLSearchParams(location.search).has("local");

  function rid() {
    return Math.random().toString(36).slice(2, 10);
  }

  // ---------- BroadcastChannel (testing) ----------
  function localHost(code, h) {
    const bc = new BroadcastChannel(PREFIX + code);
    const conns = new Set();
    bc.onmessage = (e) => {
      const m = e.data;
      if (m.to !== "host") return;
      if (m.kind === "open") {
        conns.add(m.from);
        bc.postMessage({ to: m.from, kind: "ack" });
        h.onOpen(m.from);
      } else if (m.kind === "msg" && conns.has(m.from)) h.onMsg(m.from, m.data);
      else if (m.kind === "close" && conns.delete(m.from)) h.onClose(m.from);
    };
    addEventListener("pagehide", () => bc.postMessage({ to: "all", kind: "close" }));
    return Promise.resolve({
      send(id, data) {
        if (conns.has(id)) bc.postMessage({ to: id, kind: "msg", data });
      },
      drop(id) {
        bc.postMessage({ to: id, kind: "close" });
        conns.delete(id);
      },
      close() {
        bc.close();
      },
    });
  }

  function localJoin(code, h) {
    const bc = new BroadcastChannel(PREFIX + code);
    const me = rid();
    let open = false;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        bc.close();
        reject(new Error("No game found with that code."));
      }, 2500);
      bc.onmessage = (e) => {
        const m = e.data;
        if (m.to !== me && m.to !== "all") return;
        if (m.kind === "ack" && !open) {
          open = true;
          clearTimeout(t);
          resolve({
            send(data) {
              bc.postMessage({ to: "host", from: me, kind: "msg", data });
            },
            close() {
              bc.postMessage({ to: "host", from: me, kind: "close" });
              bc.close();
            },
          });
        } else if (m.kind === "msg") h.onMsg(m.data);
        else if (m.kind === "close") {
          bc.close();
          h.onClose();
        }
      };
      addEventListener("pagehide", () => bc.postMessage({ to: "host", from: me, kind: "close" }));
      bc.postMessage({ to: "host", from: me, kind: "open" });
    });
  }

  // ---------- PeerJS ----------
  function peerHost(code, h) {
    return new Promise((resolve, reject) => {
      const peer = new Peer(PREFIX + code, { debug: 0 });
      const conns = new Map();
      let ready = false;
      peer.on("open", () => {
        ready = true;
        resolve({
          send(id, data) {
            const c = conns.get(id);
            if (c && c.open) c.send(data);
          },
          drop(id) {
            const c = conns.get(id);
            if (c) setTimeout(() => c.close(), 300);
          },
          close() {
            peer.destroy();
          },
        });
      });
      peer.on("connection", (c) => {
        const id = c.connectionId;
        c.on("open", () => {
          conns.set(id, c);
          h.onOpen(id);
        });
        c.on("data", (d) => h.onMsg(id, d));
        const gone = () => {
          if (conns.delete(id)) h.onClose(id);
        };
        c.on("close", gone);
        c.on("error", gone);
      });
      // Lost the broker (wifi blip). Existing players stay connected; this
      // just lets new people find us again.
      peer.on("disconnected", () => {
        if (!peer.destroyed) setTimeout(() => !peer.destroyed && peer.reconnect(), 2000);
      });
      peer.on("error", (err) => {
        if (!ready) {
          peer.destroy();
          reject(err);
        } else if (h.onError) h.onError(err);
      });
    });
  }

  function peerJoin(code, h) {
    return new Promise((resolve, reject) => {
      const peer = new Peer({ debug: 0 });
      let done = false;
      const fail = (msg) => {
        if (done) return;
        done = true;
        peer.destroy();
        reject(new Error(msg));
      };
      const t = setTimeout(() => fail("Couldn't reach the game. Check the code, or ask the host to keep their tab open."), 15000);
      peer.on("open", () => {
        const c = peer.connect(PREFIX + code, { reliable: true });
        c.on("open", () => {
          done = true;
          clearTimeout(t);
          resolve({
            send(data) {
              if (c.open) c.send(data);
            },
            close() {
              peer.destroy();
            },
          });
        });
        c.on("data", (d) => h.onMsg(d));
        c.on("close", lost);
      });
      let gone = false;
      function lost() {
        if (!done || gone) return;
        gone = true;
        peer.destroy();
        h.onClose();
      }
      peer.on("error", (err) => {
        if (err.type === "peer-unavailable") fail("No game found with that code. Is the host's tab still open?");
        else if (!done) fail("Connection problem: " + (err.type || err.message));
        else lost();
      });
    });
  }

  root.Net = {
    local,
    host: local ? localHost : peerHost,
    join: local ? localJoin : peerJoin,
  };
})(this);
