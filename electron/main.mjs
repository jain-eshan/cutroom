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
import { app, BrowserWindow, dialog } from "electron";
import { ensureUv } from "../scripts/ensure-uv.mjs";
import { createProcessingService } from "../scripts/processing-service.mjs";

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
process.env.FFMPEG_BINARY = ffmpegPath;
process.env.FFPROBE_BINARY = ffprobeStatic.path;

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
	});
	win.loadURL(`http://127.0.0.1:${FRONTEND_PORT}/`);
}

app.whenReady().then(async () => {
	startFrontendServer();
	createWindow();

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
