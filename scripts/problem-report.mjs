// The file someone saves when Cutroom misbehaves, to attach to an issue.
//
// The problems that reach us are about the machine -- a Python that won't
// install, a model that won't load, a render ffmpeg refuses -- and every one
// is invisible in "it didn't work". This gathers the few facts that would
// otherwise take a dozen messages to establish.
//
// Written to be sent to a stranger, so it carries no folder names: a path
// holds a person's name, employer and how they organise their disk. Each
// path is cut down to its last part, which is enough to see which file or
// which line of code was involved. Nothing is sent anywhere; the person
// saves the file and decides.

/** Every path in `text` cut to its last part: `/Users/ada/Shows/ep 3.mp4`
 * becomes `…/ep 3.mp4`. The home folder goes first, as a whole string, so a
 * path with spaces in it still loses the username even where the pattern
 * below stops at a space. */
export function scrubPaths(text, home) {
	let out = text;
	if (home) {
		for (const form of new Set([home, home.replaceAll("\\", "/"), home.replaceAll("/", "\\")])) {
			out = out.replaceAll(form, "~");
		}
	}
	return out
		.replace(/(?:[A-Za-z]:)?(?:[\\/][^\s\\/'":,()]+)+[\\/]([^\s\\/'":,()]+)/g, "…/$1")
		.replace(/~(?:[\\/][^\s\\/'":,()]+)*[\\/]([^\s\\/'":,()]+)/g, "…/$1");
}

export function buildReport({ version, platform, arch, osVersion, service, log, home, now = new Date() }) {
	const lines = [
		"Cutroom problem report",
		`Saved ${now.toISOString()}`,
		"",
		`Cutroom ${version}`,
		`System: ${platform} ${osVersion} (${arch})`,
		`Processing service: ${service?.state ?? "unknown"}`,
		"",
		"Recent processing-service output (folder names removed):",
		...(log.length ? log : ["(nothing)"]),
	];
	return scrubPaths(lines.join("\n"), home) + "\n";
}
