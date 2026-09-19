import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button, EdgeCaseCard } from "@/components/ui";

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

	// Outside AppWindow on purpose: whatever broke may be inside it.
	return (
		<div className="flex min-h-screen items-center justify-center bg-bg px-6 py-10">
			<div className="w-full max-w-[440px]">
				<EdgeCaseCard
					tone="error"
					label="Something broke"
					title="Cutroom hit a problem"
					raw={error.message || String(error)}
					why="Reloading starts the screen over. Anything already processed is saved, so a recording that finished processing reopens from the recent episodes list without running again."
					actions={
						<>
							<Button variant="primary" onClick={() => window.location.reload()}>
								Reload
							</Button>
							<Button onClick={copyDetails}>Copy the details</Button>
						</>
					}
				/>
			</div>
		</div>
	);
}
