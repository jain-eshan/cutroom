import { useState } from "react";
import { Button, EdgeCaseCard, Screen } from "@/components/ui";
import { formatDuration } from "@/lib/format";

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
			reached > 0 ? `Transcript reached: ${formatDuration(reached)}` : "Transcript: not started",
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
		<Screen width={440}>
			<EdgeCaseCard
				tone="error"
				label="Stopped while reading"
				title="It stopped partway through"
				raw={message}
				why={`${
					reached > 0
						? `The transcript got as far as ${formatDuration(reached)}.`
						: "It stopped before the transcript got started."
				} Nothing was lost — it starts from the top on a retry.`}
				actions={
					<>
						<Button variant="primary" onClick={onRetry}>
							Try again
						</Button>
						<Button onClick={copyDetails}>{copied ? "Copied" : "Copy the details"}</Button>
						{/* Not on the design's card, but without it a file that fails every
						    time is a dead end short of reloading the page. */}
						<Button variant="ghost" onClick={onPickAnother} className="ml-auto">
							Pick a different file
						</Button>
					</>
				}
			/>
		</Screen>
	);
}
