import { useEffect, useState } from "react";

/** `window.cutroom` only exists inside the desktop app (see
 * `electron/preload.cjs`) -- undefined in the plain browser dev server and
 * the marketing site, where there is no local filesystem to read a
 * recording back from or write a render to. */
declare global {
	interface Window {
		cutroom?: {
			getPathForFile: (file: File) => string;
			chooseExportPath: (defaultName: string) => Promise<string | null>;
			chooseProjectSavePath: (defaultName: string) => Promise<string | null>;
			chooseRecording: (defaultName?: string) => Promise<string | null>;
			showItemInFolder: (path: string) => void;
			onUpdate: (callback: (state: UpdateState) => void) => () => void;
			openDownloadPage: () => void;
			restartToUpdate: () => void;
		};
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

/** Whether the desktop bridge is available at all -- `PublishScreen` uses
 * this to decide whether to ask where to save *before* rendering (desktop)
 * or just render and hand back a downloadable blob (plain browser), since
 * there's no folder to save into on the web. */
export function hasElectronBridge(): boolean {
	return typeof window !== "undefined" && window.cutroom !== undefined;
}

/** Opens a native "Save As" dialog defaulting to `defaultName`. `null`
 * means the user cancelled -- distinct from `getLocalPath`'s `null`, which
 * means "not running in the desktop app"; only call this after
 * `hasElectronBridge()` is true. */
export function chooseExportPath(defaultName: string): Promise<string | null> {
	if (!window.cutroom) return Promise.resolve(null);
	return window.cutroom.chooseExportPath(defaultName);
}

/** Where to write a `.cutroom` project. `null` means cancelled. */
export function chooseProjectSavePath(defaultName: string): Promise<string | null> {
	if (!window.cutroom) return Promise.resolve(null);
	return window.cutroom.chooseProjectSavePath(defaultName);
}

/** The recording a project points at, for relinking one whose media has
 * moved. `null` means cancelled. */
export function chooseRecording(defaultName?: string): Promise<string | null> {
	if (!window.cutroom) return Promise.resolve(null);
	return window.cutroom.chooseRecording(defaultName);
}

/** Reveals a finished render in the OS file browser. */
export function showItemInFolder(path: string): void {
	window.cutroom?.showItemInFolder(path);
}

/** A newer release than the one running, from electron/main.mjs's update
 * check. `ready` means it's downloaded and installs on quit; that only
 * happens where `canSelfInstall` (not on an unsigned Mac build). */
export interface UpdateState {
	version: string;
	ready: boolean;
	canSelfInstall: boolean;
}

/** The latest update state, or null -- always null outside the desktop app. */
export function useUpdateState(): UpdateState | null {
	const [state, setState] = useState<UpdateState | null>(null);
	useEffect(() => window.cutroom?.onUpdate(setState), []);
	return state;
}

export function openDownloadPage(): void {
	window.cutroom?.openDownloadPage();
}

export function restartToUpdate(): void {
	window.cutroom?.restartToUpdate();
}
