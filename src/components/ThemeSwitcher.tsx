import type { ThemeMode } from "@/lib/theme";

const OPTIONS: { value: ThemeMode; label: string }[] = [
	{ value: "system", label: "System" },
	{ value: "light", label: "Light" },
	{ value: "dark", label: "Dark" },
];

/** Three-button segmented control, the design system's ThemeSwitch: a
 * 3px-padded `raised` group, the current mode on `control`. */
export function ThemeSwitcher({ mode, onChange }: { mode: ThemeMode; onChange: (mode: ThemeMode) => void }) {
	return (
		<div className="flex gap-0.5 rounded-card bg-raised p-[3px]">
			{OPTIONS.map((option) => (
				<button
					key={option.value}
					type="button"
					onClick={() => onChange(option.value)}
					aria-pressed={mode === option.value}
					className={`rounded-control px-[9px] py-1.5 text-mono-xs leading-none font-medium transition-colors duration-[90ms] ease-linear ${
						mode === option.value ? "bg-control text-text" : "text-text3 hover:text-text2"
					}`}
				>
					{option.label}
				</button>
			))}
		</div>
	);
}
