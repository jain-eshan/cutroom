import { test } from "node:test";
import assert from "node:assert/strict";
import { EDIT_VERSION, editFingerprint, restorableEdit, type SavedEdit } from "./savedEdit.ts";
import type { FramingRegion, FramingStyle } from "../features/timeline/types.ts";

const REGION: FramingRegion = {
	id: "r1",
	start: 1,
	end: 4,
	layout: "zoom",
	personIds: [1],
	source: "user",
};

function edit(overrides: Partial<SavedEdit> = {}): SavedEdit {
	return {
		version: EDIT_VERSION,
		cast: { names: { 1: "Siddharth" }, speakerToPerson: { 0: 1 }, voiceNames: {} },
		regions: [REGION],
		framingStyle: "dynamic",
		captions: true,
		trimDeadAir: false,
		savedAt: 1_700_000_000_000,
		...overrides,
	};
}

test("a well-formed edit comes back with everything the editor needs", () => {
	const restored = restorableEdit(edit());
	assert.ok(restored);
	assert.deepEqual(restored.regions, [REGION]);
	assert.equal(restored.framingStyle, "dynamic");
	assert.equal(restored.captions, true);
	assert.equal(restored.trimDeadAir, false);
	assert.deepEqual(restored.cast.speakerToPerson, { 0: 1 });
});

test("no edit at all is not an error -- it means start at the cast screen", () => {
	assert.equal(restorableEdit(null), null);
	assert.equal(restorableEdit(undefined), null);
});

test("an edit from a version this build doesn't know is refused, not half-read", () => {
	// Restoring a newer format by ignoring the parts we don't understand
	// would look like the shots were kept while quietly dropping some.
	assert.equal(restorableEdit(edit({ version: EDIT_VERSION + 1 })), null);
	assert.equal(restorableEdit(edit({ version: 0 })), null);
});

test("an edit missing the cast is refused -- there is no editor without one", () => {
	assert.equal(restorableEdit(edit({ cast: undefined as never })), null);
	assert.equal(restorableEdit(edit({ cast: { names: {} } as never })), null);
});

test("regions that aren't a list are refused rather than spread into one", () => {
	assert.equal(restorableEdit(edit({ regions: null as never })), null);
	assert.equal(restorableEdit(edit({ regions: { 0: REGION } as never })), null);
});

test("an edit with no shots at all is valid -- that's a wide-only episode", () => {
	const restored = restorableEdit(edit({ regions: [] }));
	assert.ok(restored);
	assert.deepEqual(restored.regions, []);
});

test("an unrecognised framing style falls back rather than refusing the whole edit", () => {
	// The style only decides what gets *suggested*; the shots themselves are
	// the work worth saving, so a bad style is not worth losing them over.
	const restored = restorableEdit(edit({ framingStyle: "cinematic" }));
	assert.ok(restored);
	assert.equal(restored.framingStyle, "gentle");
	assert.deepEqual(restored.regions, [REGION]);
});

test("a cast written before voiceNames existed still opens", () => {
	const { voiceNames: _dropped, ...older } = edit().cast;
	const restored = restorableEdit(edit({ cast: older as never }));
	assert.ok(restored);
	assert.deepEqual(restored.cast.voiceNames, {});
});

test("the fingerprint ignores the timestamp, so an unchanged edit isn't rewritten", () => {
	const a = edit() as SavedEdit<FramingRegion, FramingStyle>;
	const b = edit({ savedAt: a.savedAt + 5000 }) as SavedEdit<FramingRegion, FramingStyle>;
	assert.equal(editFingerprint(a), editFingerprint(b));
});

test("the fingerprint changes when a shot moves", () => {
	const a = edit() as SavedEdit<FramingRegion, FramingStyle>;
	const b = edit({ regions: [{ ...REGION, end: 9 }] }) as SavedEdit<FramingRegion, FramingStyle>;
	assert.notEqual(editFingerprint(a), editFingerprint(b));
});
