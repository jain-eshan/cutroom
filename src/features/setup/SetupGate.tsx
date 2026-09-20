import { useEffect, useState } from "react";
import { API_BASE, getHealth, saveHfToken, type Health } from "@/lib/api";
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
	/** `foreign`: another Cutroom service holds the port, but it serves a
	 * different library, so this copy refused to adopt it (see
	 * `adoptionVerdict` in scripts/processing-service.mjs). */
	state: "starting" | "running" | "exited" | "external" | "foreign";
	log: string[];
	/** Whether it got as far as serving requests before it exited. */
	ranBefore: boolean;
	/** Only on `foreign`: the two libraries, so this screen can name them. */
	foreign?: { theirs: string; ours: string };
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

type TokenState =
	| { status: "idle" }
	| { status: "checking" }
	| { status: "saved" }
	| { status: "error"; message: string };

/** Paste and save. The service checks the token with Hugging Face -- licence
 * included -- before keeping it, so a wrong token is caught here, not mid-job. */
function TokenForm() {
	const [token, setToken] = useState("");
	const [state, setState] = useState<TokenState>({ status: "idle" });
	const checking = state.status === "checking";

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		setState({ status: "checking" });
		try {
			await saveHfToken(token.trim());
			// The next health poll sees the token and the screen moves on.
			setState({ status: "saved" });
		} catch (err) {
			setState({
				status: "error",
				message: err instanceof Error ? err.message : "Couldn't save the token.",
			});
		}
	}

	return (
		<form onSubmit={submit} className="flex flex-col gap-[7px]">
			<div className="flex gap-[9px]">
				<input
					type="password"
					autoComplete="off"
					spellCheck={false}
					value={token}
					onChange={(e) => {
						setToken(e.target.value);
						if (state.status === "error") setState({ status: "idle" });
					}}
					placeholder="hf_…"
					aria-label="Hugging Face token"
					className="min-w-0 flex-1 rounded-control-lg border border-line bg-well px-3 py-[10px] font-mono text-mono leading-none text-text outline-none focus:border-accent-edge"
				/>
				<Button type="submit" variant="primary" disabled={!token.trim() || checking || state.status === "saved"}>
					{checking ? "Checking…" : state.status === "saved" ? "Saved" : "Save token"}
				</Button>
			</div>
			{state.status === "error" && <p className="text-fine text-warn">{state.message}</p>}
		</form>
	);
}

/**
 * Gets the machine ready, and only shows what needs the person in front of it.
 * With a working setup it opens and closes in about a second. The processing
 * service is started by the dev server (see vite.config.ts), so the only
 * things ever asked of anyone are the Hugging Face steps -- which have to
 * happen on their account -- and pasting the token back here.
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
	} else if (service?.state === "foreign") {
		// The one failure here that looks like success: the port answers, and
		// answers correctly, for somebody else's episodes. Adopting it would
		// have shown an empty library under a green tick, so it is refused --
		// and this says so, with both paths, because "wrong service" means
		// nothing without them.
		serviceRow = (
			<StatusRow
				state="active"
				title="The processing service"
				detail={`${serviceHost} · another copy is using this port`}
			>
				<p className="text-meta text-pretty text-text2">
					Another Cutroom service is already on this port, but it keeps its episodes somewhere else, so
					this window left it alone rather than showing you the wrong library. Quit the other copy — or
					the terminal running it — and try again.
				</p>
				{service.foreign && (
					<dl className="flex flex-col gap-1 text-fine text-text3">
						<div className="flex gap-2">
							<dt className="shrink-0">It serves</dt>
							<dd className="font-mono break-all text-text2">{service.foreign.theirs}</dd>
						</div>
						<div className="flex gap-2">
							<dt className="shrink-0">You want</dt>
							<dd className="font-mono break-all text-text2">{service.foreign.ours}</dd>
						</div>
					</dl>
				)}
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
					<StatusRow state="ok" title="Speaker models" detail="pyannote · token saved" />
				) : (
					<StatusRow state="active" title="Speaker models" detail="pyannote · needs a one-time access token">
						<ol className="flex flex-col gap-[11px] pl-[30px]">
							<li className="flex items-start gap-[11px]">
								<span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-control font-mono text-mono-sm leading-none text-text2">
									1
								</span>
								<span className="pt-0.5 text-ui text-text2">
									Signed in to Hugging Face,{" "}
									<a
										href="https://huggingface.co/pyannote/speaker-diarization-community-1"
										target="_blank"
										rel="noreferrer"
										className="text-accent-text hover:text-accent"
									>
										agree to the model's terms
									</a>
									. It's free.
								</span>
							</li>
							<li className="flex items-start gap-[11px]">
								<span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-control font-mono text-mono-sm leading-none text-text2">
									2
								</span>
								<span className="pt-0.5 text-ui text-text2">
									<a
										href="https://huggingface.co/settings/tokens"
										target="_blank"
										rel="noreferrer"
										className="text-accent-text hover:text-accent"
									>
										Create a read token
									</a>{" "}
									and paste it here. It's kept on this machine only.
								</span>
							</li>
							<TokenForm />
						</ol>
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
					{ready ? "Opening Cutroom…" : health ? "Waiting for the token…" : "Waiting for the service…"}
				</Button>
			</div>
		</Screen>
	);
}
