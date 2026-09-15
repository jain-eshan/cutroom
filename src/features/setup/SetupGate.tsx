import { useEffect, useState } from "react";
import { getHealth, type Health } from "@/lib/api";
import { Logo } from "@/components/Logo";

const SERVICE_COMMAND = "cd server && uv run uvicorn main:app --port 8787";
const POLL_MS = 2000;
/** Long enough for the last row flipping to green to register as an event,
 * short enough that nobody thinks it has stalled. The handoff is explicit that
 * success must be unmissable and must not require a click. */
const CONFIRM_MS = 900;

type RowState = "done" | "waiting" | "muted";

function Check() {
	return (
		<svg viewBox="0 0 24 24" className="h-[11px] w-[11px]" aria-hidden="true">
			<path
				d="M4 12.5 9.5 18 20 6.5"
				fill="none"
				stroke="currentColor"
				strokeWidth={3.5}
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function Dot({ state }: { state: RowState }) {
	if (state === "done") {
		return (
			<span className="flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full bg-ok text-bg">
				<Check />
			</span>
		);
	}
	return (
		<span
			className={`h-[19px] w-[19px] shrink-0 rounded-full border-2 ${
				state === "waiting" ? "animate-pulse border-accent" : "border-text3"
			}`}
		/>
	);
}

function Row({
	state,
	title,
	subline,
	children,
}: {
	state: RowState;
	title: string;
	subline: string;
	children?: React.ReactNode;
}) {
	return (
		<div
			className={`flex flex-col gap-3 rounded-[7px] border bg-raised p-[13px] ${
				state === "waiting" ? "border-accent/45" : "border-line"
			} ${state === "muted" ? "opacity-60" : ""}`}
		>
			<div className="flex items-center gap-3">
				<Dot state={state} />
				<div className="flex flex-col gap-0.5">
					<span className="text-[13px] font-medium text-text">{title}</span>
					<span className="font-mono text-[10px] text-text3">{subline}</span>
				</div>
			</div>
			{children}
		</div>
	);
}

function CommandBlock({ command }: { command: string }) {
	const [copied, setCopied] = useState(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(command);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			// Clipboard is permission-gated and can simply refuse. The command is
			// on screen and selectable either way, so there is nothing to report.
		}
	}

	return (
		<div className="flex items-center gap-2 rounded-control border border-line bg-terminal p-2">
			{/* Wraps rather than scrolls: a command you cannot read in full is not
			    much better than no command, and COPY is right there either way. */}
			<code className="flex-1 font-mono text-[11.5px] leading-[1.5] break-words text-plate-ink">
				{command}
			</code>
			<button
				type="button"
				onClick={copy}
				className="shrink-0 rounded-chip bg-control px-1.5 py-1 font-mono text-[9.5px] tracking-[0.08em] text-text2"
			>
				{copied ? "COPIED" : "COPY"}
			</button>
		</div>
	);
}

export function SetupGate({ onReady }: { onReady: (health: Health) => void }) {
	// Null whenever the service isn't answering -- including while it restarts
	// after someone edits server/.env, which is exactly when this screen needs
	// to keep watching rather than stop at the first answer.
	const [health, setHealth] = useState<Health | null>(null);

	useEffect(() => {
		let cancelled = false;
		const tick = async () => {
			try {
				const result = await getHealth();
				if (!cancelled) setHealth(result);
			} catch {
				// Expected until the service is up -- that is what this screen is for.
				if (!cancelled) setHealth(null);
			}
		};
		void tick();
		const id = setInterval(tick, POLL_MS);
		return () => {
			cancelled = true;
			clearInterval(id);
		};
	}, []);

	const serviceUp = health !== null;
	// Required: without speaker turns there is nothing to edit, and finding out
	// after a multi-minute transcription is the failure this row exists to stop.
	const ready = serviceUp && health.diarization;

	useEffect(() => {
		if (!health || !ready) return;
		const id = setTimeout(() => onReady(health), CONFIRM_MS);
		return () => clearTimeout(id);
	}, [health, ready, onReady]);

	return (
		<div className="flex min-h-screen flex-col items-center justify-center bg-bg px-6 py-10">
			<div className="flex w-full max-w-[470px] flex-col gap-5 rounded-panel border border-line p-[26px]">
				<div className="flex flex-col gap-2">
					<Logo size={26} className="mb-1 text-text" />
					<h1 className="text-[19px] font-semibold tracking-[-0.01em] text-text">
						A few things need to be ready
					</h1>
					<p className="text-[12.5px] leading-[1.6] text-text3">
						Cutroom does all the work on your own machine, so the machine has to be set up for it.
						This page checks every few seconds — it'll move on by itself.
					</p>
				</div>

				<div className="flex flex-col gap-2">
					<Row state="done" title="This window" subline="localhost:3460" />

					<Row
						state={serviceUp ? "done" : "waiting"}
						title="The processing service"
						subline="localhost:8787"
					>
						{!serviceUp && (
							<div className="flex flex-col gap-2">
								<p className="text-[11px] leading-[1.6] text-text3">
									Open a second terminal in this folder and run:
								</p>
								<CommandBlock command={SERVICE_COMMAND} />
								<p className="text-[11px] text-text3">
									When it prints <span className="font-mono text-text2">Application startup
									complete</span>, this page moves on by itself.
								</p>
							</div>
						)}
					</Row>

					<Row
						state={!serviceUp ? "muted" : health.diarization ? "done" : "waiting"}
						title="Speaker detection"
						subline={
							!serviceUp
								? "checked once the service is running"
								: health.diarization
									? "Hugging Face token found"
									: "needs a free Hugging Face token"
						}
					>
						{serviceUp && !health.diarization && (
							<div className="flex flex-col gap-2">
								<p className="text-[11px] leading-[1.6] text-text3">
									Working out who speaks when uses a model you have to agree to first. Once, on the
									same Hugging Face account:
								</p>
								<ol className="flex list-decimal flex-col gap-1 pl-4 text-[11px] leading-[1.6] text-text2">
									<li>
										Create a read token at{" "}
										<a
											href="https://huggingface.co/settings/tokens"
											target="_blank"
											rel="noreferrer"
											className="text-accent-text underline"
										>
											huggingface.co/settings/tokens
										</a>
									</li>
									<li>
										Accept the licence at{" "}
										<a
											href="https://huggingface.co/pyannote/speaker-diarization-community-1"
											target="_blank"
											rel="noreferrer"
											className="text-accent-text underline"
										>
											pyannote/speaker-diarization-community-1
										</a>
									</li>
									<li>
										Add it to <span className="font-mono">server/.env</span>, then restart the service:
									</li>
								</ol>
								<CommandBlock command="HF_TOKEN=hf_your_token_here" />
								<p className="text-[11px] leading-[1.6] text-text3">
									The token stays in that file on this machine. A token that's set but whose licence
									wasn't accepted only shows up when the model first loads.
								</p>
							</div>
						)}
					</Row>

					<Row
						state={health?.captions ? "done" : "muted"}
						title="Captions available"
						subline={
							health?.captions
								? "this ffmpeg can burn in subtitles"
								: "Optional — needs ffmpeg built with libass"
						}
					/>
				</div>

				<div className="flex items-center justify-between gap-4">
					<button
						type="button"
						disabled
						className="rounded-control bg-control px-4 py-2 text-[13px] font-medium text-text3"
					>
						{ready ? "Starting…" : "Waiting…"}
					</button>
					<a
						href="https://github.com/jain-eshan/podcast-editor#setup"
						target="_blank"
						rel="noreferrer"
						className="text-[11px] text-accent-text underline"
					>
						Read the setup steps
					</a>
				</div>
			</div>
		</div>
	);
}
