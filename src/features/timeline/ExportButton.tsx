/**
 * Stub. Real export needs the render/compositor pipeline (burn in the
 * per-turn layout choices + annotations, encode via ffmpeg) — not built yet.
 * Kept as its own component so it's obvious where that work plugs in later.
 */
export function ExportButton() {
	return (
		<div className="flex flex-col items-start gap-1">
			<button
				type="button"
				disabled
				title="Export needs the render/compositor pipeline — not built yet"
				className="cursor-not-allowed rounded-lg bg-neutral-300 px-4 py-2 text-sm text-neutral-500 dark:bg-neutral-800 dark:text-neutral-500"
			>
				Export
			</button>
			<p className="text-xs text-neutral-400">Coming in a later phase — needs the render/export pipeline.</p>
		</div>
	);
}
