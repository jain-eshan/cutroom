import { useEffect, useState } from "react";
import { exportVideo, type DetectFacesResponse, type Health, type Turn, type Word } from "@/lib/api";
import type { FramingRegion } from "@/features/timeline/types";

type RenderState =
	| { status: "idle" }
	| { status: "rendering" }
	| { status: "done"; url: string; filename: string }
	| { status: "error"; message: string };

function formatLength(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	return `${m}:${s.toString().padStart(2, "0")}`;
}

function Tick() {
	return (
		<svg viewBox="0 0 24 24" className="h-[10px] w-[10px]" aria-hidden="true">
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

/**
 * One thing the episode can come out with. Unbuilt artefacts are shown
 * unchecked and say so, rather than being hidden: the manifest is the honest
 * list of what an episode needs, and pretending the gaps aren't there would
 * make it a sales page.
 */
function Artefact({
	title,
	subline,
	checked,
	onToggle,
	unbuilt,
	badge,
}: {
	title: string;
	subline: string;
	checked: boolean;
	onToggle?: () => void;
	unbuilt?: boolean;
	badge?: string;
}) {
	const interactive = Boolean(onToggle) && !unbuilt;
	return (
		<button
			type="button"
			role="checkbox"
			aria-checked={checked}
			aria-disabled={!interactive}
			onClick={interactive ? onToggle : undefined}
			className={`flex w-full items-center gap-3 rounded-[7px] border px-[13px] py-[11px] text-left ${
				checked ? "border-accent/45 bg-raised" : "border-line bg-panel"
			} ${unbuilt ? "cursor-not-allowed opacity-70" : interactive ? "" : "cursor-default"}`}
		>
			{checked ? (
				<span className="flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-[4px] bg-accent text-on-accent">
					<Tick />
				</span>
			) : (
				<span className="h-[17px] w-[17px] shrink-0 rounded-full border-2 border-[oklch(0.42_0.01_80)]" />
			)}
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="flex items-center gap-2 text-[13px] font-medium text-text">
					{title}
					{badge && (
						<span className="rounded-chip bg-control px-1 py-px font-mono text-[9px] tracking-[0.08em] text-text3">
							{badge}
						</span>
					)}
				</span>
				<span className="font-mono text-[10px] text-text3">{subline}</span>
			</span>
		</button>
	);
}

function Destination({ label, selected, unbuilt }: { label: string; selected?: boolean; unbuilt?: boolean }) {
	return (
		<span
			title={unbuilt ? "Not built yet" : undefined}
			className={`rounded-control border px-2.5 py-1.5 text-[12px] ${
				selected ? "border-accent/45 bg-raised text-text" : "border-line text-text3"
			} ${unbuilt ? "cursor-not-allowed opacity-60" : ""}`}
		>
			{label}
		</span>
	);
}

export function PublishScreen({
	file,
	sessionId,
	turns,
	words,
	faces,
	regions,
	duration,
	health,
	captions,
	onCaptionsChange,
	trimDeadAir,
	onBack,
	onNew,
}: {
	file: File;
	sessionId: string;
	turns: Turn[];
	words: Word[];
	faces: DetectFacesResponse;
	regions: FramingRegion[];
	duration: number;
	health: Health | null;
	captions: boolean;
	onCaptionsChange: (enabled: boolean) => void;
	trimDeadAir: boolean;
	onBack: () => void;
	onNew: () => void;
}) {
	const [render, setRender] = useState<RenderState>({ status: "idle" });
	const captionsAvailable = health?.captions ?? false;
	const burnCaptions = captions && captionsAvailable;
	const changed = regions.filter((r) => r.source === "user").length;
	const stem = file.name.replace(/\.[^.]+$/, "");

	// The download link holds the whole rendered episode in memory.
	useEffect(() => {
		if (render.status !== "done") return;
		const { url } = render;
		return () => URL.revokeObjectURL(url);
	}, [render]);

	// Closing the tab aborts the request, and the server doesn't yet kill its
	// ffmpeg when that happens -- so at the very least, make closing a decision
	// rather than an accident. (Browsers show their own wording; custom text in
	// this dialog was removed for abuse reasons.)
	useEffect(() => {
		if (render.status !== "rendering") return;
		const warn = (e: BeforeUnloadEvent) => {
			e.preventDefault();
			e.returnValue = "";
		};
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [render.status]);

	async function renderEpisode() {
		setRender({ status: "rendering" });
		try {
			const blob = await exportVideo(
				file,
				regions.map((r) => ({
					start: r.start,
					end: r.end,
					layout: r.layout,
					personIds: r.personIds,
					source: r.source,
				})),
				turns.map((t) => ({ start: t.start, end: t.end })),
				faces,
				sessionId,
				words,
				burnCaptions,
				trimDeadAir,
			);
			setRender({ status: "done", url: URL.createObjectURL(blob), filename: `${stem}-edited.mp4` });
		} catch (err) {
			setRender({
				status: "error",
				message: err instanceof Error ? err.message : "The render failed for an unknown reason.",
			});
		}
	}

	const rendering = render.status === "rendering";

	return (
		<div className="flex min-h-screen items-center justify-center bg-bg px-6 py-10">
			<div className="flex w-full max-w-[700px] flex-col overflow-hidden rounded-panel border border-line bg-panel">
				<div className="flex items-start justify-between gap-4 border-b border-line px-[26px] py-5">
					<div className="flex min-w-0 flex-col gap-1">
						<h2 className="text-[19px] font-semibold tracking-[-0.01em] text-text">Publish</h2>
						<span className="truncate font-mono text-[10.5px] text-text3">
							{stem} · {formatLength(duration)} · {turns.length} turns · {changed} you changed
						</span>
					</div>
					<button
						type="button"
						onClick={onBack}
						disabled={rendering}
						className="shrink-0 rounded-control border border-line px-2.5 py-1.5 text-[12px] text-text2 disabled:opacity-40"
					>
						Back to editing
					</button>
				</div>

				<div className="grid grid-cols-[1fr_230px] gap-6 px-[26px] py-5">
					<div className="flex flex-col gap-5">
						<section className="flex flex-col gap-2">
							<span className="font-mono text-[9.5px] tracking-[0.08em] text-text3">WHAT COMES OUT</span>
							<Artefact
								title="The episode"
								subline={`MP4 · ${faces.frameWidth}×${faces.frameHeight} · ${
									trimDeadAir ? "dead air trimmed, audio re-encoded" : "original audio untouched"
								}`}
								checked
							/>
							{captionsAvailable ? (
								<Artefact
									title="Captions"
									subline="burned in"
									checked={captions}
									onToggle={() => onCaptionsChange(!captions)}
								/>
							) : (
								<Artefact title="Captions" subline="need an ffmpeg built with libass" checked={false} unbuilt />
							)}
							<Artefact
								title="Chapters"
								subline="not built yet — the transcript has what they'd need"
								checked={false}
								unbuilt
							/>
							<Artefact
								title="Show notes"
								subline="a draft from the transcript — not built yet"
								checked={false}
								unbuilt
							/>
							<Artefact title="Short clips" subline="9:16 · not built yet" checked={false} unbuilt badge="BETA" />
						</section>

						{!captionsAvailable && (
							<div className="flex flex-col gap-2 rounded-card border border-warn/45 bg-warn-bg p-3">
								<span className="text-[12.5px] font-medium text-warn">Captions need a different ffmpeg</span>
								<span className="text-[11px] leading-[1.6] text-text2">
									Yours was built without subtitle support. We're telling you now rather than after the
									render.
								</span>
								<code className="rounded-control bg-terminal px-2 py-1.5 font-mono text-[11px] text-plate-ink">
									brew install ffmpeg-full
								</code>
								<span className="text-[11px] leading-[1.6] text-text3">
									Then set <span className="font-mono">FFMPEG_BINARY</span> in{" "}
									<span className="font-mono">server/.env</span> and restart the service.
								</span>
							</div>
						)}

						<section className="flex flex-col gap-2">
							<span className="font-mono text-[9.5px] tracking-[0.08em] text-text3">WHERE IT GOES</span>
							<div className="flex flex-wrap gap-2">
								<Destination label="A folder on this Mac" selected />
								<Destination label="YouTube" unbuilt />
								<Destination label="RSS / host" unbuilt />
							</div>
							<p className="text-[11px] leading-[1.6] text-text3">
								Connecting a destination is the only thing here that ever leaves your machine, and it
								asks first, every time.
							</p>
						</section>
					</div>

					<div className="flex flex-col gap-2">
						<span className="font-mono text-[9.5px] tracking-[0.08em] text-text3">CLIPS</span>
						<div className="flex aspect-[9/16] w-full items-center justify-center rounded-card border-2 border-dashed border-line p-4 text-center">
							<span className="text-[11px] leading-[1.5] text-text3">Not built yet</span>
						</div>
						<p className="text-[11px] leading-[1.6] text-text3">
							Clips will be cut where the transcript gets dense and nobody interrupts — a heuristic, not
							a model, so it stays offline.
						</p>
					</div>
				</div>

				<div className="border-t border-line px-[26px] py-4">
					{render.status === "idle" && (
						// No progress bar sitting at zero: the button is the only live thing.
						<div className="flex items-center justify-between gap-4">
							<span className="text-[11px] leading-[1.6] text-text3">
								Takes a few minutes for a long episode. You can keep using your machine — it'll be
								slower.
							</span>
							<div className="flex shrink-0 items-center gap-2">
								<button
									type="button"
									disabled
									title="Saving a project to reopen later isn't built yet"
									className="rounded-control border border-dashed border-line px-3 py-2 text-[13px] text-text3"
								>
									Save a draft
								</button>
								<button
									type="button"
									onClick={renderEpisode}
									className="rounded-control bg-accent px-4 py-2 text-[13px] font-medium text-on-accent"
								>
									Render &amp; publish
								</button>
							</div>
						</div>
					)}

					{render.status === "rendering" && (
						<div className="flex flex-col gap-3">
							{/* Indeterminate on purpose: /export reports no progress, and a
							    bar at a made-up percentage would be a lie with a colour. */}
							<div className="h-[5px] w-full overflow-hidden rounded-full bg-track">
								<div className="h-full w-full animate-pulse rounded-full bg-accent/60" />
							</div>
							<div className="flex items-center justify-between gap-4">
								<div className="flex flex-col gap-0.5">
									<span className="text-[13px] font-medium text-text">Rendering the episode</span>
									<span className="text-[11px] text-text3">
										Leave this window open — closing it stops the render.
									</span>
								</div>
								<button
									type="button"
									disabled
									className="shrink-0 rounded-control bg-control px-4 py-2 text-[13px] font-medium text-text3"
								>
									Rendering…
								</button>
							</div>
						</div>
					)}

					{render.status === "done" && (
						<div className="flex items-center justify-between gap-4 rounded-card border border-ok bg-raised p-4">
							<div className="flex min-w-0 flex-col gap-1">
								<span className="text-[13px] font-medium text-text">Your episode is ready</span>
								<span className="text-[11px] text-text3">
									MP4{burnCaptions ? " with captions burned in" : ""}
									{trimDeadAir ? ", dead air trimmed" : ""}.
								</span>
								<span className="truncate font-mono text-[10px] text-text2">{render.filename}</span>
							</div>
							<div className="flex shrink-0 items-center gap-2">
								<button
									type="button"
									onClick={onNew}
									className="rounded-control border border-line px-3 py-2 text-[13px] text-text2"
								>
									New
								</button>
								<a
									href={render.url}
									download={render.filename}
									className="rounded-control bg-accent px-4 py-2 text-[13px] font-medium text-on-accent"
								>
									Save the MP4
								</a>
							</div>
						</div>
					)}

					{render.status === "error" && (
						<div className="flex flex-col gap-2 rounded-card border border-warn bg-raised p-4">
							<div className="flex items-center justify-between gap-4">
								<div className="flex flex-col gap-0.5">
									<span className="text-[13px] font-medium text-text">The render stopped</span>
									<span className="text-[11px] text-text3">Your edits are safe.</span>
								</div>
								<button
									type="button"
									onClick={renderEpisode}
									className="shrink-0 rounded-control bg-accent px-4 py-2 text-[13px] font-medium text-on-accent"
								>
									Try again
								</button>
							</div>
							{/* The raw server message stays underneath the plain-English line,
							    never instead of it -- it has to be pasteable into an issue. */}
							<code className="block rounded-control bg-terminal px-2 py-1.5 font-mono text-[10.5px] leading-[1.5] break-words text-plate-ink">
								{render.message}
							</code>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
