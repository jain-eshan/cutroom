import { useEffect, useState } from "react";

export type ThemeMode = "system" | "light" | "dark";

/** Not "cutroom.theme": that key was written on every launch, choice or not,
 * so a stored "system" there can't be told apart from a default nobody
 * picked -- and "system" stopped being the default when dark became it. */
const STORAGE_KEY = "cutroom.themeChoice";

/** Reads the persisted choice, falling back to "dark" both for an absent/
 * unrecognised value and for storage that throws on read -- private
 * browsing, a full quota, or a policy blocking it outright. Takes `storage`
 * as a parameter (rather than reading `localStorage` directly) so this pure
 * decision -- what to fall back to, and when -- is unit-testable without a
 * DOM, the same reason processingProgress.ts was pulled out of
 * ProcessingScreen.tsx. */
export function readStoredMode(storage: Pick<Storage, "getItem">): ThemeMode {
	try {
		const stored = storage.getItem(STORAGE_KEY);
		return stored === "system" || stored === "light" || stored === "dark" ? stored : "dark";
	} catch {
		return "dark";
	}
}

/** Best-effort persistence: a mode that failed to save still applies for the
 * rest of this session (the caller already set it on documentElement), it
 * just won't be remembered next visit. */
export function writeStoredMode(storage: Pick<Storage, "setItem">, mode: ThemeMode): void {
	try {
		storage.setItem(STORAGE_KEY, mode);
	} catch {
		// Unavailable storage shouldn't crash the app over a preference.
	}
}

/** Three-state, persisted theme choice, dark until someone picks otherwise:
 * the app is dark and the marketing site is light (design system readme,
 * "Colour"), so a light-OS machine still opens on the dark app. `system`
 * leaves no `data-theme` attribute, so index.css's `@media
 * (prefers-color-scheme)` block drives it and reacts live to OS changes
 * with no JS listener needed. `light`/`dark` set the attribute to override
 * the OS setting. */
export function useThemeMode(): [ThemeMode, (mode: ThemeMode) => void] {
	const [mode, setMode] = useState<ThemeMode>(() => readStoredMode(localStorage));

	useEffect(() => {
		if (mode === "system") document.documentElement.removeAttribute("data-theme");
		else document.documentElement.setAttribute("data-theme", mode);
	}, [mode]);

	// Saved only when someone picks, so the stored value is always a choice.
	function choose(next: ThemeMode) {
		writeStoredMode(localStorage, next);
		setMode(next);
	}

	return [mode, choose];
}
