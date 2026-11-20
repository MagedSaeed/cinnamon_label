# cinnamon_label
a chrome extension to fix common problems of label studio when annotating data for cinnamon-2026 project

Works the same on Windows, macOS and Linux: it is plain JavaScript run by the browser, with no
build step and nothing to install besides the browser itself.

## Install

You need **Google Chrome 111 or newer** (or another Chromium browser such as Microsoft Edge or Brave).
Check with `chrome://settings/help`.

1. Get the code, either way:
   - **Download ZIP:** on GitHub, click **Code → Download ZIP**, then unzip it.
     On Windows, right-click the ZIP → **Extract All…**. Don't load the extension from inside the
     ZIP itself; Windows lets you browse into a ZIP, but Chrome can't load from there.
   - **Git:** `git clone https://github.com/magedsaeed/cinnamon_label.git`
2. Open `chrome://extensions` (in Edge: `edge://extensions`) and turn on **Developer mode**
   (top right in Chrome, left sidebar in Edge).
3. Click **Load unpacked** and choose the **`extension`** folder inside the project, the folder that
   contains `manifest.json`:

   ```
   cinnamon_label-main\          <- not this one
     cinnamon_label-main\        <- (Windows "Extract All" can add this extra level), not this one either
       extension\                <- select THIS folder
         manifest.json
   ```

   If Chrome says **"Manifest file is missing or unreadable"**, you picked the wrong folder: go one
   level deeper until you are in `extension`.
4. Open (or reload) a task on `https://annotation.dlnlp.ai/`. The Cinnamon Label editor appears over
   Label Studio's editor area. Click the extension's toolbar icon for its settings.

### Updating

Download/unzip again (or `git pull`), then click the **reload** arrow on the extension's card in
`chrome://extensions` and reload the Label Studio tab. If you unzip to a new folder, remove the old
extension and load the new folder instead.

## Troubleshooting

- **Nothing shows on the Label Studio page.** The extension only runs on
  `https://annotation.dlnlp.ai/`. Check that the address is exactly that (https, same host), that the
  extension is switched on in `chrome://extensions`, and that **Use Cinnamon Label** is on in its popup.
  Reload the task page after changing any of these.
- **An error on the extension's card** (`chrome://extensions` shows an **Errors** button): click it
  and send the message to the maintainer.
- **"Requires Chrome version 111 or greater"**: update the browser.
- To see what the extension is doing, open DevTools (F12) on the task page; its messages start with
  `[Cinnamon Label]`.

## Development

- Tests: `npm test` (or `node --test`), Node 18 or newer. Same command on every OS.
- Icons: `python tools/make_icons.py extension/icons` (needs Pillow).
