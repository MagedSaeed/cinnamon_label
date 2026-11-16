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

    // Play [a, b) and stop at b. Any manual pause or seek outside the range cancels the stop.
    playRange(a, b) {
      const v = this.v;
      if (!v.currentSrc || !(b > a)) return;
      this._range = [a, b];
      this.seekTo(a);
      v.preload = "auto";
      v.play().catch(() => {});
      if (!this._rangeHooked) {
        this._rangeHooked = true;
        v.addEventListener("pause", () => (this._range = null));
        v.addEventListener("seeking", () => {
          const r = this._range;
          if (r && (v.currentTime < r[0] - 0.05 || v.currentTime > r[1] + 0.05)) this._range = null;
        });
      }
      const startedAt = performance.now();
      const watch = () => {
        const r = this._range;
        if (!r) return;
        if (v.paused) {
          // play() may not have started yet; give up if it never does.
          if (performance.now() - startedAt > 3000) this._range = null;
          else requestAnimationFrame(watch);
          return;
        }
        if (v.currentTime >= r[1]) {
          this._range = null;
          v.pause();
          v.currentTime = r[1];
          return;
        }
        requestAnimationFrame(watch);
      };
      requestAnimationFrame(watch);
    }

    setRate(r) {
      this.v.defaultPlaybackRate = this.v.playbackRate = r;
    }
  };
})();
