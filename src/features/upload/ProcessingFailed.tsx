import { useState } from "react";

function formatClock(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Processing failed partway. Follows the edge-case pattern from the handoff:
 * what happened, the raw server message in mono (never instead of the plain
 * line), how far it got, and what to do next. Keeps hold of the file, so
 * trying again doesn't mean finding it on disk a second time.
 */
export function ProcessingFailed({
	fileName,
	message,
	reached,
	onRetry,
	onPickAnother,
}: {
	fileName: string;
	message: string;
	/** Seconds into the recording the transcript had reached when it stopped. */
	reached: number;
	onRetry: () => void;
	onPickAnother: () => void;
}) {
	const [copied, setCopied] = useState(false);

	async function copyDetails() {
		const details = [
			`File: ${fileName}`,
			reached > 0 ? `Transcript reached: ${formatClock(reached)}` : "Transcript: not started",
			`Error: ${message}`,
		].join("\n");
		try {
			await navigator.clipboard.writeText(details);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			// Clipboard access can be refused. The message is on screen and
			// selectable, so there's nothing further to do.
		}
	}

	return (
		<div className="flex min-h-screen items-center justify-center bg-bg px-6 py-10">
			<div className="flex w-full max-w-[520px] flex-col gap-4 rounded-panel border border-warn/45 bg-panel p-[26px]">
				<span className="font-mono text-[9.5px] tracking-[0.08em] text-warn">STOPPED WHILE READING</span>
				<h2 className="text-[18px] font-semibold tracking-[-0.01em] text-text">It stopped partway through</h2>
				<code className="block rounded-control bg-terminal px-2.5 py-2 font-mono text-[11px] leading-[1.5] break-words text-plate-ink">
					{message}
				</code>
				<p className="text-[12.5px] leading-[1.6] text-text3">
					{reached > 0
						? `The transcript got as far as ${formatClock(reached)}.`
						: "It stopped before the transcript got started."}{" "}
					Nothing was lost — it starts from the top on a retry.
				</p>
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={onRetry}
						className="rounded-control bg-accent px-4 py-2 text-[13px] font-medium text-on-accent"
					>
						Try again
					</button>
					<button
						type="button"
						onClick={copyDetails}
						className="rounded-control border border-line px-3 py-2 text-[13px] text-text2"
					>
						{copied ? "Copied" : "Copy the details"}
					</button>
					<div className="flex-1" />
					{/* Not on the design's card, but without it a file that fails every
					    time is a dead end short of reloading the page. */}
					<button type="button" onClick={onPickAnother} className="text-[11px] text-text3 underline">
						Pick a different file
					</button>
				</div>
			</div>
		</div>
	);
}
