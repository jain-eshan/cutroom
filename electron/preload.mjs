// The bridge this app needs between the renderer and things only the main
// process can do -- see src/lib/electron.ts for how the renderer uses each
// of these.
//
// `webUtils.getPathForFile` only resolves for a File that came from an
// actual user gesture (a native picker or a real drag-and-drop); it returns
// "" for anything fabricated in JS, so this can't be used to probe
// arbitrary paths from the page itself. `chooseExportPath` and
// `showItemInFolder` need the main process (`dialog` and `shell` don't
// exist in a renderer/preload context), so they go over `ipcRenderer`.
import { contextBridge, ipcRenderer, webUtils } from "electron";

contextBridge.exposeInMainWorld("cutroom", {
	getPathForFile: (file) => webUtils.getPathForFile(file),
	chooseExportPath: (defaultName) => ipcRenderer.invoke("choose-export-path", defaultName),
	showItemInFolder: (path) => ipcRenderer.invoke("show-item-in-folder", path),
});
