// Isolated-world core: namespace, settings, the bridge to page.js, and error containment.
// Content scripts are plain scripts loaded in manifest order and share this `CL` namespace.
(() => {
  if (globalThis.CL) return;
  const CL = (globalThis.CL = {});
  const U = globalThis.CLU;

  CL.log = (...a) => console.log("[Cinnamon Label]", ...a);
  CL.warn = (...a) => console.warn("[Cinnamon Label]", ...a);

  CL.DEFAULTS = {
    enabled: true, // master switch (popup)
    connections: 3, // parallel range requests per download (HTTP/1.1: 6 per site; keep room for the player and Label Studio's API)
    cacheLimitGB: 2,
    devReload: false,
  };
  CL.settings = () => new Promise((r) => chrome.storage.sync.get(CL.DEFAULTS, r));
  CL.alive = () => {
    try {
      return !!chrome.runtime?.id; // false once the extension was reloaded (orphaned script)
    } catch (_) {
      return false;
    }
  };

  // ---------- mode: "cinnamon" (our UI) or "native" (Label Studio's). page.js reads it too. ----------
  const MODE_KEY = "cinnamonLabel.mode";
  CL.getMode = () => {
    try {
      return localStorage.getItem(MODE_KEY) === "native" ? "native" : "cinnamon";
    } catch (_) {
      return "native";
    }
  };
  CL.setMode = (m) => {
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch (_) {}
  };
  // Tells page.js whether to hold Label Studio's waveform request for us (see bridge.js).
  CL.setActive = (on) => {
    try {
      localStorage.setItem("cinnamonLabel.active", on ? "1" : "0");
    } catch (_) {}
  };

  // ---------- RPC to page.js ----------
  const CH = "CL_BRIDGE_v1";
  let seq = 0;
  const pending = new Map();
  const pageListeners = new Set();
  window.addEventListener("message", (ev) => {
    if (ev.source !== window || ev.origin !== location.origin) return;
    const m = ev.data;
    if (!m || m.ch !== CH || m.dir !== "toContent") return;
    if (m.op) {
      pageListeners.forEach((fn) => CL.guard(fn)(m));
      return;
    }
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    m.ok ? p.resolve(m.data) : p.reject(new Error(m.data));
  });
  CL.page = (op, args = {}, timeoutMs = 3000) =>
    new Promise((resolve, reject) => {
      const id = "c" + ++seq;
      pending.set(id, { resolve, reject });
      window.postMessage({ ch: CH, dir: "toPage", id, op, args }, location.origin);
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error("The page did not answer (" + op + ")."));
      }, timeoutMs);
    });
  CL.onPage = (fn) => pageListeners.add(fn);

  // ---------- error containment: any error in our code puts the page back to native ----------
  let failHandler = null;
  CL.onFail = (fn) => (failHandler = fn);
  CL.fail = (err) => {
    CL.warn("Switched to the native UI after an error:", err);
    try {
      failHandler && failHandler(err);
    } catch (e) {
      CL.warn("Fail handler error:", e);
    }
  };
  CL.guard = (fn) =>
    function guarded(...args) {
      try {
        const r = fn.apply(this, args);
        if (r && typeof r.then === "function") return r.catch((e) => CL.fail(e));
        return r;
      } catch (e) {
        CL.fail(e);
      }
    };
  CL.on = (el, type, fn, opts) => el.addEventListener(type, CL.guard(fn), opts);

  CL.U = U;
})();
