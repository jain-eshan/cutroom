import { test } from "node:test";
import assert from "node:assert/strict";
import { readStoredMode, writeStoredMode } from "./theme.ts";

function fakeStorage(overrides: Partial<Pick<Storage, "getItem" | "setItem">> = {}) {
	return {
		getItem: () => null,
		setItem: () => {},
		...overrides,
	};
}

test("no stored value reads as dark -- the app's own theme, whatever the OS is set to", () => {
	assert.equal(readStoredMode(fakeStorage({ getItem: () => null })), "dark");
});

test("an unrecognised stored value reads as dark, not passed through", () => {
	assert.equal(readStoredMode(fakeStorage({ getItem: () => "sepia" })), "dark");
});

test("system, light and dark round-trip", () => {
	assert.equal(readStoredMode(fakeStorage({ getItem: () => "system" })), "system");
	assert.equal(readStoredMode(fakeStorage({ getItem: () => "light" })), "light");
	assert.equal(readStoredMode(fakeStorage({ getItem: () => "dark" })), "dark");
});

test("storage that throws on read falls back to dark rather than crashing", () => {
	// Private browsing, a full quota, or a policy blocking storage outright
	// all throw here rather than returning null -- this is the app's own
	// first read of localStorage, inside a useState initializer that runs
	// during the very first render.
	const throwing = fakeStorage({
		getItem: () => {
			throw new DOMException("blocked");
		},
	});
	assert.equal(readStoredMode(throwing), "dark");
});

test("storage that throws on write does not raise -- the mode still applies for this session", () => {
	const throwing = fakeStorage({
		setItem: () => {
			throw new DOMException("quota exceeded");
		},
	});
	assert.doesNotThrow(() => writeStoredMode(throwing, "dark"));
});

test("writing succeeds silently when storage works", () => {
	const written: string[] = [];
	writeStoredMode(fakeStorage({ setItem: (_key, value) => written.push(value) }), "light");
	assert.deepEqual(written, ["light"]);
});
