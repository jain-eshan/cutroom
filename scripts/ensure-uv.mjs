// The processing service needs `uv` to run at all. A terminal install is the
// one "terminal required" step the packaged app is meant to remove, so on
// first launch, if `uv` isn't found, this fetches it the same way the README
// tells a developer to (https://docs.astral.sh/uv/getting-started/installation/)
// instead of just failing with "needs uv installed".
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

// Where the official installer puts `uv` by default, on each platform.
const INSTALLED_DIR =
	process.platform === "win32"
		? path.join(homedir(), ".local", "bin")
		: path.join(homedir(), ".local", "bin");

// electron/main.mjs awaits ensureUv before starting the processing service, so
// anything here that never settles leaves the setup screen spinning with no
// error and no log line to explain it. A network that accepts the connection
// and then stalls -- a captive portal, a dropped VPN -- does exactly that, so
// every child process gets a deadline rather than trusting it to exit.
const VERSION_CHECK_TIMEOUT_MS = 10_000;
const INSTALL_TIMEOUT_MS = 120_000;

function run(command, args, { timeoutMs, ...options } = {}) {
	return new Promise((resolve) => {
		const child = spawn(command, args, { stdio: "ignore", ...options });
		const timer = setTimeout(() => child.kill(), timeoutMs ?? INSTALL_TIMEOUT_MS);
		const settle = (value) => {
			clearTimeout(timer);
			resolve(value);
		};
		child.on("error", () => settle(false));
		child.on("exit", (code) => settle(code === 0));
	});
}

async function uvAvailable() {
	return run("uv", ["--version"], { timeoutMs: VERSION_CHECK_TIMEOUT_MS });
}

/** Downloaded to a file and run as a separate step rather than piped straight
 * into a shell. In `curl ... | sh` the pipeline's exit status is the shell's,
 * so a curl that fails before producing any output -- no DNS, no route, a
 * captive portal answering with nothing -- feeds an empty script to a shell
 * that cheerfully exits 0. The install then "succeeds" with no uv installed,
 * and the one actionable message this file exists to print never appears. */
async function installUnix() {
	const script = path.join(tmpdir(), "cutroom-uv-install.sh");
	try {
		const fetched = await run("curl", ["-LsSf", "-o", script, "https://astral.sh/uv/install.sh"]);
		return fetched && (await run("sh", [script]));
	} finally {
		await rm(script, { force: true }).catch(() => {});
	}
}

/**
 * Installs `uv` from astral.sh's own installer if it isn't already on PATH,
 * and makes it available to this process's own child_process.spawn calls
 * for the rest of this run. Returns whether `uv` is available afterwards.
 */
export async function ensureUv(log) {
	if (await uvAvailable()) return true;

	log(`"uv" isn't installed -- fetching it from astral.sh, same as the README's setup step.`);
	const ok =
		process.platform === "win32"
			? await run("powershell", [
					"-NoProfile",
					"-ExecutionPolicy",
					"Bypass",
					"-Command",
					// `irm | iex` doesn't have the exit-status problem the shell
					// pipeline does: a failed download throws, and PowerShell exits
					// non-zero.
					"irm https://astral.sh/uv/install.ps1 | iex",
				])
			: await installUnix();

	if (!ok) {
		log("Couldn't install uv automatically. Install it yourself from https://docs.astral.sh/uv/ and restart Cutroom.");
		return false;
	}

	// The installer doesn't update this already-running process's PATH.
	process.env.PATH = `${INSTALLED_DIR}${path.delimiter}${process.env.PATH ?? ""}`;
	return uvAvailable();
}
