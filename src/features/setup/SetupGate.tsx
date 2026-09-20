import { useEffect, useState } from "react";
import { API_BASE, getHealth, type Health } from "@/lib/api";
import { formatDuration } from "@/lib/format";
import { Button, CommandBlock, RawMessage, Screen, ScreenHeading, StatusRow } from "@/components/ui";

const SERVICE_COMMAND = "cd server && uv run uvicorn main:app --port 8787";
const POLL_MS = 1500;
/** A beat to see "Ready" before the app opens; success shouldn't need a click. */
const CONFIRM_MS = 700;
/** How long to wait for the dev server to report the service before assuming
 * this copy of the app can't start it (a static build, say). */
const UNMANAGED_AFTER_MS = 8000;
/** How long the service can claim to be up while /health still doesn't answer
 * before this is treated as a fault rather than a slow start. Measured from
 * when it first said so, not from when this screen opened, so a legitimately
 * long first install doesn't trip it. Once it reports "Application startup
 * complete" uvicorn is already listening, so /health answers on the next poll
 * or something is actually wrong. */
const UNRESPONSIVE_AFTER_MS = 20000;

type Service = {
	state: "starting" | "running" | "exited" | "external";
	log: string[];
	/** Whether it got as far as serving requests before it exited. */
	ranBefore: boolean;
};

/** What the dev server says about the processing service it started. Null
 * when nothing answers -- a production build has no dev server to ask. */
async function getService(): Promise<Service | null> {
	try {
		const res = await fetch("/__service");
		if (!res.ok) return null;
		return (await res.json()) as Service;
	} catch {
		// Includes a static host returning index.html for the path.
		return null;
	}
}

/**
 * Gets the machine ready, and only shows what needs the person in front of it.
 * With a working setup it opens and closes in about a second, and nothing is
 * ever asked of anyone: the processing service is started by the dev server
 * (see vite.config.ts) or by Electron, and the speaker detection model ships
 * with the app. This screen used to hold a Hugging Face sign-up, licence
 * acceptance and a token to paste, because that model downloaded from a gated
 * repo; it is bundled now (see server/pipeline/diarize.py), so all that is
 * left here is saying which pieces are up.
 */
export function SetupGate({ onReady }: { onReady: (health: Health) => void }) {
	const [health, setHealth] = useState<Health | null>(null);
	// undefined until the first answer; null when no dev server is managing it.
	const [service, setService] = useState<Service | null | undefined>(undefined);
	const [startedAt] = useState(() => Date.now());
	const [now, setNow] = useState(() => Date.now());
	const [retrying, setRetrying] = useState(false);
	// When the service first claimed to be up, so "up but not answering" is
	// timed from that rather than from when this screen opened.
	const [upSince, setUpSince] = useState<number | null>(null);

	useEffect(() => {
		let cancelled = false;
		const tick = async () => {
			const [h, s] = await Promise.all([getHealth().catch(() => null), getService()]);
			if (cancelled) return;
			setHealth(h);
			setService(s);
			setNow(Date.now());
			const up = s?.state === "running" || s?.state === "external";
			setUpSince((previous) => (up ? (previous ?? Date.now()) : null));
		};
		void tick();
		const id = setInterval(tick, POLL_MS);
		return () => {
			cancelled = true;
			clearInterval(id);
		};
	}, []);

	const serviceUp = service?.state === "running" || service?.state === "external";

	// Speaker detection is required: without speaker turns there's nothing to
	// edit, and finding out after a multi-minute transcription is what this
	// screen exists to prevent.
	const ready = health?.diarization === true;

	useEffect(() => {
		if (!health || !ready) return;
		const id = setTimeout(() => onReady(health), CONFIRM_MS);
		return () => clearTimeout(id);
	}, [health, ready, onReady]);

	async function retry() {
		setRetrying(true);
		try {
			await fetch("/__service/restart", { method: "POST" });
		} finally {
			setRetrying(false);
		}
	}

	const serviceHost = new URL(API_BASE).host;
	const log = (lines: string[] | undefined) => lines?.slice(-12).join("\n") || "It didn't print anything.";
	const tryAgain = (
		<Button variant="primary" onClick={retry} disabled={retrying} className="self-start">
			{retrying ? "Starting…" : "Try again"}
		</Button>
	);

	// The processing service, and what to do about it when it's not answering.
	let serviceRow: React.ReactNode;
	if (health) {
		serviceRow = <StatusRow state="ok" title="The processing service" detail={`${serviceHost} · responding`} />;
	} else if (service?.state === "exited") {
		serviceRow = (
			<StatusRow
				state="active"
				title="The processing service"
				detail={service.ranBefore ? `${serviceHost} · stopped` : `${serviceHost} · couldn't start`}
			>
				<p className="text-meta text-text2">
					{service.ranBefore
						? "It was running, then stopped. This is the last thing it said:"
						: "It couldn't start. This is what it said:"}
				</p>
				<RawMessage className="max-h-44 overflow-auto">{log(service.log)}</RawMessage>
				{tryAgain}
			</StatusRow>
		);
	} else if (serviceUp && upSince !== null && now - upSince > UNRESPONSIVE_AFTER_MS) {
		// Everything above this is a state that explains itself. This one used
		// to fall through to "starting" and sit there forever: the service
		// says it is up, /health keeps failing, and nothing on screen says so or
		// offers a way out.
		const external = service?.state === "external";
		serviceRow = (
			<StatusRow
				state="active"
				title="The processing service"
				detail={external ? `${serviceHost} · something else is on this port` : `${serviceHost} · not answering`}
			>
				<p className="text-meta text-text2">
					{external
						? "Cutroom found a service already running on its port and left it alone, but it isn't answering as Cutroom would. If that's another copy of Cutroom, close it and try again; if it's a different program, quit it first."
						: "It started, but it isn't responding to requests. This is the last thing it said:"}
				</p>
				<RawMessage className="max-h-44 overflow-auto">{log(service?.log)}</RawMessage>
				{tryAgain}
			</StatusRow>
		);
	} else if (service === null && now - startedAt > UNMANAGED_AFTER_MS) {
		serviceRow = (
			<StatusRow state="active" title="The processing service" detail={`${serviceHost} · not answering`}>
				<p className="text-meta text-text2">
					This copy of Cutroom can't start it by itself. Open a terminal in the project folder and paste
					this. This page moves on when it's up.
				</p>
				<CommandBlock command={SERVICE_COMMAND} />
			</StatusRow>
		);
	} else {
		// Indeterminate: there's no honest percentage for an install, so the
		// elapsed time is the signal, not a pulse.
		serviceRow = (
			<StatusRow
				state="active"
				title="The processing service"
				detail={`${serviceHost} · starting · ${formatDuration((now - startedAt) / 1000)}`}
			>
				<p className="text-meta text-text2">
					The very first start installs it, which can take a few minutes. This page moves on by itself.
				</p>
			</StatusRow>
		);
	}

	return (
		<Screen width={560}>
			<ScreenHeading title={ready ? "Ready" : "Two things need to be running"}>
				Cutroom does the work on this machine. Nothing uploads, so both pieces have to be here.
			</ScreenHeading>

			<div className="flex flex-col gap-[11px]">
				<StatusRow state="ok" title="This window" detail={`${window.location.host} · ready`} />
				{serviceRow}
				{!health ? (
					<StatusRow state="pending" title="Speaker models" detail="pyannote · waits for the service" />
				) : health.diarization ? (
					<StatusRow state="ok" title="Speaker models" detail="pyannote community-1 · installed" />
				) : (
					// Only reachable from a damaged install: the weights ship inside
					// the app, so there is no step here for anyone to have skipped.
					<StatusRow state="active" title="Speaker models" detail="pyannote community-1 · missing">
						<p className="text-meta text-text2">
							The speaker detection model isn't where it should be, which means this copy of Cutroom
							didn't install completely. Installing it again replaces it.
						</p>
					</StatusRow>
				)}
				{health?.captions ? (
					<StatusRow state="ok" title="Captions" detail="ffmpeg with libass · captions can be burned in" />
				) : (
					<StatusRow
						state="pending"
						optional
						title="Captions"
						detail={
							health
								? "optional · this ffmpeg has no libass, so captions will be skipped"
								: "optional · checked once the service is up"
						}
					/>
				)}
			</div>

			<div className="flex items-center gap-[14px] pt-1">
				<Button variant="inert">
					{ready ? "Opening Cutroom…" : health ? "Checking the install…" : "Waiting for the service…"}
				</Button>
			</div>
		</Screen>
	);
}
