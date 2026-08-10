import { complete, type Message } from "@earendil-works/pi-ai/compat";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { QueryResult } from "./search.ts";

const MAX_SUMMARY_SOURCE_CHARS = 8_000;

export type SummaryContext = Pick<ExtensionContext, "modelRegistry">;

function parseModelSelector(value: string): { provider: string; id: string } {
	const separator = value.indexOf("/");
	if (separator <= 0 || separator === value.length - 1) {
		throw new Error(`Invalid summary model '${value}'. Use provider/model-id.`);
	}
	return { provider: value.slice(0, separator), id: value.slice(separator + 1) };
}

function buildPrompt(results: QueryResult[]): string {
	const sections = [
		"Write a concise, factual summary of the web search results below.",
		"Use only the supplied evidence. Mention uncertainty or conflicting evidence.",
		"End with a Sources section containing the most relevant URLs.",
		"",
		"<search_results>",
	];

	for (const result of results) {
		sections.push(`\nQuery: ${result.query}`);
		if (result.error) {
			sections.push(`Error: ${result.error}`);
			continue;
		}
		for (const [index, source] of result.results.entries()) {
			sections.push(`[${index + 1}] ${source.title} — ${source.url}`);
			const evidence = source.content || source.snippet;
			if (evidence) sections.push(evidence.slice(0, MAX_SUMMARY_SOURCE_CHARS));
		}
	}
	sections.push("</search_results>");
	return sections.join("\n");
}

function responseText(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => {
			if (!part || typeof part !== "object") return "";
			const text = (part as { text?: unknown }).text;
			return typeof text === "string" ? text : "";
		})
		.filter(Boolean)
		.join("\n")
		.trim();
}

export async function summarizeResults(
	results: QueryResult[],
	ctx: SummaryContext,
	modelSelector: string,
	signal?: AbortSignal,
): Promise<{ text: string; model: string }> {
	const { provider, id } = parseModelSelector(modelSelector);
	const model = ctx.modelRegistry.find(provider, id);
	if (!model) throw new Error(`Summary model not found: ${modelSelector}`);

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok || !auth.apiKey) throw new Error(`No API key available for summary model: ${modelSelector}`);

	const message: Message = {
		role: "user",
		content: [{ type: "text", text: buildPrompt(results) }],
		timestamp: Date.now(),
	};
	const response = await complete(model, { messages: [message] }, {
		apiKey: auth.apiKey,
		headers: auth.headers,
		signal,
	});
	if (response.stopReason === "aborted") throw new Error("Summary generation aborted");

	const text = responseText(response.content);
	if (!text) throw new Error(`Summary model returned no text: ${modelSelector}`);
	return { text, model: `${model.provider}/${model.id}` };
}
