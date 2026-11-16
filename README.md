# Cinnamon Label

A Chrome extension that gives Label Studio's video segmentation page (Cinnamon 2026 project) a smoother editor: one player with a waveform, drag-to-edit segments, a roomy right-to-left transcript box, and presegmentation suggestions.

It only changes the page's interface. It edits the annotation inside Label Studio and **never submits, updates, skips or deletes on its own**. Submitting stays a click on Label Studio's own **Submit** button, which stays visible and works as before.

## Install (load unpacked)

1. Download this repository (`git clone`, or **Code → Download ZIP** and unzip it).
2. Open `chrome://extensions` (also works in Edge and Brave).
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the `extension` folder inside the repository.
5. Pin the Cinnamon Label icon so its settings are one click away.
6. Open (or reload) a task in Label Studio.

**Updating:** pull the latest code (or unzip the new version into the same folder), click the reload ↻ icon on the Cinnamon Label card in `chrome://extensions`, then reload your Label Studio tabs. Your settings and saved videos are kept.

If you still have the old SpeakerCut extension installed, you can remove it: presegmentation is built in.

## Using it

- A task opens in Label Studio's own interface. Click **Use Cinnamon Label** (bottom of the editor) to switch. Your choice is remembered; **Switch to native UI** in the header goes back. Put the button away with ✕ if you work in the native interface; the small logo in the corner brings it back.
- **Video:** the video streams while it downloads and is saved in the browser, so it opens instantly next time. The bar along the waveform shows what has downloaded; playing beyond it may pause briefly.
- **Segments:**
  - Drag on an empty part of the waveform to create a segment, or use **Add segment**, then **Mark end** while playing.
  - Drag a segment's edge to move it. Segments are always separate: only that segment changes, and an edge stops at its neighbour's edge instead of pushing it. Shift turns snapping off.
  - Fine-tune start and end with the − / + buttons or by typing a time.
  - **Split at playhead**, **Merge with next**, **Delete**, **Undo** and **Redo** are in the toolbar.
  - Segments never overlap. **Split at playhead** leaves a small gap (100 ms by default, set in the popup) and the new part starts with empty answers; merging keeps the first segment's answers and joins the transcripts.
- **Reviewing:** with no segment selected, playing the video lights up the segment being played, on the waveform and in the list.
- **Replay segment** plays the open segment once; turn on **Loop** beside it to repeat it until you pause. **Next segment** is at the end of the form, beside the last question.
- **Questions and transcript:** the open segment's card shows its questions and the transcript box. The whole-video questions are at the top of the side panel. Help notes from the project are at the end of the form.
- **Presegment:** suggests segments, drawn dashed with speaker tags. Click one to add it, or use **Add all** / **Dismiss**. Nothing is added until you accept it.
- **Task list:** each row has a small button: ↓ downloads that task's video now, ✓ means it is saved (click to download again), and a percentage shows a running download (click to stop).
- **Before submitting:** edits are written into Label Studio as you work; the Submit button waits for the last one. Label Studio's draft saving is turned off on this server (it is refused), so the extension keeps a local backup of unsubmitted work and offers to restore it if the task is reopened empty.

## Keyboard

| Key | Action |
| --- | --- |
| Space | Play / pause |
| ← / → | Back / forward 5 seconds |
| Esc | Cancel **Add segment**, or unselect the segment |

Keys typed into text boxes stay in the text box. Ctrl / Cmd shortcuts are left to the browser and Label Studio.

## Settings (extension icon)

- **General:**
  - turn the extension on or off;
  - stop Label Studio's draft auto-save;
  - parallel connections (1–4);
  - download the next 1 or 2 tasks ahead;
  - editing options: the close-up waveform, moving whole segments by dragging their middle, the nudge steps for the − / + buttons, and the split gap;
  - reload on code changes (for development only).
- **Saved videos:** see what is saved and how much space it uses; delete one or all. The oldest are removed automatically above the size limit.
- **Presegmentation:**
  - server address and status;
  - provider;
  - music removal;
  - time limit;
  - segment rules (maximum length, padding, minimum length, overlaps);
  - speaker counts.

## Presegmentation server

Presegmentation sends the task's audio to a diarization server running on your own machine at `http://127.0.0.1:8000` (endpoints `/health` and `/diarize`). The server is in the `server/` folder. The status in the popup's **Presegmentation** tab turns green when it is reachable.

You need a Hugging Face token (read access) and to accept the terms of [`pyannote/speaker-diarization-community-1`](https://huggingface.co/pyannote/speaker-diarization-community-1) first.

```bash
cd server
cp .env.example .env     # then put your HF_TOKEN in .env (never commit .env)
```

Write values without quotes and keep comments on their own lines (Docker's `--env-file` reads the rest of the line literally).

**Option A: Docker**

```bash
cd server
docker build -t presegment-server .     # the first build downloads torch etc. and takes a while
docker run -d --name presegment-server --restart unless-stopped \
  --env-file .env -p 127.0.0.1:8000:8000 -v presegment-cache:/root/.cache \
  presegment-server
```

- It listens on `127.0.0.1:8000` only. Models and saved results are kept in the `presegment-cache` volume, so restarts are fast.
- NVIDIA GPU: install the NVIDIA Container Toolkit and add `--gpus all` to `docker run`. Otherwise it runs on CPU.
- Logs: `docker logs -f presegment-server`. Stop / start: `docker stop presegment-server`, `docker start presegment-server`.
- After changing `.env` or the code: `docker build -t presegment-server . && docker rm -f presegment-server`, then the `docker run` line again.

**Option B: uv**

```bash
cd server
uv sync                  # creates .venv (pyannote.audio, torch, demucs)
uv run uvicorn app:app --host 127.0.0.1 --port 8000
```

Saved diarization results live in `~/.cache/speakercut/results` (set `SPEAKERCUT_CACHE_DIR` to move them); delete the folder to clear them. Tests: `uv run pytest tests`.

**On a cluster:** start it on a GPU node, then tunnel from your laptop through the login node: `ssh -J <login-node> -L 8000:127.0.0.1:8000 <gpu-node>`.

**Providers** (chosen in the popup):

| Provider | Key in `server/.env` | Notes |
|---|---|---|
| Local pyannote (default) | `HF_TOKEN` | Free, runs on your GPU or CPU. |
| pyannoteAI Precision | `PYANNOTEAI_API_KEY` | Hosted models from the pyannote authors (`PYANNOTEAI_MODEL=precision-2` or `precision-3`). Best when speakers get mixed. Paid per audio second; the audio is sent to pyannoteAI and deleted within 48 h. |

**Remove music first** separates the vocals (Demucs) before diarization; it helps with loud background music. **Speaker counts** (exact, or min/max) are often the simplest fix when two speakers get merged.

## Development

- Plain JavaScript, Manifest V3, no build step. Content scripts are in `extension/src/content`, the page bridge (which talks to Label Studio's annotation state) in `extension/src/page/bridge.js`, pure logic in `extension/src/shared`.
- Tests: `node --test tests/*.test.js` (extension); `cd server && uv run pytest tests` (server)
- Auto-reload: turn on **Reload on code changes** in the popup, then after editing run `date +%s%N > extension/build-id.txt`. The extension reloads and refreshes Label Studio tabs (never while edits are still being written).
- Icons: `python3 tools/make_icons.py extension/icons` (needs Pillow) draws the PNG icons to match `extension/icons/logo.svg`.
