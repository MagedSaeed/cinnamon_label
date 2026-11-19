# Cinnamon Label

A Chrome extension that gives Label Studio's video segmentation page (Cinnamon 2026 project) a smoother editor: one player with a waveform, drag-to-edit segments, and a roomy right-to-left transcript box.

It only changes the page's interface. It edits the annotation inside Label Studio and **never submits, updates, skips or deletes on its own**. Submitting stays a click on Label Studio's own **Submit** button, which stays visible and works as before.

## Install (load unpacked)

1. Download this repository (`git clone`, or **Code → Download ZIP** and unzip it).
2. Open `chrome://extensions` (also works in Edge and Brave).
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the `extension` folder inside the repository.
5. Pin the Cinnamon Label icon so its settings are one click away.
6. Open (or reload) a task in Label Studio.

**Updating:** pull the latest code (or unzip the new version into the same folder), click the reload ↻ icon on the Cinnamon Label card in `chrome://extensions`, then reload your Label Studio tabs. Your settings and saved videos are kept.

## Using it

- A task opens in Label Studio's own interface. Click **Use Cinnamon Label** (bottom of the editor) to switch. Your choice is remembered; **Switch to native UI** in the header goes back. Put the button away with ✕ if you work in the native interface; the small logo in the corner brings it back.
- **Video:** the video streams while it downloads and is saved in the browser, so it opens instantly next time. The bar along the waveform shows what has downloaded; playing beyond it may pause briefly.
- **Segments:**
  - Drag on an empty part of the waveform to create a segment (works in either mode).
  - The button beside the play controls adds segments in one of two modes, chosen with its ▾ menu (remembered):
    - **Mark segment:** press it where the speech starts, then **Mark end** where it ends, while playing.
    - **Draw segment:** press it, then drag across an empty part of the waveform (Esc or ✕ to stop).
  - If the playhead is inside a segment, a yellow note above the button says so.
  - Drag a segment's edge to move it. Segments are always separate: only that segment changes, and an edge stops at its neighbour's edge instead of pushing it. Shift turns snapping off.
  - Hold **Ctrl** (⌘ on a Mac) and drag a segment's middle to slide the whole segment left or right, keeping its length. Without the key a click only selects, so a segment never shifts by accident.
  - Fine-tune start and end with the − / + buttons or by typing a time.
  - **Split at playhead**, **Merge with next**, **Delete**, **Undo** and **Redo** are in the toolbar.
  - Segments never overlap. **Split at playhead** leaves a small gap (100 ms by default, set in the popup) and the new part starts with empty answers; merging keeps the first segment's answers and joins the transcripts.
- **Reviewing:** each segment card shows a small waveform of its segment, shaded by loudness. While the video plays, the part already played fills in with a moving playhead; with no segment selected, the segment being played is also lit on the main waveform and its card stays in view.
- **« / »** beside the play button step back / forward 2 seconds.
- **Replay segment** (under the transcript) plays the open segment once; turn on **Loop** to repeat it until you pause. Loop is also a round button (⇄, filled when on) right under the open segment's play button, so you can set it before choosing gender and dialect; the two stay in sync, and the segment's play button loops too while it is on. Closing the segment ends the replay and the video plays on. **Next segment** is at the end of the form, beside the last question; it opens the next segment and plays it (looping too if Loop is on).
- **Questions and transcript:** the open segment's card shows its questions and the transcript box. The whole-video questions are at the top of the side panel. Help notes from the project are at the end of the form.
- **Task list:** each row has a small button: ↓ downloads that task's video now, ✓ means it is saved (click to download again), and a percentage shows a running download (click to stop).
- **Before submitting:** edits are written into Label Studio as you work; the Submit button waits for the last one. Label Studio's draft saving is turned off on this server (it is refused), so the extension keeps a local backup of unsubmitted work and offers to restore it if the task is reopened empty.

## Keyboard

| Key | Action |
| --- | --- |
| Space | Play / pause |
| ← / → | Back / forward 5 seconds |
| Esc | Cancel **Mark segment** / **Draw segment**, or unselect the segment |
| Ctrl (⌘) + drag | Move a whole segment |

Keys typed into text boxes stay in the text box. Ctrl / Cmd shortcuts are left to the browser and Label Studio.

## Settings (extension icon)

- **General:**
  - turn the extension on or off;
  - stop Label Studio's draft auto-save;
  - parallel connections (1–4);
  - download the next 1 or 2 tasks ahead;
  - editing options: the close-up waveform, the nudge steps for the − / + buttons, and the split gap;
  - reload on code changes (for development only).
- **Saved videos:** see what is saved and how much space it uses; delete one or all. The oldest are removed automatically above the size limit.

## Development

- Plain JavaScript, Manifest V3, no build step. Content scripts are in `extension/src/content`, the page bridge (which talks to Label Studio's annotation state) in `extension/src/page/bridge.js`, pure logic in `extension/src/shared`.
- Tests: `node --test tests/*.test.js`
- Auto-reload: turn on **Reload on code changes** in the popup, then after editing run `date +%s%N > extension/build-id.txt`. The extension reloads and refreshes Label Studio tabs (never while edits are still being written).
- Icons: `python3 tools/make_icons.py extension/icons` (needs Pillow) draws the PNG icons to match `extension/icons/logo.svg`.
