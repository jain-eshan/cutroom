import { useEffect, useState } from "react";
import { getHealth, saveHfToken, type Health } from "@/lib/api";
import { formatDuration } from "@/lib/format";
import { Logo } from "@/components/Logo";

const SERVICE_COMMAND = "cd server && uv run uvicorn main:app --port 8787";
const POLL_MS = 1500;
/** A beat to see "Ready" before the app opens; success shouldn't need a click. */
const CONFIRM_MS = 700;
/** How long to wait for the dev server to report the service before assuming
 * this copy of the app can't start it (a static build, say). */
const UNMANAGED_AFTER_MS = 8000;

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

function Heading({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div className="flex flex-col gap-2">
			<h1 className="text-[19px] font-semibold tracking-[-0.01em] text-text">{title}</h1>
			<p className="text-[12.5px] leading-[1.6] text-text3">{children}</p>
		</div>
	);
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
		<form onSubmit={submit} className="flex flex-col gap-2">
			<div className="flex gap-2">
				<input
					type="password"
					autoComplete="off"
					spellCheck={false}
					value={token}
					onChange={(e) => {
						setToken(e.target.value);
						if (state.status === "error") setState({ status: "idle" });
					}}
					placeholder="Paste your token (hf_…)"
					aria-label="Hugging Face token"
					className="min-w-0 flex-1 rounded-control border border-line bg-panel px-2.5 py-2 font-mono text-[12px] text-text"
				/>
				<button
					type="submit"
					disabled={!token.trim() || checking || state.status === "saved"}
					className="shrink-0 rounded-control bg-accent px-4 py-2 text-[13px] font-medium text-on-accent disabled:opacity-40"
				>
					{checking ? "Checking…" : state.status === "saved" ? "Saved" : "Save"}
				</button>
			</div>
			{state.status === "error" && <p className="text-[11px] leading-[1.6] text-warn">{state.message}</p>}
			<p className="text-[11px] text-text3">Kept on this machine only.</p>
		</form>
	);
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
	return (
		<li className="flex gap-3">
			<span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-control font-mono text-[11px] text-text2">
				{n}
			</span>
			<div className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5">{children}</div>
		</li>
	);
}

function OutLink({ href, children }: { href: string; children: React.ReactNode }) {
	return (
		<a
			href={href}
			target="_blank"
			rel="noreferrer"
			className="w-fit rounded-control border border-line bg-raised px-3 py-1.5 text-[12.5px] font-medium text-text"
		>
			{children} ↗
		</a>
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

	useEffect(() => {
		let cancelled = false;
		const tick = async () => {
			const [h, s] = await Promise.all([getHealth().catch(() => null), getService()]);
			if (cancelled) return;
			setHealth(h);
			setService(s);
			setNow(Date.now());
		};
		void tick();
		const id = setInterval(tick, POLL_MS);
		return () => {
			cancelled = true;
			clearInterval(id);
		};
	}, []);

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

	let body: React.ReactNode;
	if (ready) {
		body = <Heading title="Ready">Opening Cutroom…</Heading>;
	} else if (health) {
		body = (
			<>
				<Heading title="Connect Hugging Face">
					Telling voices apart uses a free model from Hugging Face, and it needs your account's
					go-ahead. You only do this once.
				</Heading>
				<ol className="flex flex-col gap-4">
					<Step n={1}>
						<OutLink href="https://huggingface.co/settings/tokens">Create a token</OutLink>
						<span className="text-[11px] text-text3">Read access is enough.</span>
					</Step>
					<Step n={2}>
						<OutLink href="https://huggingface.co/pyannote/speaker-diarization-community-1">
							Agree to the model's terms
						</OutLink>
						<span className="text-[11px] text-text3">Signed in to the same account.</span>
					</Step>
					<Step n={3}>
						<TokenForm />
					</Step>
				</ol>
			</>
		);
	} else if (service?.state === "exited") {
		body = (
			<>
				<Heading
					title={
						service.ranBefore
							? "The processing service stopped"
							: "The processing service couldn't start"
					}
				>
					{service.ranBefore
						? "It was running, then stopped. This is the last thing it said:"
						: "This is what it said:"}
				</Heading>
				<code className="block max-h-44 overflow-auto rounded-control bg-terminal px-2.5 py-2 font-mono text-[10.5px] leading-[1.5] whitespace-pre-wrap text-plate-ink">
					{service.log.slice(-12).join("\n") || "It didn't print anything."}
				</code>
				<button
					type="button"
					onClick={retry}
					disabled={retrying}
					className="w-fit rounded-control bg-accent px-4 py-2 text-[13px] font-medium text-on-accent disabled:opacity-40"
				>
					{retrying ? "Starting…" : "Try again"}
				</button>
			</>
		);
	} else if (service === null && now - startedAt > UNMANAGED_AFTER_MS) {
		body = (
			<>
				<Heading title="Start the processing service">
					This copy of Cutroom can't start it by itself. Run this in a terminal in the project
					folder, and this page will move on when it's up:
				</Heading>
				<code className="block rounded-control bg-terminal px-2.5 py-2 font-mono text-[11.5px] leading-[1.5] break-words text-plate-ink">
					{SERVICE_COMMAND}
				</code>
			</>
		);
	} else {
		body = (
			<>
				<Heading title="Getting ready">
					Starting the processing service on this machine. The very first start installs it, which
					can take a few minutes — this page moves on by itself.
				</Heading>
				{/* Indeterminate: there's no honest percentage for an install. */}
				<div className="h-[5px] w-full overflow-hidden rounded-full bg-track">
					<div className="h-full w-full animate-pulse rounded-full bg-accent/60" />
				</div>
				<span className="font-mono text-[10.5px] text-text3">{formatDuration((now - startedAt) / 1000)}</span>
			</>
		);
	}

	return (
		<div className="flex min-h-screen flex-col items-center justify-center bg-bg px-6 py-10">
			<div className="flex w-full max-w-[440px] flex-col gap-5 rounded-panel border border-line bg-panel p-[26px]">
				<Logo size={26} className="text-text" />
				{body}
			</div>
		</div>
	);
}
