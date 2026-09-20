// Starts and supervises the local Python processing service (`server/`),
// and reports its state in the shape `SetupGate.tsx` expects from
// `GET /__service` and `POST /__service/restart`. Shared by the Vite dev
// server (vite.config.ts) and the Electron shell (electron/main.mjs) so the
// two never drift apart on how the service is started or how its state is
// reported.
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";

// Must stay in sync with src/lib/api.ts's API_BASE and server/main.py's port.
//
// Overridable so a QA run can have a service of its very own. The reuse below
// treats any service on this port as interchangeable, which it isn't: a dev
// service and a packaged install have different data directories, so a QA run
// sharing 8787 would either adopt someone's real library or be adopted by
// their app. A separate port keeps the two from ever meeting. See `dev:qa`.
export const SERVICE_PORT = Number(process.env.CUTROOM_SERVICE_PORT ?? 8787);
const LOG_LINES = 40;
// uvicorn's own line announcing it's actually listening.
const READY_MARKER = "Application startup complete";

// Lines that would bury the one that matters: the access log of this app's
// own polling (health every 1.5s, progress every 700ms), and a harmless macOS
// warning about two Python packages each bundling ffmpeg.
const NOISE = [/"GET \/(health|progress\/)[^"]*" \d{3}/, /^objc\[\d+\]:/];

// Long enough for a busy service to answer, short enough that a wedged one
// doesn't hold up startup. A no-answer is treated as "can't confirm", not as
// a refusal, so a slow machine never blocks adoption.
const IDENTITY_TIMEOUT_MS = 2000;

/**
 * Whether a service already on our port is serving the same library we are.
 *
 * `start()` adopts whatever is already listening rather than failing on a
 * taken port, which is right when it's a second terminal or an IDE launch
 * config running the same project. It is wrong when it isn't: a dev service
 * and a packaged install have *different* data directories
 * (`server/pipeline/paths.py`), so adopting the wrong one leaves the app
 * reporting "service ok" over somebody else's -- usually empty -- episode
 * list, with nothing on screen to say why.
 *
 * Pure so it can be tested without a socket. `health` is whatever `/health`
 * returned, or null if it couldn't be reached or parsed.
 */
export function adoptionVerdict(expectedDataDir, health) {
	// An older service predates the `dataDir` field, and an unreachable one
	// tells us nothing. Neither is evidence of a mismatch, and refusing on
	// "don't know" would break the case this reuse exists for.
	if (!health || typeof health.dataDir !== "string") return { adopt: true, confirmed: false };
	const theirs = path.resolve(health.dataDir);
	const ours = path.resolve(expectedDataDir);
	if (theirs === ours) return { adopt: true, confirmed: true };
	return { adopt: false, confirmed: true, theirs, ours };
}

/** Where this launcher expects its service to keep episodes -- the same
 * decision `server/pipeline/paths.py` makes, from the same variable. */
export function expectedDataDir(cwd) {
	return path.resolve(process.env.CUTROOM_DATA_DIR ?? path.join(cwd, "server"));
}

async function readHealth(port) {
	try {
		const res = await fetch(`http://127.0.0.1:${port}/health`, {
			signal: AbortSignal.timeout(IDENTITY_TIMEOUT_MS),
		});
		return res.ok ? await res.json() : null;
	} catch {
		return null;
	}
}

function portInUse(port) {
	return new Promise((resolve) => {
		const socket = net.connect({ port, host: "127.0.0.1" });
		socket.once("connect", () => {
			socket.destroy();
			resolve(true);
		});
		socket.once("error", () => resolve(false));
	});
}

/**
 * Creates a supervisor for the processing service, rooted at `cwd` (the
 * project root -- `server/` is resolved relative to it).
 */
export function createProcessingService(cwd) {
	const service = { child: null, state: "starting", log: [], ranBefore: false, foreign: null };
	// A separate accumulator from service.log: stdio delivers whatever the OS
	// pipe buffer hands it per `data` event, not necessarily a whole line, so
	// READY_MARKER can land split across two chunks. Checking each chunk in
	// isolation missed that split -- the state never flipped to "running"
	// even once uvicorn was actually up, which is not just slow, it's silent
	// (nothing on screen says the service is stuck, since from its own
	// perspective it isn't). Bounded so a long-running dev session doesn't
	// grow this forever; only ever needs to hold one marker's worth of text.
	let stderrTail = "";

	function remember(chunk) {
		for (const line of chunk.toString().split("\n")) {
			if (line.trim() && !NOISE.some((pattern) => pattern.test(line))) service.log.push(line);
		}
		service.log.splice(0, Math.max(0, service.log.length - LOG_LINES));
	}

	async function start() {
		if (service.child) return;
		// Someone already runs it (a second terminal, an IDE launch config): use
		// theirs rather than failing on a taken port -- but only once it has
		// said it serves the same library. See `adoptionVerdict`.
		if (await portInUse(SERVICE_PORT)) {
			const verdict = adoptionVerdict(expectedDataDir(cwd), await readHealth(SERVICE_PORT));
			if (verdict.adopt) {
				service.state = "external";
				service.log.push(
					verdict.confirmed
						? `Using the service already running on port ${SERVICE_PORT}; it serves the same episodes.`
						: `Using the service already running on port ${SERVICE_PORT}. It didn't say which episodes it serves, so this couldn't be confirmed.`,
				);
				return;
			}
			service.state = "foreign";
			service.foreign = { theirs: verdict.theirs, ours: verdict.ours };
			service.log.push(
				`Another Cutroom service is on port ${SERVICE_PORT}, serving ${verdict.theirs} instead of ${verdict.ours}. Not adopted: it would show the wrong episodes.`,
			);
			return;
		}
		service.log.length = 0;
		service.foreign = null;
		service.state = "starting";
		service.ranBefore = false;
		stderrTail = "";
		const child = spawn(
			"uv",
			["run", "--directory", "server", "uvicorn", "main:app", "--port", String(SERVICE_PORT)],
			{ cwd },
		);
		service.child = child;
		child.stdout?.on("data", remember);
		child.stderr?.on("data", (chunk) => {
			remember(chunk);
			stderrTail = (stderrTail + chunk.toString()).slice(-READY_MARKER.length * 4);
			if (stderrTail.includes(READY_MARKER)) {
				service.state = "running";
				service.ranBefore = true;
			}
		});
		child.on("error", (err) => {
			service.log.push(
				`Couldn't start the processing service: ${err.message}. It needs uv installed — see https://docs.astral.sh/uv/`,
			);
			service.state = "exited";
			service.child = null;
		});
		child.on("exit", (code) => {
			if (service.state !== "exited") {
				service.log.push(`The processing service stopped (exit code ${code ?? "none"}).`);
			}
			service.state = "exited";
			service.child = null;
		});
	}

	function stop() {
		service.child?.kill();
	}

	function status() {
		return {
			state: service.state,
			log: service.log,
			ranBefore: Boolean(service.ranBefore),
			// Only set for "foreign": the two libraries, so the screen can name
			// them rather than saying something is wrong somewhere.
			...(service.foreign ? { foreign: service.foreign } : {}),
		};
	}

	return { start, stop, status };
}
