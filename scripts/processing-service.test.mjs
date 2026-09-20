/**
 * Tests for the one decision in processing-service.mjs that can quietly do
 * the wrong thing: whether to adopt a service already running on our port.
 *
 * Adopting the wrong one is the failure that looks like success -- the port
 * answers, /health is happy, and the app shows an empty episode list under a
 * green tick.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { adoptionVerdict, expectedDataDir } from "./processing-service.mjs";

const OURS = "/Users/someone/project/server";

test("a service serving our own library is adopted", () => {
	assert.deepEqual(adoptionVerdict(OURS, { dataDir: OURS }), { adopt: true, confirmed: true });
});

test("two spellings of the same directory still count as ours", () => {
	const scenic = "/Users/someone/project/server/../server";
	assert.equal(adoptionVerdict(OURS, { dataDir: scenic }).adopt, true);
	assert.equal(adoptionVerdict(scenic, { dataDir: OURS }).adopt, true);
});

test("a service serving a different library is refused, with both paths", () => {
	// The real case: a packaged install's data directory against a dev one.
	const theirs = "/Users/someone/Library/Application Support/cutroom";
	const verdict = adoptionVerdict(OURS, { dataDir: theirs });
	assert.equal(verdict.adopt, false);
	assert.equal(verdict.confirmed, true);
	// Both, because "wrong service" is not actionable without them.
	assert.equal(verdict.theirs, theirs);
	assert.equal(verdict.ours, OURS);
});

test("a service that can't be reached is adopted rather than refused", () => {
	// Not knowing is not evidence of a mismatch, and refusing on "don't know"
	// would break the second-terminal case this reuse exists for.
	assert.deepEqual(adoptionVerdict(OURS, null), { adopt: true, confirmed: false });
});

test("a service too old to say which library it serves is adopted, unconfirmed", () => {
	assert.deepEqual(adoptionVerdict(OURS, { status: "ok", diarization: true }), {
		adopt: true,
		confirmed: false,
	});
	// A non-string is the same kind of "don't know", not a mismatch.
	assert.deepEqual(adoptionVerdict(OURS, { dataDir: null }), { adopt: true, confirmed: false });
});

test("the expected library follows the same variable the service reads", () => {
	const before = process.env.CUTROOM_DATA_DIR;
	try {
		delete process.env.CUTROOM_DATA_DIR;
		// Unset means dev: server/ under the project root, matching paths.py.
		assert.equal(expectedDataDir("/tmp/project"), path.resolve("/tmp/project/server"));

		process.env.CUTROOM_DATA_DIR = "/tmp/elsewhere";
		assert.equal(expectedDataDir("/tmp/project"), path.resolve("/tmp/elsewhere"));
	} finally {
		if (before === undefined) delete process.env.CUTROOM_DATA_DIR;
		else process.env.CUTROOM_DATA_DIR = before;
	}
});
