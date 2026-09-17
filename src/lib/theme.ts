import { useEffect, useState } from "react";

export type ThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "cutroom.theme";

/** Reads the persisted choice, falling back to "system" both for an absent/
 * unrecognised value and for storage that throws on read -- private
 * browsing, a full quota, or a policy blocking it outright. Takes `storage`
 * as a parameter (rather than reading `localStorage` directly) so this pure
 * decision -- what to fall back to, and when -- is unit-testable without a
 * DOM, the same reason processingProgress.ts was pulled out of
 * ProcessingScreen.tsx. */
export function readStoredMode(storage: Pick<Storage, "getItem">): ThemeMode {
	try {
		const stored = storage.getItem(STORAGE_KEY);
		return stored === "light" || stored === "dark" ? stored : "system";
	} catch {
		return "system";
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

/** Three-state, persisted theme choice. `system` leaves no `data-theme`
 * attribute, so index.css's `@media (prefers-color-scheme)` block drives it
 * and reacts live to OS changes with no JS listener needed. `light`/`dark`
 * set the attribute to override the OS setting -- see docs/design/handoff
 * README, "Theme mode": a video editor is the one app class where users
 * deliberately override it, so system-only is not an option. */
export function useThemeMode(): [ThemeMode, (mode: ThemeMode) => void] {
	const [mode, setMode] = useState<ThemeMode>(() => readStoredMode(localStorage));

	useEffect(() => {
		if (mode === "system") document.documentElement.removeAttribute("data-theme");
		else document.documentElement.setAttribute("data-theme", mode);
		writeStoredMode(localStorage, mode);
	}, [mode]);

	return [mode, setMode];
}
