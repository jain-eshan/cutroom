import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Last resort for an exception thrown during render.
 *
 * Without one, React unmounts the whole tree and leaves an empty white page:
 * no message, no way back, and nothing on screen to put in a bug report. For
 * someone who won't open developer tools that is indistinguishable from the
 * app being broken beyond repair.
 *
 * Reloading really is the honest recovery rather than a shrug -- a crashed
 * render leaves component state that can't be trusted, and since jobs moved
 * to the background and onto disk (see pipeline/jobs.py) a reload costs at
 * most the unsaved shot edits, not the processing.
 *
 * Has to be a class: there is no hook equivalent of componentDidCatch.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
	state: { error: Error | null } = { error: null };

	static getDerivedStateFromError(error: Error) {
		return { error };
	}

	componentDidCatch(error: Error, info: ErrorInfo) {
		// The screen shows one line; the console keeps the whole thing for
		// anyone who does open developer tools.
		console.error("Cutroom crashed while rendering:", error, info.componentStack);
	}

	render() {
		const { error } = this.state;
		if (!error) return this.props.children;
		return <CrashScreen error={error} />;
	}
}

function CrashScreen({ error }: { error: Error }) {
	async function copyDetails() {
		const details = [`Error: ${error.message}`, "", error.stack ?? "(no stack)"].join("\n");
		try {
			await navigator.clipboard.writeText(details);
		} catch {
			// Refused clipboard access. The message is on screen and selectable.
		}
	}

	return (
		<div className="flex min-h-screen items-center justify-center bg-bg px-6 py-10">
			<div className="flex w-full max-w-[520px] flex-col gap-4 rounded-panel border border-warn/45 bg-panel p-[26px]">
				<span className="font-mono text-[9.5px] tracking-[0.08em] text-warn">SOMETHING BROKE</span>
				<h2 className="text-[18px] font-semibold tracking-[-0.01em] text-text">Cutroom hit a problem</h2>
				<code className="block rounded-control bg-terminal px-2.5 py-2 font-mono text-[11px] leading-[1.5] break-words text-plate-ink">
					{error.message || String(error)}
				</code>
				<p className="text-[12.5px] leading-[1.6] text-text3">
					Reloading starts the screen over. Anything already processed is saved, so a recording that finished
					processing reopens from the recent episodes list without running again.
				</p>
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={() => window.location.reload()}
						className="rounded-control bg-accent px-4 py-2 text-[13px] font-medium text-on-accent"
					>
						Reload
					</button>
					<button
						type="button"
						onClick={copyDetails}
						className="rounded-control border border-line px-3 py-2 text-[13px] text-text2"
					>
						Copy the details
					</button>
				</div>
			</div>
		</div>
	);
}
