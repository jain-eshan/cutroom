/**
 * The saved-edit format: what the editor decides, as opposed to what the
 * pipeline found.
 *
 * Its own module rather than part of `api.ts` for two reasons. It is a file
 * format, so it outlives any one version of the code and needs a version
 * number and a reader that checks rather than trusts. And `api.ts` reads
 * `import.meta.env`, which only exists under Vite, so nothing that imports it
 * can be tested under Node -- the same reason `processingProgress.ts` exists
 * (see docs/STATUS.md item 5).
 *
 * Types are imported type-only, which erases at build time, so this module
 * pulls in nothing at runtime.
 */
import type { CastResult } from "@/features/faces/CastScreen";
import type { FramingRegion, FramingStyle } from "@/features/timeline/types";

/** What this build writes. Bump it when a change here can't be understood by
 * the code that reads it. */
export const EDIT_VERSION = 1;

/**
 * Everything the editor decides. Saved on a debounce while someone works, so
 * quitting doesn't throw away an afternoon of shot adjustment.
 *
 * Generic over the feature types so `api.ts` can carry it without importing
 * the feature modules back (a cycle); callers supply the real types.
 */
export interface SavedEdit<Region = unknown, Style = string> {
	version: number;
	cast: { names: Record<number, string>; speakerToPerson: Record<number, number>; voiceNames: Record<number, string> };
	regions: Region[];
	framingStyle: Style;
	captions: boolean;
	trimDeadAir: boolean;
	savedAt: number;
}

export interface RestoredEdit {
	cast: CastResult;
	regions: FramingRegion[];
	framingStyle: FramingStyle;
	captions: boolean;
	trimDeadAir: boolean;
}

const FRAMING_STYLES: FramingStyle[] = ["wideOnly", "gentle", "dynamic"];

/**
 * A saved edit read back, or `null` if it isn't one this build understands.
 *
 * Checked rather than trusted: this comes off disk, where an older build, a
 * newer build, a half-finished write or a hand-edited file can all have put
 * something else. `null` means "open this on the cast screen", which is
 * exactly what every job did before edits were saved -- a worse starting
 * point than resuming, but never a wrong one. Silently restoring a
 * half-understood edit would be the wrong one: it would look like the shots
 * were kept while quietly dropping some.
 */
export function restorableEdit(edit: SavedEdit | null | undefined): RestoredEdit | null {
	if (!edit || edit.version !== EDIT_VERSION) return null;
	const cast = edit.cast as CastResult | undefined;
	if (!cast?.speakerToPerson || !cast.names || !Array.isArray(edit.regions)) return null;
	return {
		// `voiceNames` arrived after the first saved edits could exist; an
		// edit without it is still perfectly readable.
		cast: { ...cast, voiceNames: cast.voiceNames ?? {} },
		regions: edit.regions as FramingRegion[],
		framingStyle: FRAMING_STYLES.find((style) => style === edit.framingStyle) ?? "gentle",
		captions: Boolean(edit.captions),
		trimDeadAir: Boolean(edit.trimDeadAir),
	};
}

/** The comparison used to decide whether anything actually changed since the
 * last save. The timestamp is excluded deliberately: including it would make
 * every save look like a change, and the autosave would write in a loop. */
export function editFingerprint(edit: SavedEdit<FramingRegion, FramingStyle>): string {
	return JSON.stringify({ ...edit, savedAt: 0 });
}
