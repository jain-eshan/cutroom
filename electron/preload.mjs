// The one bridge this app needs: letting the renderer ask for a dropped or
// picked File's real path, so /process/local (server/main.py) can read the
// recording where it already is instead of uploading a copy through the
// request body -- see src/lib/electron.ts.
//
// `webUtils.getPathForFile` only resolves for a File that came from an
// actual user gesture (a native picker or a real drag-and-drop); it returns
// "" for anything fabricated in JS, so this can't be used to probe
// arbitrary paths from the page itself.
import { contextBridge, webUtils } from "electron";

contextBridge.exposeInMainWorld("cutroom", {
	getPathForFile: (file) => webUtils.getPathForFile(file),
});
