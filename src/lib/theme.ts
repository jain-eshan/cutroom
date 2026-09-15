import { useEffect, useState } from "react";

export type ThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "cutroom.theme";

/** Three-state, persisted theme choice. `system` leaves no `data-theme`
 * attribute, so index.css's `@media (prefers-color-scheme)` block drives it
 * and reacts live to OS changes with no JS listener needed. `light`/`dark`
 * set the attribute to override the OS setting -- see docs/design/handoff
 * README, "Theme mode": a video editor is the one app class where users
 * deliberately override it, so system-only is not an option. */
export function useThemeMode(): [ThemeMode, (mode: ThemeMode) => void] {
	const [mode, setMode] = useState<ThemeMode>(() => {
		const stored = localStorage.getItem(STORAGE_KEY);
		return stored === "light" || stored === "dark" ? stored : "system";
	});

	useEffect(() => {
		if (mode === "system") document.documentElement.removeAttribute("data-theme");
		else document.documentElement.setAttribute("data-theme", mode);
		localStorage.setItem(STORAGE_KEY, mode);
	}, [mode]);

	return [mode, setMode];
}
