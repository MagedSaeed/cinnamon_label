// Lifecycle: follows Label Studio's task (single-page navigation), owns one Task at a time,
// switches between Cinnamon Label and the native UI, and falls back to native on any error.
// Nothing here submits, updates, skips or saves anything in Label Studio.
(() => {
  const CL = globalThis.CL;
  const U = CL.U;
  if (CL.started) return;
  CL.started = true;

  let settings = null;
  let ui = null;
  let player = null;
  let task = null; // current Task
  let failedTaskId = null; // task where we hit an error; stays native until the user retries
  let stopped = false;
  const timers = [];

  // ---------- Label Studio's waveform request (held by page.js) ----------
  const held = new Map(); // request id -> media key

  function serveWaveform(key, blob) {
    for (const [id, k] of held) {
      if (k !== key) continue;
      held.delete(id);
      CL.page("waveformServe", { id, blob }).catch(CL.warn);
    }
  }
  function releaseWaveform(key) {
    for (const [id, k] of held) {
      if (key && k !== key) continue;
      held.delete(id);
      CL.page("waveformRelease", { id }).catch(() => {});
    }
  }
  CL.onPage((m) => {
    if (m.op !== "waveformWanted") return;
    const key = U.mediaKey(m.url, location.href);
    // Serve it in either UI mode (switching to native triggers this request too), unless we
    // won't have this file: then Label Studio downloads it as usual.
    const notOurs = task && (task.key !== key || task.failed);
    if (stopped || !settings?.enabled || notOurs || failedTaskId != null) {
      CL.page("waveformRelease", { id: m.id }).catch(() => {});
      return;
    }
    held.set(m.id, key);
    CL.page("waveformClaim", { id: m.id }).catch(() => {});
    if (task && task.blob) serveWaveform(key, task.blob);
  });
  // A request claimed before its task existed, for a different file: give it back.
  function releaseForeign() {
    for (const [id, k] of held) {
      if (task && k === task.key) continue;
      held.delete(id);
      CL.page("waveformRelease", { id }).catch(() => {});
    }
  }

  // ---------- one task ----------
  class Task {
    constructor(st) {
      this.taskId = st.taskId;
      this.url = new URL(st.mediaUrl, location.href).href;
      this.key = U.mediaKey(this.url);
      this.name = decodeURIComponent((this.key.split("?d=")[1] || this.key).split("/").pop());
      this.blob = null;
      this.dl = null;
      this.dead = false;
      this.failed = false;
    }

    async start() {
      this.failed = false;
      ui.setTask(this.taskId);
      ui.setNet({ kind: "checking" });
      let cached = null;
      try {
        cached = await CL.cache.get(this.key);
      } catch (e) {
        CL.warn("Could not read the saved copy:", e);
      }
      if (this.dead) return;
      if (cached) {
        this.blob = cached;
        await player.setBlob(cached);
        ui.setNet({ kind: "cached", total: cached.size });
        serveWaveform(this.key, cached);
        return;
      }

      player.setNetwork(this.url);
      this.dl = new CL.Downloader(this.url, {
        connections: settings.connections,
        onProgress: (p) => !this.dead && ui.setNet({ kind: "downloading", ...p }),
      });
      let blob;
      try {
        blob = await this.dl.run();
      } catch (e) {
        if (this.dead) return;
        CL.warn("Download failed:", e);
        this.failed = true;
        ui.setNet({ kind: "error", message: e.message || String(e), retry: CL.guard(() => this.start()) });
        releaseWaveform(this.key); // let Label Studio fetch its waveform itself
        return;
      }
      if (this.dead) return;
      this.blob = blob;
      await player.setBlob(blob);
      serveWaveform(this.key, blob);
      ui.setNet({ kind: "saving", total: blob.size });
      const r = await CL.cache
        .put(this.key, blob, settings.cacheLimitGB * 1e9, { taskId: this.taskId, name: this.name })
        .catch((e) => ({ saved: false, reason: String(e) }));
      if (!this.dead) ui.setNet(r.saved ? { kind: "saved", total: blob.size } : { kind: "memory", total: blob.size, reason: r.reason });
    }

    destroy() {
      this.dead = true;
      if (this.dl) this.dl.abort();
      player.reset();
      releaseWaveform(this.key);
    }
  }

  // ---------- Label Studio's own <video>/<audio> ----------
  // The site uses HTTP/1.1, so Chrome opens at most 6 connections to it. Label Studio's two hidden
  // media elements each hold one while buffering, which starves our player and, worse, Label
  // Studio's own API calls (draft saves, Submit). In Cinnamon mode they are "parked": their source
  // URLs are stashed and removed. Switching to the native UI restores them, pointing at the
  // downloaded copy when we have it (so the native UI plays without stalls too).
  // Ours live in a shadow root and are never matched by document.querySelectorAll.
  const MEDIA_RE = /\/data\/local-files\//;
  const parked = new Set();
  const isTaskMedia = (m) =>
    MEDIA_RE.test(m.getAttribute("src") || "") || [...m.querySelectorAll("source")].some((s) => MEDIA_RE.test(s.getAttribute("src") || ""));

  function parkNativeMedia() {
    document.querySelectorAll("video, audio").forEach((m) => {
      if (!m.paused) m.pause();
      if (!isTaskMedia(m)) return; // already parked, or not Label Studio's task media
      if (m.hasAttribute("src")) {
        m.dataset.clSrc = m.getAttribute("src");
        m.removeAttribute("src");
      }
      m.querySelectorAll("source").forEach((s) => {
        if (!s.hasAttribute("src")) return;
        s.dataset.clSrc = s.getAttribute("src");
        s.removeAttribute("src");
      });
      m.load(); // drops the connection
      parked.add(m);
    });
  }

  let nativeBlobUrl = null; // object URL handed to Label Studio's elements; lives as long as the task
  function unparkNativeMedia() {
    const url = task && task.blob ? (nativeBlobUrl ||= URL.createObjectURL(task.blob)) : null;
    for (const m of parked) {
      parked.delete(m);
      if (!m.isConnected) continue;
      if (m.dataset.clSrc != null) {
        m.setAttribute("src", url || m.dataset.clSrc);
        delete m.dataset.clSrc;
      }
      m.querySelectorAll("source").forEach((s) => {
        if (s.dataset.clSrc == null) return;
        s.setAttribute("src", url || s.dataset.clSrc);
        delete s.dataset.clSrc;
      });
      m.load();
    }
  }
  function dropNativeBlobUrl() {
    if (nativeBlobUrl) URL.revokeObjectURL(nativeBlobUrl);
    nativeBlobUrl = null;
  }

  function render(st) {
    const anchor = document.querySelector(".lsf-main-view");
    const onTask = !!(st && st.ready && st.mediaUrl && anchor);
    if (!onTask) {
      ui.show(false);
      ui.showPill(false);
      return;
    }
    ui.setAnchor(anchor);
    const failedHere = failedTaskId === st.taskId;
    const ours = CL.getMode() === "cinnamon" && !failedHere;
    ui.show(ours);
    ui.showPill(!ours, failedHere ? "Cinnamon Label hit an error on this task and switched to the native UI." : "");
    if (ours) parkNativeMedia();
    else unparkNativeMedia();
  }

  async function poll() {
    if (stopped) return;
    if (!CL.alive()) return shutdown(); // extension reloaded: leave the page fully native
    const st = await CL.page("state").catch(() => null);
    if (stopped) return;
    const usable = st && st.ready && st.mediaUrl;
    if (!usable) {
      if (task) {
        task.destroy();
        task = null;
      }
    } else if (!task || task.taskId !== st.taskId) {
      if (task) task.destroy();
      task = null;
      parked.clear(); // Label Studio renders new media elements for the new task
      dropNativeBlobUrl();
      if (failedTaskId !== st.taskId) {
        task = new Task(st);
        CL.guard(() => task.start())();
      }
      releaseForeign();
    }
    render(st);
  }

  function setMode(mode) {
    CL.setMode(mode);
    if (mode === "native") {
      player && player.v.pause();
    } else {
      failedTaskId = null;
    }
    poll();
  }

  function shutdown() {
    stopped = true;
    if (!CL.alive()) CL.setActive(false); // nobody left to serve held requests
    timers.forEach(clearInterval);
    try {
      unparkNativeMedia(); // give Label Studio its media back before anything else
    } catch (_) {}
    try {
      if (task) task.destroy();
    } catch (_) {}
    task = null;
    releaseWaveform(null);
    if (ui) ui.destroy();
    ui = null;
  }

  // ---------- keyboard: only the universal ones, and only when not typing ----------
  const isTyping = (e) => {
    const t = (e.composedPath && e.composedPath()[0]) || e.target;
    if (!t || !t.tagName) return false;
    if (t.isContentEditable) return true;
    if (t.tagName === "TEXTAREA" || t.tagName === "SELECT") return true;
    if (t.tagName === "INPUT") return !["range", "button", "checkbox", "radio", "submit", "reset"].includes((t.type || "").toLowerCase());
    return false;
  };
  let swallowSpaceUp = false;
  function onKeyDown(e) {
    if (stopped || !ui || !ui.visible || !task) return;
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || isTyping(e)) return;
    if (e.code === "Space") {
      if (!e.repeat) player.toggle();
      swallowSpaceUp = true;
    } else if (e.code === "ArrowLeft") player.seekBy(-5);
    else if (e.code === "ArrowRight") player.seekBy(5);
    else return;
    e.preventDefault();
    e.stopImmediatePropagation(); // keep Label Studio's own hotkeys from also reacting
  }
  function onKeyUp(e) {
    if (e.code === "Space" && swallowSpaceUp) {
      swallowSpaceUp = false;
      e.preventDefault(); // a focused button would otherwise "click" on Space release
      e.stopImmediatePropagation();
    }
  }

  // ---------- start ----------
  async function start() {
    settings = await CL.settings();
    CL.setActive(settings.enabled);
    if (!settings.enabled) {
      CL.setMode("native");
      return;
    }
    try {
      if (!localStorage.getItem("cinnamonLabel.mode")) CL.setMode("cinnamon");
    } catch (_) {}
    await CL.cache.applyQueuedDeletes().catch(CL.warn);

    ui = CL.createOverlay();
    player = new CL.Player(ui.video);
    ui.bindPlayer(player);
    ui.onNative(() => setMode("native"));
    ui.onBack(() => setMode("cinnamon"));

    CL.onFail(() => {
      failedTaskId = task ? task.taskId : failedTaskId;
      try {
        unparkNativeMedia();
      } catch (_) {}
      try {
        if (task) task.destroy();
      } catch (_) {}
      task = null;
      releaseWaveform(null);
      try {
        poll();
      } catch (_) {}
    });

    window.addEventListener("keydown", CL.guard(onKeyDown), true);
    window.addEventListener("keyup", CL.guard(onKeyUp), true);

    chrome.storage.onChanged.addListener(
      CL.guard(async (changes, area) => {
        if (area === "sync") {
          settings = await CL.settings();
          CL.setActive(settings.enabled);
          if (!settings.enabled) {
            CL.setMode("native");
            shutdown();
          }
        }
        if (area === "local" && changes.clCacheDeletes) await CL.cache.applyQueuedDeletes();
      })
    );

    timers.push(setInterval(CL.guard(poll), 500));
    // Development: lets the background reload the extension when its files change (opt-in).
    timers.push(
      setInterval(() => {
        if (!CL.alive()) return;
        try {
          chrome.runtime.sendMessage({ type: "CL_DEV_TICK", dirty: false }, (r) => {
            if (chrome.runtime.lastError) return;
            const host = document.getElementById("cinnamon-label-root");
            if (host) host.dataset.dev = JSON.stringify(r || null); // visible in DevTools; nothing reads it
          });
        } catch (_) {}
      }, 1500)
    );
    poll();
  }

  start().catch((e) => {
    CL.warn("Could not start; the native UI stays as it is.", e);
    shutdown();
  });
})();
