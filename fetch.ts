import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { fetchGitHub } from "./github.ts";
import type { ExtractedContent } from "./storage.ts";
import { fetchSafe } from "./ssrf.ts";

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

async function readResponseText(response: Response): Promise<string> {
	const buffer = await response.arrayBuffer();
	if (buffer.byteLength > MAX_RESPONSE_BYTES) throw new Error(`Response exceeds ${MAX_RESPONSE_BYTES} byte limit`);
	return new TextDecoder().decode(buffer);
}

function textTitle(text: string, url: string): string {
	const firstLine = text.split("\n").map((line) => line.trim()).find(Boolean);
	return firstLine?.slice(0, 200) || new URL(url).hostname;
}

async function fetchOne(url: string, signal?: AbortSignal): Promise<ExtractedContent> {
	const githubResult = await fetchGitHub(url);
	if (githubResult) return githubResult;

	try {
		const response = await fetchSafe(url, signal);
		const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
		if (!response.ok) return { url, title: "", content: "", error: `HTTP ${response.status} ${response.statusText}` };
		if (contentType.includes("application/pdf") || contentType.startsWith("image/") || contentType.startsWith("audio/") || contentType.startsWith("video/")) {
			return { url, title: "", content: "", error: `Unsupported content type: ${contentType.split(";")[0]}` };
		}

		const text = await readResponseText(response);
		const isHtml = contentType.includes("text/html") || contentType.includes("application/xhtml+xml") || /<html[\s>]/i.test(text.slice(0, 1000));
		if (!isHtml) return { url, title: textTitle(text, url), content: text, error: null };

		const { document } = parseHTML(text);
		const article = new Readability(document as unknown as Document).parse();
		if (article?.content) {
			return {
				url,
				title: article.title?.trim() || document.title?.trim() || new URL(url).hostname,
				content: turndown.turndown(article.content),
				error: null,
			};
		}

		const bodyText = document.body?.textContent?.trim() ?? "";
		return {
			url,
			title: document.title?.trim() || new URL(url).hostname,
			content: bodyText,
			error: bodyText ? null : "Could not extract readable content from HTML",
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { url, title: "", content: "", error: message };
	}
}

export async function fetchContent(urls: string[], signal?: AbortSignal): Promise<ExtractedContent[]> {
	return Promise.all(urls.map((url) => fetchOne(url, signal)));
}
