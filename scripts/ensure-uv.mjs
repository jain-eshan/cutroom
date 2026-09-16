// The processing service needs `uv` to run at all. A terminal install is the
// one "terminal required" step the packaged app is meant to remove, so on
// first launch, if `uv` isn't found, this fetches it the same way the README
// tells a developer to (https://docs.astral.sh/uv/getting-started/installation/)
// instead of just failing with "needs uv installed".
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";

// Where the official installer puts `uv` by default, on each platform.
const INSTALLED_DIR =
	process.platform === "win32"
		? path.join(homedir(), ".local", "bin")
		: path.join(homedir(), ".local", "bin");

function run(command, args, options = {}) {
	return new Promise((resolve) => {
		const child = spawn(command, args, { stdio: "ignore", ...options });
		child.on("error", () => resolve(false));
		child.on("exit", (code) => resolve(code === 0));
	});
}

async function uvAvailable() {
	return run("uv", ["--version"]);
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
					"irm https://astral.sh/uv/install.ps1 | iex",
				])
			: await run("sh", ["-c", "curl -LsSf https://astral.sh/uv/install.sh | sh"]);

	if (!ok) {
		log("Couldn't install uv automatically. Install it yourself from https://docs.astral.sh/uv/ and restart Cutroom.");
		return false;
	}

	// The installer doesn't update this already-running process's PATH.
	process.env.PATH = `${INSTALLED_DIR}${path.delimiter}${process.env.PATH ?? ""}`;
	return uvAvailable();
}
