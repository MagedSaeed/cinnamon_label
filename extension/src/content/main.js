// Lifecycle: follows Label Studio's task (single-page navigation), owns one Task at a time,
// switches between Cinnamon Label and the native UI, and falls back to native on any error.
// Nothing here submits, updates, skips or saves anything in Label Studio.
(() => {
  const CL = globalThis.CL;
  const U = CL.U;
  const CLMP4 = globalThis.CLMP4;
  if (CL.started) return;
  CL.started = true;

  let settings = null;
  let ui = null;
  let player = null;
  let panel = null;
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
    if (m.op === "annotationChanged") {
      if (task && task.store) task.store.refresh().catch(() => {});
      if (task && task.backup) task.backup.changed();
      return;
    }
    if (m.op === "annotationSaved") {
      // The user's Submit/Update/Skip went through: the local copy is no longer needed.
      if (m.taskId != null) CL.backup.remove(m.taskId);
      return;
    }
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

  // ---------- the labeling config -> forms (once per project) ----------
  let formFor = null;
  async function ensureForm() {
    const project = (location.pathname.match(/\/projects\/(\d+)/) || [])[1] || "";
    if (formFor === project) return;
    const xml = await CL.page("config").catch(() => null);
    if (!xml) return; // not ready yet; tried again on the next task change
    formFor = project;
    try {
      panel.setForm(globalThis.CLConfig.buildForm(xml));
    } catch (e) {
      CL.warn("Could not read the labeling config; the forms are off.", e);
      panel.setForm(null);
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
      this.annotationKey = st.annotationKey;
      this.store = null;
    }

    // The segments of the open annotation (rebuilt when the user switches annotation tabs).
    makeStore() {
      if (this.store) this.store.destroy();
      this.store = new CL.SegmentStore({
        onChange: (s) => {
          if (this.dead) return;
          ui.timeline.invalidate();
          panel.render();
          ui.setSync(s);
        },
      });
      ui.timeline.setStore(this.store);
      panel.setStore(this.store);
      ensureForm().catch(CL.warn);
      ui.setSync(this.store);
      this.store.refresh().catch(CL.warn);
      // Local backup of this annotation (the server refuses drafts).
      if (this.backup) this.backup.destroy();
      this.backup = new CL.TaskBackup(this.taskId, { onOffer: (b) => !this.dead && panel.showOffer(b) });
      panel.setBackup(this.backup);
      this.backup.changed();
    }

    async start() {
      this.failed = false;
      this.adopted = false;
      ui.setTask(this.taskId);
      if (!this.store) this.makeStore();
      ui.setNet({ kind: "checking" });
      this.resetAudio();
      // A download already running for this video (look-ahead, or left behind when switching tasks)?
      const pre = CL.prefetch.take(this.key);
      let cached = pre && pre.blob ? pre.blob : null;
      if (!cached && !pre) {
        try {
          cached = await CL.cache.get(this.key);
        } catch (e) {
          CL.warn("Could not read the saved copy:", e);
        }
      }
      if (this.dead) return;
      if (cached) {
        this.blob = cached;
        await player.setBlob(cached);
        ui.setStreaming(false);
        ui.setNet({ kind: "cached", total: cached.size });
        serveWaveform(this.key, cached);
        CL.prefetch.after(this.taskId, settings); // look ahead: the next tasks' videos
        const read = CL.blobReader(cached);
        this.audioRead = read;
        await this.startAudio(read, cached.size);
        return;
      }

      player.setNetwork(this.url);
      ui.setStreaming(true);
      ui.timeline.setMessage("The waveform fills in as the video downloads.");
      const onProgress = (p) => !this.dead && ui.setNet({ kind: "downloading", ...p, waiting: !(p.rate > 0) && p.loaded < (p.total || Infinity) });
      const onChunk = () => this.pumpAudio();
      // In Label Studio's own UI its player streams the video itself: our download then keeps to two
      // connections (its waveform waits for our copy instead of downloading the file again), so
      // that player and Label Studio's API calls (Submit) keep theirs.
      this.nativeHeld = 0;
      const acquire = async () => {
        while (CL.getMode() === "native" && this.nativeHeld >= 2 && !this.dead) await new Promise((r) => setTimeout(r, 400));
        const native = CL.getMode() === "native";
        if (native) this.nativeHeld++;
        let release;
        try {
          release = await CL.acquireSlot(() => (document.visibilityState === "visible" ? 0 : 1));
        } catch (e) {
          if (native) this.nativeHeld--;
          throw e;
        }
        return () => {
          if (native) this.nativeHeld--;
          release();
        };
      };
      if (pre) {
        // Adopt the running download: it now reports here and gets the open task's priority.
        this.dl = pre.dl;
        Object.assign(this.dl, { onProgress, onChunk, acquire });
        this.runP = pre.done;
        this.adopted = true;
        onProgress({ loaded: this.dl.loaded, total: this.dl.total, rate: 0 }); // show where it is right away
      } else {
        this.dl = new CL.Downloader(this.url, { connections: settings.connections, onProgress, onChunk, acquire });
        this.runP = this.dl.run();
      }
      const dl = this.dl;
      this.audioRead = async (o, n) => dl.readAvailable(o, n);
      dl.whenTotal.then((total) => !this.dead && this.startAudio((o, n) => CL.fetchRange(this.url, o, n), total)).catch(() => {});
      let blob;
      try {
        blob = await this.runP;
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
      this.audioRead = CL.blobReader(blob); // the downloader's chunks are gone; finish from the Blob
      this.pumpAudio();
      if (this.audioNeedsWholeFile) this.decodeWholeFile();
      await player.setBlob(blob);
      ui.setStreaming(false);
      serveWaveform(this.key, blob);
      ui.setNet({ kind: "saving", total: blob.size });
      // (An adopted download saves itself.)
      const r = this.adopted
        ? { saved: await CL.cache.has(this.key).catch(() => false) }
        : await CL.cache.put(this.key, blob, settings.cacheLimitGB * 1e9, { taskId: this.taskId, name: this.name }).catch((e) => ({ saved: false, reason: String(e) }));
      if (!this.dead) ui.setNet(r.saved ? { kind: "saved", total: blob.size } : { kind: "memory", total: blob.size, reason: r.reason || "not saved" });
      CL.prefetch.after(this.taskId, settings); // now look ahead: the next tasks' videos
    }

    // ---------- audio: waveform peaks + 16 kHz copy, decoded once ----------
    resetAudio() {
      if (this.audio) this.audio.close();
      this.audio = null;
      this.audioOk = false;
      this.audioNeedsWholeFile = false;
      ui.timeline.setAudio(null);
      ui.timeline.setMessage("");
    }

    async startAudio(read, total) {
      try {
        const loc = await CLMP4.locateMoov(read, total);
        const moov = await read(loc.offset, loc.size);
        if (this.dead || !moov) return;
        const { tracks } = CLMP4.parseMoov(moov);
        const track = tracks.find((t) => t.handler === "soun");
        if (!track) {
          ui.timeline.setMessage("This video has no audio track.");
          return;
        }
        const table = CLMP4.sampleTable(track);
        const end = table.count ? table.time[table.count - 1] + table.dur[table.count - 1] : 0;
        this.audio = new CL.AudioTrack(Math.max(track.duration, end), { onUpdate: () => ui.timeline.invalidate() });
        ui.timeline.setAudio(this.audio);
        this.audioOk = await this.audio.configure(track, table);
        if (this.dead) return;
        if (!this.audioOk) return this.needWholeFile();
        ui.timeline.setMessage("");
        this.pumpAudio();
      } catch (e) {
        CL.warn("Reading the audio track failed:", e);
        this.needWholeFile();
      }
    }

    pumpAudio() {
      if (this.dead || !this.audio || !this.audioOk || !this.audioRead) return;
      this.audio.pump(this.audioRead).catch((e) => {
        CL.warn("Audio decoding failed; decoding the whole file instead.", e);
        this.audioOk = false;
        this.needWholeFile();
      });
    }

    // WebCodecs couldn't do it: decode the complete file once it's here.
    needWholeFile() {
      this.audioNeedsWholeFile = true;
      if (this.blob) this.decodeWholeFile();
      else ui.timeline.setMessage("The waveform appears when the download finishes.");
    }

    async decodeWholeFile() {
      if (this.dead || this._wholeFile) return;
      this._wholeFile = true;
      ui.timeline.setMessage("Drawing the waveform…");
      try {
        const v = player.v;
        const dur = Number.isFinite(v.duration) ? v.duration : this.audio ? this.audio.duration : 0;
        if (this.audio) this.audio.close();
        this.audio = new CL.AudioTrack(dur, { onUpdate: () => ui.timeline.invalidate() });
        ui.timeline.setAudio(this.audio);
        await this.audio.decodeWholeFile(this.blob);
        if (!this.dead) ui.timeline.setMessage("");
      } catch (e) {
        CL.warn("Decoding the audio failed:", e);
        if (!this.dead) ui.timeline.setMessage("The waveform couldn't be drawn for this video.");
      }
    }

    destroy() {
      this.dead = true;
      ui.setStreaming(false);
      if (this.backup) {
        this.backup.destroy();
        panel.setBackup(null);
      }
      if (this.store) {
        // Finish writing what was typed, if Label Studio still has this annotation; then drop it.
        const st = this.store;
        st.flush().finally(() => st.destroy());
        ui.timeline.setStore(null);
        panel.setStore(null);
        ui.setSync(null);
      }
      // An unfinished download keeps going in the background and is saved (switching tasks
      // shouldn't throw it away); coming back adopts it again.
      if (this.dl && !this.blob && !this.dl.aborted && this.runP && !this.failed) CL.prefetch.continueInBackground(this.key, this.taskId, this.name, this.dl, this.runP, settings, { savesItself: this.adopted });
      else if (this.dl && !this.blob) this.dl.abort();
      if (this.audio) this.audio.close();
      player.reset();
      ui.timeline.setAudio(null);
      ui.timeline.setMessage("");
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
      const rate = m.playbackRate;
      m.addEventListener("loadedmetadata", () => (m.playbackRate = rate), { once: true }); // load() resets it
      m.load();
    }
  }
  // In the native UI, point Label Studio's own player at the saved copy once we have it (so it plays
  // without stalls and stops using the network). Only while it is paused, keeping its position.
  function nativeUseSavedCopy() {
    if (!task || !task.blob) return;
    const url = (nativeBlobUrl ||= URL.createObjectURL(task.blob));
    document.querySelectorAll("video, audio").forEach((m) => {
      if (!isTaskMedia(m) || !m.paused || m.seeking) return;
      const at = m.currentTime || 0;
      if (m.hasAttribute("src")) m.setAttribute("src", url);
      m.querySelectorAll("source").forEach((x) => x.hasAttribute("src") && x.setAttribute("src", url));
      const rate = m.playbackRate;
      m.addEventListener("loadedmetadata", () => {
        if (at) m.currentTime = at;
        m.playbackRate = rate; // load() resets the speed Label Studio set
      }, { once: true });
      m.load();
    });
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
    else {
      unparkNativeMedia();
      nativeUseSavedCopy();
    }
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
        dropNativeBlobUrl(); // back to the list: let the video's memory go
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
    } else if (task && st.annotationKey !== task.annotationKey) {
      task.annotationKey = st.annotationKey;
      task.makeStore(); // another annotation tab: its own segments
    }
    render(st);
    checkOldExtension();
  }

  // The old SpeakerCut extension (its row has id "lsp-root"): presegmentation is built in now.
  let oldExtChecked = false;
  function checkOldExtension() {
    if (oldExtChecked || !document.getElementById("lsp-root")) return;
    oldExtChecked = true;
    chrome.storage.local.get({ clOldExtNoticeOff: false }, (o) => panel && panel.showOldExtNotice(!o.clOldExtNoticeOff));
  }

  // Presegmentation for the open task: suggestions only (the user accepts them).
  async function runPreseg(onStatus) {
    const t = task;
    if (!t || !t.store) throw new Error("Open a task first.");
    const s = await CL.settings();
    const res = await CL.preseg.run(t.audio, s, onStatus);
    if (t !== task || t.dead) throw new Error("The task changed while presegmenting, so nothing was suggested.");
    t.store.setSuggestions(res.segments);
    return res;
  }

  function setMode(mode) {
    CL.setMode(mode);
    if (mode === "native") {
      player && player.v.pause();
      if (task && task.store) task.store.flush();
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
      CL.taskList.stop();
    } catch (_) {}
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

  // ---------- keyboard ----------
  // 1. Keys typed in our own fields never reach Label Studio (its hotkeys can't tell they come from
  //    a text field inside our overlay: Backspace could delete a segment, Ctrl+Enter could submit).
  // 2. Only universal shortcuts of our own: Space (play/pause), left/right (seek 5 s), when not typing.
  // 3. Label Studio's own Submit hotkey is held back while an edit is still being written.
  const inOverlay = (e) => !!(ui && e.composedPath && e.composedPath().includes(ui.host));
  const target = (e) => (e.composedPath && e.composedPath()[0]) || e.target;
  let swallowSpaceUp = false;
  function onKeyDown(e) {
    if (stopped || !ui) return;
    const t = target(e);
    if (inOverlay(e) && CL.isTypingTarget(t)) {
      const h = CL.fieldKeys.get(t);
      if (h) h(e);
      e.stopImmediatePropagation();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && holdSubmitIfDirty(e)) return;
    if (!ui.visible || !task) return;
    if (CL.isTypingTarget(t)) return; // typing in Label Studio's own fields (side panels)
    const onOurs = inOverlay(e) || t === document.body || t === document.documentElement;
    if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
      let handled = true;
      if (e.code === "Space") {
        if (!e.repeat) player.toggle();
        swallowSpaceUp = true;
      } else if (e.code === "ArrowLeft") player.seekBy(-5);
      else if (e.code === "ArrowRight") player.seekBy(5);
      else if (e.code === "Escape") {
        // Esc: cancel "Add segment" if it's running, otherwise unselect the segment.
        handled = panel.cancelMarking();
        if (!handled && task && task.store && task.store.selected) {
          task.store.select(null);
          handled = true;
        }
      }
      else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopImmediatePropagation(); // keep Label Studio's own hotkeys from also reacting
        return;
      }
    }
    // Label Studio's single-key hotkeys act on its hidden UI (Backspace deletes the selected segment,
    // letters change labels...). In our editor they'd destroy work silently, so they stay out.
    // Ctrl/Cmd combinations (undo/redo, Submit) still reach Label Studio.
    if (onOurs && !e.ctrlKey && !e.metaKey) e.stopImmediatePropagation();
  }
  function onKeyUp(e) {
    if (inOverlay(e) && CL.isTypingTarget(target(e))) return e.stopImmediatePropagation();
    const t = target(e);
    if (ui && ui.visible && !e.ctrlKey && !e.metaKey && (inOverlay(e) || t === document.body || t === document.documentElement) && e.code !== "Space")
      e.stopImmediatePropagation();
    if (e.code === "Space" && swallowSpaceUp) {
      swallowSpaceUp = false;
      e.preventDefault(); // a focused button would otherwise "click" on Space release
      e.stopImmediatePropagation();
    }
  }
  function onKeyPress(e) {
    const t = target(e);
    if (inOverlay(e) && CL.isTypingTarget(t)) return e.stopImmediatePropagation();
    if (ui && ui.visible && !e.ctrlKey && !e.metaKey && (inOverlay(e) || t === document.body || t === document.documentElement)) e.stopImmediatePropagation();
  }

  // ---------- Submit: make sure every edit is in Label Studio first ----------
  // We never press Submit. When the user does, pending edits start writing on pointer-down; if
  // anything is still unwritten at the click, that click is stopped and the user is asked to press
  // Submit again (we don't re-click for them).
  const isSubmitButton = (el) => {
    const b = el && el.closest ? el.closest("button") : null;
    if (!b) return false;
    const text = (b.innerText || b.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
    return /^(submit|update|complete)\b/.test(text);
  };
  const storeDirty = () => !!(task && task.store && task.store.dirty);
  function holdSubmitIfDirty(e) {
    if (!storeDirty()) return false;
    e.preventDefault();
    e.stopImmediatePropagation();
    task.store.flush().then(() => ui && ui.toast("Your last edit is now in Label Studio. Press Submit again to submit."));
    ui.toast("Writing your last edit into Label Studio…");
    return true;
  }
  function onPointerDown(e) {
    if (storeDirty() && isSubmitButton(target(e))) task.store.flush();
  }
  function onClick(e) {
    if (isSubmitButton(target(e))) holdSubmitIfDirty(e);
  }

  // ---------- start ----------
  async function start() {
    settings = await CL.settings();
    CL.setActive(settings.enabled);
    CL.setNoDrafts(settings.enabled && settings.noDrafts);
    if (!settings.enabled) {
      CL.setMode("native");
      return;
    }
    CL.backup.prune();
    await CL.cache.applyQueuedDeletes().catch(CL.warn);

    ui = CL.createOverlay();
    player = new CL.Player(ui.video);
    ui.bindPlayer(player);
    panel = CL.createPanel(ui.side, {
      bar: ui.segbar,
      player,
      timeline: ui.timeline,
      textFields: () => (task && task.store ? task.store.textFields : []),
      presegment: runPreseg,
      nudgeMs: () => (settings && settings.nudgeMs) || 50,
      nudgeShiftMs: () => (settings && settings.nudgeShiftMs) || 250,
      splitGapMs: () => (settings && settings.splitGapMs != null ? settings.splitGapMs : 100),
    });
    panel.setUi(ui);
    CL.prefetch.setStatusListener((s) => ui && ui.setAhead(s));
    // The open task's own download, for its button in the task list.
    CL.openMediaKey = () => (task ? task.key : null);
    CL.openDownload = () => (task && task.dl && !task.blob && !task.dl.aborted ? { taskId: task.taskId, loaded: task.dl.loaded, total: task.dl.total } : null);
    CL.taskList.start();
    ui.setCloseUp(!!settings.closeUp);
    CL.allowMove = !!settings.moveSegments;
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
    window.addEventListener("keypress", CL.guard(onKeyPress), true);
    window.addEventListener("pointerdown", CL.guard(onPointerDown), true);
    window.addEventListener("click", CL.guard(onClick), true);
    document.addEventListener("visibilitychange", () => task && task.store && task.store.flushTexts());

    chrome.storage.onChanged.addListener(
      CL.guard(async (changes, area) => {
        if (area === "sync") {
          settings = await CL.settings();
          CL.setActive(settings.enabled);
          CL.setNoDrafts(settings.enabled && settings.noDrafts);
          if (ui) ui.setCloseUp(!!settings.closeUp);
          CL.allowMove = !!settings.moveSegments;
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
          chrome.runtime.sendMessage({ type: "CL_DEV_TICK", dirty: storeDirty() || !!(panel && panel.busy) }, (r) => {
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
