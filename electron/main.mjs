// The desktop shell: opens a native window over the built frontend (dist/)
// and starts the local processing service, so there's no terminal and no
// `npm run dev`. Serves dist/ itself, on the same port the dev server uses,
// so server/main.py's CORS allowlist and the /__service contract SetupGate
// depends on both work unchanged -- see scripts/processing-service.mjs.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import electronUpdater from "electron-updater";
import { ensureUv } from "../scripts/ensure-uv.mjs";
import { createProcessingService } from "../scripts/processing-service.mjs";

// electron-updater is CommonJS, so its named export comes off the default.
const { autoUpdater } = electronUpdater;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");
const distDir = path.join(projectRoot, "dist");
// In a packaged app, dist/ lives inside the asar bundle next to this file,
// but server/ ships unpacked as an extraResource (see package.json's
// "build" field) -- `uv run` needs it on disk, not inside the archive.
const serviceRoot = app.isPackaged ? process.resourcesPath : projectRoot;

// The one other terminal-requiring step: ffmpeg. Same fix as Recordly's --
// ffmpeg-static/ffprobe-static ship prebuilt binaries as npm dependencies,
// unpacked from the asar (see package.json's asarUnpack) so they're real,
// spawnable files on disk. server/pipeline/ffmpeg.py already reads these
// env vars instead of assuming "ffmpeg"/"ffprobe" are on PATH.
// The packages still compute their path as if it lived inside app.asar --
// asarUnpack only moves the real file to app.asar.unpacked alongside it, it
// doesn't rewrite the string -- so swap the prefix back to where the file
// actually is on disk.
const unpack = (p) => p.replace("app.asar", "app.asar.unpacked");
process.env.FFMPEG_BINARY = app.isPackaged ? unpack(ffmpegPath) : ffmpegPath;
process.env.FFPROBE_BINARY = app.isPackaged ? unpack(ffprobeStatic.path) : ffprobeStatic.path;

// Everything the service writes -- saved episodes, the Hugging Face token,
// downloaded model weights, the Python environment itself -- has to land
// outside the app bundle. macOS replaces the bundle wholesale on update, so
// anything in there is destroyed on every release, and an app that writes
// inside its own bundle breaks the signature notarisation checks. Electron
// already keeps its own data in exactly this directory.
//
// Dev is left alone: with these unset, server/pipeline/paths.py falls back to
// server/ and uv to server/.venv, which is what `npm run dev` has always used.
if (app.isPackaged) {
	const dataDir = app.getPath("userData");
	process.env.CUTROOM_DATA_DIR = dataDir;
	// uv would otherwise build this at server/.venv -- ~1.2GB inside the
	// bundle, rebuilt from scratch every time the app is replaced.
	process.env.UV_PROJECT_ENVIRONMENT = path.join(dataDir, "venv");
	// Python writes __pycache__ next to each source file, which for a packaged
	// install means inside the bundle. Small, but it's still the app modifying
	// its own signed contents -- redirect the whole tree instead of turning
	// bytecode caching off and paying the recompile on every launch.
	process.env.PYTHONPYCACHEPREFIX = path.join(dataDir, "pycache");
}

// Must match server/main.py's CORS allowlist (http://127.0.0.1:3460).
const FRONTEND_PORT = 3460;

const MIME_TYPES = {
	".html": "text/html",
	".js": "text/javascript",
	".css": "text/css",
	".svg": "image/svg+xml",
	".woff2": "font/woff2",
	".json": "application/json",
	".png": "image/png",
	".ico": "image/x-icon",
};

const service = createProcessingService(serviceRoot);

function sendServiceStatus(res) {
	res.setHeader("Content-Type", "application/json");
	res.end(JSON.stringify(service.status()));
}

async function serveStatic(req, res) {
	const requestedPath = new URL(req.url, "http://localhost").pathname;
	// Single-page app: anything that isn't a real file falls back to index.html.
	let filePath = path.join(distDir, decodeURIComponent(requestedPath));
	if (!(await stat(filePath).catch(() => null))?.isFile()) {
		filePath = path.join(distDir, "index.html");
	}
	res.setHeader("Content-Type", MIME_TYPES[path.extname(filePath)] ?? "application/octet-stream");
	createReadStream(filePath).pipe(res);
}

function startFrontendServer() {
	const server = createServer((req, res) => {
		if (req.url === "/__service") {
			sendServiceStatus(res);
			return;
		}
		if (req.url === "/__service/restart") {
			if (req.method !== "POST") {
				res.statusCode = 405;
				res.end();
				return;
			}
			void service.start().then(() => sendServiceStatus(res));
			return;
		}
		void serveStatic(req, res);
	});
	server.on("error", (err) => {
		dialog.showErrorBox(
			"Cutroom couldn't start",
			`Port ${FRONTEND_PORT} is already in use (${err.message}). Close whatever else is using it and reopen Cutroom.`,
		);
		app.quit();
	});
	server.listen(FRONTEND_PORT, "127.0.0.1");
	return server;
}

function createWindow() {
	const win = new BrowserWindow({
		width: 1280,
		height: 800,
		title: "Cutroom",
		// The app's own dark `bg`, so opening the window doesn't flash white.
		backgroundColor: "#0d0b08",
		// On macOS the app draws its own title bar (src/components/ui.tsx,
		// AppWindow), and the real traffic lights sit in the slot it leaves
		// for them, centred in its 44px height.
		...(process.platform === "darwin"
			? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 14, y: 16 } }
			: {}),
		webPreferences: { preload: path.join(__dirname, "preload.cjs") },
	});
	win.loadURL(`http://127.0.0.1:${FRONTEND_PORT}/`);
}

// What `electron/preload.cjs` bridges out to the renderer that only the main
// process can do: pick where a render goes (dialog), reveal it once it's
// there (shell), and the update calls below. See src/lib/electron.ts.
ipcMain.handle("choose-export-path", async (_event, defaultName) => {
	const { canceled, filePath } = await dialog.showSaveDialog({
		defaultPath: defaultName,
		filters: [{ name: "MP4 video", extensions: ["mp4"] }],
	});
	return canceled ? null : filePath;
});

ipcMain.handle("show-item-in-folder", (_event, filePath) => {
	shell.showItemInFolder(filePath);
});

// Updates. electron-updater reads latest.yml / latest-mac.yml from the newest
// published (not draft) GitHub Release -- the release workflow already
// attaches both.
//
// macOS only lets an app replace itself if it's signed with a paid Developer
// ID, and ours is ad-hoc signed (scripts/afterSign.mjs), so on a Mac this
// only says a new version exists and links to where to download it. Windows
// has no such rule: it downloads quietly and installs when the app quits.
// Once there's a Developer ID, drop CAN_SELF_INSTALL's platform check.
const CAN_SELF_INSTALL = process.platform !== "darwin";
const DOWNLOAD_PAGE = "https://github.com/jain-eshan/cutroom/releases/latest";
// The last state, so a window opened (or reloaded) after it arrived still sees it.
let updateState = null;

function sendUpdate(state) {
	updateState = state;
	for (const win of BrowserWindow.getAllWindows()) win.webContents.send("update-state", state);
}

ipcMain.handle("get-update-state", () => updateState);
ipcMain.handle("open-download-page", () => shell.openExternal(DOWNLOAD_PAGE));
ipcMain.handle("restart-to-update", () => autoUpdater.quitAndInstall());

function checkForUpdates() {
	autoUpdater.autoDownload = CAN_SELF_INSTALL;
	autoUpdater.autoInstallOnAppQuit = CAN_SELF_INSTALL;
	autoUpdater.on("update-available", (info) => {
		sendUpdate({ version: info.version, ready: false, canSelfInstall: CAN_SELF_INSTALL });
	});
	autoUpdater.on("update-downloaded", (info) => {
		sendUpdate({ version: info.version, ready: true, canSelfInstall: true });
	});
	// Offline, GitHub down, rate-limited: none of it should reach the person
	// editing. The next launch tries again.
	autoUpdater.on("error", (err) => console.log(`Update check failed: ${err.message}`));
	void autoUpdater.checkForUpdates().catch(() => {});
}

app.whenReady().then(async () => {
	startFrontendServer();
	createWindow();
	// A dev run (`npm run electron`) has no release to compare itself with.
	if (app.isPackaged) checkForUpdates();

	// Best-effort: if this fails, service.start() below hits the same "uv
	// isn't installed" error path it always has, which the setup screen
	// already knows how to show.
	await ensureUv((line) => console.log(line));
	void service.start();

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on("window-all-closed", () => {
	service.stop();
	if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => service.stop());
