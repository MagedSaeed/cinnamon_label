// The single media clock. Streams from the server while the download runs, then switches to the
// downloaded copy (same position, same play state) so playback can no longer stall.
(() => {
  const CL = globalThis.CL;

  CL.Player = class Player {
    constructor(video) {
      this.v = video;
      this.objUrl = null;
      this.source = "none"; // "network" | "memory" | "none"
    }

    #revoke() {
      if (this.objUrl) URL.revokeObjectURL(this.objUrl);
      this.objUrl = null;
    }

    setNetwork(url) {
      this.#revoke();
      this.v.preload = "metadata"; // don't compete with the download until the user presses play
      this.v.src = url;
      this.source = "network";
    }

    async setBlob(blob) {
      const v = this.v;
      const t = this.source === "none" ? 0 : v.currentTime || 0;
      const wasPlaying = !v.paused && !v.ended;
      const rate = v.playbackRate || 1;
      const old = this.objUrl;
      this.objUrl = URL.createObjectURL(blob);
      v.preload = "auto";
      v.src = this.objUrl;
      this.source = "memory";
      await new Promise((resolve) => {
        const done = () => {
          v.removeEventListener("loadedmetadata", done);
          resolve();
        };
        v.addEventListener("loadedmetadata", done);
        setTimeout(done, 5000);
      });
      v.defaultPlaybackRate = v.playbackRate = rate;
      if (t > 0) v.currentTime = Number.isFinite(v.duration) ? Math.min(t, v.duration) : t;
      if (wasPlaying) v.play().catch(() => {});
      if (old) URL.revokeObjectURL(old);
    }

    reset() {
      const v = this.v;
      v.pause();
      v.removeAttribute("src");
      v.load();
      this.#revoke();
      this.source = "none";
    }

    toggle() {
      const v = this.v;
      if (!v.currentSrc) return;
      if (v.paused || v.ended) {
        v.preload = "auto";
        v.play().catch(() => {});
      } else v.pause();
    }

    seekTo(t) {
      const v = this.v;
      if (!Number.isFinite(v.duration)) return;
      v.currentTime = Math.max(0, Math.min(v.duration, t));
    }

    seekBy(d) {
      this.seekTo((this.v.currentTime || 0) + d);
    }

    setRate(r) {
      this.v.defaultPlaybackRate = this.v.playbackRate = r;
    }
  };
})();
