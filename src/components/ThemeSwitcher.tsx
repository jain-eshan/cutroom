import type { ThemeMode } from "@/lib/theme";

const OPTIONS: { value: ThemeMode; label: string }[] = [
	{ value: "system", label: "System" },
	{ value: "light", label: "Light" },
	{ value: "dark", label: "Dark" },
];

/** Three-button segmented control, per the handoff's Editor title bar spec:
 * a 3px-padded `raised` group. */
export function ThemeSwitcher({ mode, onChange }: { mode: ThemeMode; onChange: (mode: ThemeMode) => void }) {
	return (
		<div className="flex gap-0.5 rounded-control bg-raised p-[3px]">
			{OPTIONS.map((option) => (
				<button
					key={option.value}
					type="button"
					onClick={() => onChange(option.value)}
					aria-pressed={mode === option.value}
					className={`rounded-[4px] px-2 py-1 text-[11px] font-medium transition-colors ${
						mode === option.value ? "bg-control text-text" : "text-text3 hover:text-text2"
					}`}
				>
					{option.label}
				</button>
			))}
		</div>
	);
}
