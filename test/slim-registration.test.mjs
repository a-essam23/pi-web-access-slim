import assert from "node:assert/strict";
import { test } from "node:test";
import register from "../index.ts";

test("the slim extension registers only web_search", () => {
	const tools = [];
	const events = [];
	register({
		on(name) { events.push(name); },
		registerTool(tool) { tools.push(tool); },
		appendEntry() {},
	});

	assert.deepEqual(tools.map((tool) => tool.name), ["web_search", "fetch_content", "get_search_content"]);
	assert.deepEqual(events, ["session_start", "session_tree", "session_shutdown"]);
});
