import { useEffect, useState } from "react";
import {
	exportVideo,
	exportVideoToPath,
	getRenderProgress,
	type DetectFacesResponse,
	type Health,
	type Turn,
	type Word,
} from "@/lib/api";
import { chooseExportPath, hasElectronBridge, showItemInFolder } from "@/lib/electron";
import { formatDuration } from "@/lib/format";
import { Button, ButtonLink, CheckMark, CommandBlock, RawMessage, Screen, ScreenHeading, SectionLabel } from "@/components/ui";
import type { FramingRegion } from "@/features/timeline/types";

type RenderState =
	| { status: "idle" }
	// Real progress, parsed by the service from ffmpeg's own output -- 0
	// until the first update arrives, same as the pipeline's own stages.
	| { status: "rendering"; fraction: number }
	// The desktop app writes straight to `outputPath` and never holds the
	// render in memory; a plain browser has nothing but the downloaded blob.
	| { status: "done"; filename: string; save: { kind: "download"; url: string } | { kind: "path"; outputPath: string } }
	| { status: "error"; message: string };

/**
 * One thing the episode can come out with. Unbuilt artefacts are shown at
 * full opacity with a chip that says so, rather than hidden or faded: the
 * manifest is the honest list of what an episode needs, and pretending the
 * gaps aren't there would make it a sales page.
 */
function Artefact({
	title,
	subline,
	checked,
	onToggle,
	unbuilt,
}: {
	title: string;
	subline: string;
	checked: boolean;
	onToggle?: () => void;
	unbuilt?: boolean;
}) {
	return (
		<button
			type="button"
			role="checkbox"
			aria-checked={checked}
			aria-disabled={!onToggle}
			onClick={onToggle}
			className={`flex w-full items-center gap-[11px] rounded-card border border-line bg-chrome px-3 py-[10px] text-left ${
				onToggle ? "" : "cursor-default"
			}`}
		>
			<CheckMark checked={checked} />
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="text-ui leading-[1.3] font-medium text-text">{title}</span>
				<span className="font-mono text-mono-sm text-text3">{subline}</span>
			</span>
			{unbuilt && (
				<span className="shrink-0 rounded-chip bg-beta-bg px-2 py-[5px] font-mono text-label font-medium tracking-[0.04em] text-beta uppercase">
					Not built yet
				</span>
			)}
		</button>
	);
}

function Destination({ label, selected }: { label: string; selected?: boolean }) {
	return (
		<span
			title={selected ? undefined : "Not built yet"}
			className={`inline-flex items-center rounded-control border px-[11px] py-2 text-mono-sm leading-none font-medium whitespace-nowrap ${
				selected ? "border-accent-edge bg-raised text-text" : "border-line text-text3"
			}`}
		>
			{label}
		</span>
	);
}

export function PublishScreen({
	fileName,
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
	fileName: string;
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
	const stem = fileName.replace(/\.[^.]+$/, "");

	// The download link holds the whole rendered episode in memory -- only
	// true for the plain-browser path; the desktop app's render never
	// touches an object URL at all.
	useEffect(() => {
		if (render.status !== "done" || render.save.kind !== "download") return;
		const { url } = render.save;
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
		const filename = `${stem}-edited.mp4`;

		// Asked before rendering starts, not after: rendering is up to 15
		// minutes of work, and only the desktop app has a real folder to
		// offer -- a plain browser has nowhere to save to but its own
		// downloads flow, via the returned blob below.
		let outputPath: string | null = null;
		if (hasElectronBridge()) {
			outputPath = await chooseExportPath(filename);
			if (outputPath === null) return; // the user cancelled the save dialog
		}

		setRender({ status: "rendering", fraction: 0 });
		// Polled independently of the request below, which stays open for the
		// whole render and carries no progress of its own -- this is a side
		// channel onto the same job id, not part of that request/response.
		const pollId = setInterval(() => {
			void getRenderProgress(sessionId)
				.then(({ fraction }) => setRender((r) => (r.status === "rendering" ? { status: "rendering", fraction } : r)))
				.catch(() => {}); // transient -- the next tick retries
		}, 700);
		try {
			const regionArgs = regions.map((r) => ({
				start: r.start,
				end: r.end,
				layout: r.layout,
				personIds: r.personIds,
				source: r.source,
				cropNudge: r.cropNudge,
			}));
			const turnArgs = turns.map((t) => ({ start: t.start, end: t.end }));
			if (outputPath) {
				await exportVideoToPath(outputPath, sessionId, regionArgs, turnArgs, faces, words, burnCaptions, trimDeadAir);
				setRender({ status: "done", filename, save: { kind: "path", outputPath } });
			} else {
				const blob = await exportVideo(sessionId, regionArgs, turnArgs, faces, words, burnCaptions, trimDeadAir);
				setRender({ status: "done", filename, save: { kind: "download", url: URL.createObjectURL(blob) } });
			}
		} catch (err) {
			setRender({
				status: "error",
				message: err instanceof Error ? err.message : "The render failed for an unknown reason.",
			});
		} finally {
			clearInterval(pollId);
		}
	}

	const rendering = render.status === "rendering";
	const size = faces.frameWidth > 0 ? `${faces.frameWidth}×${faces.frameHeight}` : "audio only";

	// The right-hand card: what's about to render, then the render itself.
	let status: React.ReactNode;
	if (render.status === "idle") {
		status = (
			<div className="flex flex-col gap-[9px] rounded-card-lg border border-line bg-chrome p-[14px]">
				<SectionLabel>Episode</SectionLabel>
				<span className="font-mono text-clock text-accent">{formatDuration(duration)}</span>
				<span className="font-mono text-mono-sm text-text3">
					{size} · {turns.length} turns · {changed} you changed
				</span>
			</div>
		);
	} else if (render.status === "rendering") {
		const percent = Math.round(render.fraction * 100);
		status = (
			<div className="flex flex-col gap-[13px] rounded-[10px] border border-line bg-bg p-5">
				<span className="font-mono text-label font-medium tracking-[0.08em] text-accent-text">RENDERING</span>
				<span className="text-section font-semibold text-text">Rendering the episode</span>
				{/* Real progress, parsed by the service from ffmpeg's own output
				    -- see getRenderProgress. Sits at 0% until the encode itself
				    starts, which is honest: nothing has rendered yet. */}
				<span className="block h-[5px] overflow-hidden rounded-[3px] bg-track">
					<span
						className="block h-full rounded-[3px] bg-accent transition-[width] duration-[240ms] ease-linear"
						style={{ width: `${percent}%` }}
					/>
				</span>
				<span className="font-mono text-mono-sm leading-none text-text2">{percent}%</span>
				<p className="text-ui leading-[1.6] text-text2">Leave this window open — closing it stops the render.</p>
			</div>
		);
	} else if (render.status === "done") {
		// Narrowing `render.save.kind` doesn't carry into an onClick closure --
		// TS can't prove the property won't change by the time it runs -- so
		// it's captured in a local first.
		const save = render.save;
		status = (
			<div className="flex flex-col gap-[13px] rounded-[10px] border border-ok-edge bg-bg p-5">
				<span className="font-mono text-label font-medium tracking-[0.08em] text-ok">DONE</span>
				<span className="text-section font-semibold text-text">Your episode is ready</span>
				<p className="text-ui leading-[1.6] text-text2">
					MP4{burnCaptions ? " with captions burned in" : ""}
					{trimDeadAir ? ", dead air trimmed" : ""}.
				</p>
				<span className="font-mono text-mono-sm break-all text-text3">
					{save.kind === "path" ? save.outputPath : render.filename}
				</span>
				<div className="flex gap-[7px]">
					{save.kind === "path" ? (
						<Button variant="primary" full onClick={() => showItemInFolder(save.outputPath)}>
							Show me
						</Button>
					) : (
						<ButtonLink variant="primary" className="flex-1" href={save.url} download={render.filename}>
							Save the MP4
						</ButtonLink>
					)}
					<Button onClick={onNew}>New</Button>
				</div>
			</div>
		);
	} else {
		status = (
			<div className="flex flex-col gap-[13px] rounded-[10px] border border-warn-edge bg-bg p-5">
				<span className="font-mono text-label font-medium tracking-[0.08em] text-warn">FAILED</span>
				<span className="text-section font-semibold text-text">The render stopped</span>
				{/* The raw server message stays underneath the plain-English line,
				    never instead of it -- it has to be pasteable into an issue. */}
				<RawMessage>{render.message}</RawMessage>
				<p className="text-ui leading-[1.6] text-text2">Your edits are safe. Run it again, or go back and change something first.</p>
				<Button variant="primary" full onClick={renderEpisode}>
					Try again
				</Button>
			</div>
		);
	}

	return (
		<Screen width={820}>
			<div className="flex gap-[26px]">
				<div className="flex min-w-0 flex-1 flex-col gap-[18px]">
					<ScreenHeading title="Render and publish">
						Everything below is made on this machine. Nothing is uploaded.
					</ScreenHeading>

					<section className="flex flex-col gap-[9px]">
						<SectionLabel>What you get</SectionLabel>
						<Artefact
							title="The episode"
							subline={`${stem}-edited.mp4 · ${size} · ${
								trimDeadAir ? "dead air trimmed, audio re-encoded" : "original audio untouched"
							}`}
							checked
						/>
						<Artefact
							title="Captions"
							subline={captionsAvailable ? "burned in, cut from the word timings" : "need an ffmpeg built with libass"}
							checked={burnCaptions}
							onToggle={captionsAvailable ? () => onCaptionsChange(!captions) : undefined}
						/>
						<Artefact title="Chapters" subline="the transcript has what they'd need" checked={false} unbuilt />
						<Artefact title="Show notes" subline="a draft from the transcript, yours to rewrite" checked={false} unbuilt />
						<Artefact
							title="Short clips"
							subline="9:16 · cut where the talk is dense and nobody interrupts"
							checked={false}
							unbuilt
						/>
					</section>

					<section className="flex flex-col gap-[9px]">
						<SectionLabel>Where it goes</SectionLabel>
						<div className="flex flex-wrap gap-[9px]">
							<Destination label="A folder on this Mac" selected />
							<Destination label="YouTube" />
							<Destination label="RSS / podcast host" />
						</div>
						<p className="text-fine text-pretty text-text3">
							Connecting a destination is the only thing here that would ever leave your machine, and it'll
							ask first, every time. Only the folder is built so far.
						</p>
					</section>

					{!captionsAvailable && (
						<div className="flex flex-col gap-[9px] rounded-card border border-warn-edge bg-chrome px-[14px] py-[13px]">
							<span className="flex items-center gap-[9px]">
								<span className="h-[7px] w-[7px] rounded-full bg-warn" />
								<span className="text-ui leading-[1.3] font-semibold text-text">Captions will be skipped</span>
							</span>
							<p className="text-meta text-pretty text-text2">
								This ffmpeg was built without subtitle support, so captions can't be burned in. We're
								telling you now rather than after the render. The video and audio render normally.
							</p>
							<CommandBlock command="brew install ffmpeg-full" />
							<p className="text-fine text-text3">
								Then set <span className="font-mono">FFMPEG_BINARY</span> in{" "}
								<span className="font-mono">server/.env</span> and restart the service.
							</p>
						</div>
					)}
				</div>

				<div className="flex w-[240px] shrink-0 flex-col gap-[14px]">
					{status}
					<div className="flex flex-col gap-[11px]">
						{render.status === "idle" && (
							<Button variant="primary" size="lg" full onClick={renderEpisode}>
								Render &amp; publish
							</Button>
						)}
						<Button full onClick={onBack} disabled={rendering}>
							Back to editing
						</Button>
						{render.status === "idle" && (
							<Button variant="inert" full title="Saving a project to reopen later isn't built yet">
								Save a draft
							</Button>
						)}
					</div>
					{render.status === "idle" && (
						<p className="text-fine text-pretty text-text3">
							Drafts aren't built yet: your edits last until this window closes. Rendering takes a few
							minutes for a long episode, and you can keep using your machine meanwhile.
						</p>
					)}
				</div>
			</div>
		</Screen>
	);
}
