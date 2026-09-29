import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReport, scrubPaths } from "./problem-report.mjs";

test("paths keep only their last part", () => {
	assert.equal(scrubPaths('File "/opt/app/server/pipeline/faces.py", line 9', null), 'File "…/faces.py", line 9');
	assert.equal(scrubPaths("C:\\Tools\\bin\\ffmpeg.exe failed", null), "…/ffmpeg.exe failed");
});

test("the username goes even from a path with spaces in it", () => {
	const home = "/Users/Ada Lovelace";
	const out = scrubPaths("No such file: /Users/Ada Lovelace/My Shows/episode.mp4", home);
	assert.ok(!out.includes("Ada"), out);
	assert.ok(out.endsWith("episode.mp4"), out);
});

test("a Windows home folder goes in either slash direction", () => {
	const home = "C:\\Users\\Олена";
	for (const line of ["C:\\Users\\Олена\\Videos\\ep.mp4", "C:/Users/Олена/Videos/ep.mp4"]) {
		const out = scrubPaths(line, home);
		assert.ok(!out.includes("Олена"), out);
		assert.ok(out.endsWith("ep.mp4"), out);
	}
});

test("the report says what it is and carries the log", () => {
	const report = buildReport({
		version: "0.4.0",
		platform: "win32",
		arch: "x64",
		osVersion: "10.0.22631",
		service: { state: "exited" },
		log: ["Traceback (most recent call last):", '  File "C:\\Users\\bo\\app\\main.py", line 3'],
		home: "C:\\Users\\bo",
		now: new Date("2026-09-29T00:00:00Z"),
	});
	assert.match(report, /Cutroom 0\.4\.0/);
	assert.match(report, /Processing service: exited/);
	assert.match(report, /…\/main\.py/);
	assert.ok(!report.includes("bo\\"), report);
});
