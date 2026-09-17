/** `window.cutroom` only exists inside the desktop app (see
 * `electron/preload.mjs`) -- undefined in the plain browser dev server and
 * the marketing site, where there is no local filesystem to read a
 * recording back from. */
declare global {
	interface Window {
		cutroom?: { getPathForFile: (file: File) => string };
	}
}

/** The file's real path on disk, or `null` in a plain browser, or for a
 * `File` that has no path (Electron's `webUtils.getPathForFile` returns ""
 * for anything that wasn't picked or dropped by the user). Lets `App.tsx`
 * read the recording where it already is instead of uploading a copy
 * through `/process`'s request body -- see `processVideoAtPath`. */
export function getLocalPath(file: File): string | null {
	return window.cutroom?.getPathForFile(file) || null;
}
