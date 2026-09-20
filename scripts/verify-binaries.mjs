// Fails the build when a bundled ffmpeg/ffprobe isn't built for the
// architecture the installer targets.
//
// This exists because of a real shipped bug. `ffprobe-static` bundles every
// architecture in one tarball and picks a directory by os.arch() at runtime,
// and the file it keeps under bin/darwin/arm64/ is an x86_64 build. The
// packaged app therefore pointed FFPROBE_BINARY at an Intel binary on Apple
// Silicon. Macs with Rosetta ran it anyway; Macs without it -- which is any
// clean modern install -- got OSError errno 86, "Bad CPU type in executable",
// on the first file anyone tried to open. Nothing in CI noticed, because
// nothing in CI ever executed the binary.
//
// Reading the arch off the file is the check that catches the whole class:
// wrong package, wrong npm_config_arch, a dependency silently changing what
// it prebuilds. It runs at afterPack, on the real files inside the real
// bundle, so it checks what actually ships rather than what was intended.
import { readdir, open } from "node:fs/promises";
import path from "node:path";

// electron-builder's Arch enum, which reaches us as a bare number.
const ARCH_NAMES = { 0: "ia32", 1: "x64", 2: "armv7l", 3: "arm64", 4: "universal" };

const MACHO_64 = 0xfeedfacf;
const MACHO_FAT = 0xcafebabe;
const MACHO_CPU = { 0x01000007: "x64", 0x0100000c: "arm64", 0x00000007: "ia32" };
const PE_MACHINE = { 0x8664: "x64", 0x014c: "ia32", 0xaa64: "arm64" };

/** Which architectures an executable actually contains, read from its header.
 * Returns [] for a file this doesn't recognise as an executable. */
export async function archsOf(file) {
	const handle = await open(file, "r");
	try {
		const head = Buffer.alloc(64);
		await handle.read(head, 0, 64, 0);

		// Mach-O, single architecture. The magic is little-endian on disk for
		// the 64-bit variant, which is the only one anything still ships.
		if (head.readUInt32LE(0) === MACHO_64) {
			return [MACHO_CPU[head.readUInt32LE(4) >>> 0] ?? `unknown(${head.readUInt32LE(4)})`];
		}
		// Mach-O universal ("fat"): a big-endian header, then one entry per
		// slice. Worth handling properly -- a fat binary carrying only x86_64
		// is exactly as broken as a thin one, and looks fine to `file`.
		if (head.readUInt32BE(0) === MACHO_FAT) {
			const count = head.readUInt32BE(4);
			const table = Buffer.alloc(count * 20);
			await handle.read(table, 0, table.length, 8);
			return Array.from({ length: count }, (_, i) => {
				const cpu = table.readUInt32BE(i * 20) >>> 0;
				return MACHO_CPU[cpu] ?? `unknown(${cpu})`;
			});
		}
		// PE/COFF: "MZ", a pointer to the PE header at 0x3c, then the machine
		// word four bytes past the "PE\0\0" signature.
		if (head.readUInt16LE(0) === 0x5a4d) {
			const peOffset = head.readUInt32LE(0x3c);
			const pe = Buffer.alloc(6);
			await handle.read(pe, 0, 6, peOffset);
			if (pe.readUInt32LE(0) !== 0x00004550) return [];
			const machine = pe.readUInt16LE(4);
			return [PE_MACHINE[machine] ?? `unknown(0x${machine.toString(16)})`];
		}
		return [];
	} finally {
		await handle.close();
	}
}

const BINARY_NAMES = new Set(["ffmpeg", "ffprobe", "ffmpeg.exe", "ffprobe.exe"]);

async function findBinaries(dir) {
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	const found = [];
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) found.push(...(await findBinaries(full)));
		else if (BINARY_NAMES.has(entry.name)) found.push(full);
	}
	return found;
}

export default async function verifyBinaries(context) {
	const target = ARCH_NAMES[context.arch];
	if (!target) throw new Error(`verify-binaries: unrecognised target arch ${context.arch}`);

	// Mirrors scripts/afterSign.mjs's path construction rather than reaching
	// into electron-builder internals for the resources directory.
	const resources =
		context.electronPlatformName === "darwin"
			? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
			: path.join(context.appOutDir, "resources");
	const unpacked = path.join(resources, "app.asar.unpacked", "node_modules");

	const binaries = await findBinaries(unpacked);
	// A missing binary is a failure too, and a quieter one than a wrong-arch
	// binary: the globs can stop matching, or a package's install script can
	// be skipped so it never downloads what it ships, and the app packages
	// happily with nothing to run. Both names are required, not just a
	// non-empty list -- the pipeline needs each of them.
	for (const name of ["ffmpeg", "ffprobe"]) {
		if (!binaries.some((file) => path.basename(file, ".exe") === name)) {
			throw new Error(
				`verify-binaries: no ${name} under ${unpacked}. Check package.json's ` +
					"build.files/build.asarUnpack globs, and that the package's install script ran.",
			);
		}
	}

	const wrong = [];
	for (const file of binaries) {
		const archs = await archsOf(file);
		// universal builds satisfy any target they contain a slice for.
		if (!archs.includes(target)) wrong.push(`${path.relative(resources, file)} is ${archs.join("+") || "unreadable"}`);
	}
	if (wrong.length > 0) {
		throw new Error(
			`verify-binaries: installer targets ${target}, but ${wrong.length} bundled ` +
				`binary/binaries do not:\n  ${wrong.join("\n  ")}\n` +
				"These would fail at runtime with \"Bad CPU type in executable\".",
		);
	}
	console.log(`verify-binaries: ${binaries.length} bundled binaries are ${target}`);
}
