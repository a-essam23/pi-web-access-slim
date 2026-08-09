import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchContent } from "../fetch.ts";
import { parseGitHubUrl } from "../github.ts";
import { fetchSafe, validateUrl } from "../ssrf.ts";

test("fetchContent extracts readable HTML locally", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => new Response(
		"<!doctype html><html><head><title>Example article</title></head><body><article><h1>Hello</h1><p>Readable content.</p></article></body></html>",
		{ headers: { "content-type": "text/html" } },
	);
	try {
		const [result] = await fetchContent(["http://93.184.216.34/article"]);
		assert.equal(result.error, null);
		assert.equal(result.title, "Example article");
		assert.match(result.content, /Readable content\./);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("fetchSafe validates redirect destinations", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => new Response(null, {
		status: 302,
		headers: { location: "http://127.0.0.1/private" },
	});
	try {
		await assert.rejects(() => fetchSafe("http://93.184.216.34/start"), /Blocked/);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("validateUrl blocks private address literals", async () => {
	await assert.rejects(() => validateUrl("http://127.0.0.1"), /Blocked/);
	await assert.rejects(() => validateUrl("http://192.168.1.10"), /Blocked/);
	await assert.rejects(() => validateUrl("http://[::1]"), /Blocked/);
});

test("parseGitHubUrl extracts repository paths", () => {
	assert.deepEqual(parseGitHubUrl("https://github.com/a/b"), { owner: "a", repo: "b" });
	assert.deepEqual(parseGitHubUrl("https://github.com/a/b/blob/main/src/index.ts"), {
		owner: "a",
		repo: "b",
		ref: "main",
		path: "src/index.ts",
	});
	assert.equal(parseGitHubUrl("https://example.com/a/b"), null);
});
