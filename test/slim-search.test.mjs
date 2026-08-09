import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../config.ts";
import { searchExa } from "../search.ts";

test("searchExa uses only the Exa REST endpoint", async () => {
	const originalFetch = globalThis.fetch;
	const originalKey = process.env.EXA_API_KEY;
	let request;
	process.env.EXA_API_KEY = "exa-test-key";
	globalThis.fetch = async (url, init) => {
		request = { url, init };
		return Response.json({
			results: [{
				title: "Exa result",
				url: "https://example.com/article",
				publishedDate: "2026-01-01",
				highlights: ["Useful excerpt"],
			}],
		});
	};

	try {
		const result = await searchExa("pi extensions", { summary: { enabled: false } }, {
			numResults: 3,
			domainFilter: ["example.com", "-ads.example.com"],
			recencyFilter: "week",
		});
		assert.equal(request.url, "https://api.exa.ai/search");
		assert.equal(request.init.headers["x-api-key"], "exa-test-key");
		assert.equal(request.init.headers["x-exa-integration"], "pi-web-access-slim");
		const body = JSON.parse(request.init.body);
		assert.equal(body.query, "pi extensions");
		assert.equal(body.numResults, 3);
		assert.deepEqual(body.includeDomains, ["example.com"]);
		assert.deepEqual(body.excludeDomains, ["ads.example.com"]);
		assert.deepEqual(result.results[0], {
			title: "Exa result",
			url: "https://example.com/article",
			publishedDate: "2026-01-01",
			snippet: "Useful excerpt",
		});
	} finally {
		globalThis.fetch = originalFetch;
		if (originalKey === undefined) delete process.env.EXA_API_KEY;
		else process.env.EXA_API_KEY = originalKey;
	}
});

test("searchExa rejects missing API credentials instead of using MCP", async () => {
	const originalKey = process.env.EXA_API_KEY;
	delete process.env.EXA_API_KEY;
	try {
		await assert.rejects(() => searchExa("query", { summary: { enabled: false } }), /Exa API key missing/);
	} finally {
		if (originalKey !== undefined) process.env.EXA_API_KEY = originalKey;
	}
});

test("loadConfig reads summary defaults", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-web-access-config-"));
	const originalDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = root;
	writeFileSync(join(root, "web-search.json"), JSON.stringify({
		exaApiKey: "configured-key",
		summary: { enabled: true, model: "openai-codex/gpt-5.6-luna" },
	}));
	try {
		assert.deepEqual(loadConfig(), {
			exaApiKey: "configured-key",
			summary: { enabled: true, model: "openai-codex/gpt-5.6-luna" },
		});
	} finally {
		if (originalDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = originalDir;
	}
});
