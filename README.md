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
  - Drag a segment's edge to move it. Shift turns snapping off; Alt moves an edge without dragging a touching neighbour along.
  - Fine-tune start and end with the − / + buttons or by typing a time.
  - **Split at playhead**, **Merge with next**, **Delete**, **Undo** and **Redo** are in the toolbar.
  - Segments never overlap. A split segment starts with empty answers; merging keeps the first segment's answers and joins the transcripts.
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
  - editing options: the close-up waveform, moving whole segments by dragging their middle, and the nudge steps for the − / + buttons;
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

Presegmentation sends the task's audio to a diarization server running on your own machine at `http://127.0.0.1:8000` (endpoints `/health` and `/diarize`). Use the server from the SpeakerCut repository (`server/` folder); its README explains setup with Docker or `uv`, and the providers (local pyannote with `HF_TOKEN`, or pyannoteAI with `PYANNOTEAI_API_KEY`). The status in the **Presegmentation** tab turns green when the server is reachable.

## Development

- Plain JavaScript, Manifest V3, no build step. Content scripts are in `extension/src/content`, the page bridge (which talks to Label Studio's annotation state) in `extension/src/page/bridge.js`, pure logic in `extension/src/shared`.
- Tests: `node --test tests/*.test.js`
- Auto-reload: turn on **Reload on code changes** in the popup, then after editing run `date +%s%N > extension/build-id.txt`. The extension reloads and refreshes Label Studio tabs (never while edits are still being written).
- Icons: `python3 tools/make_icons.py extension/icons` (needs Pillow) draws the PNG icons to match `extension/icons/logo.svg`.
