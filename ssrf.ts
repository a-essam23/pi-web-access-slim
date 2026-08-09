import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function blockedIPv4(value: string): boolean {
	const parts = value.split(".").map(Number);
	if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
	const [a, b] = parts;
	return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127)
		|| (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
		|| (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19))
		|| a >= 224;
}

function blockedIPv6(value: string): boolean {
	const normalized = value.toLowerCase();
	return normalized === "::" || normalized === "::1" || normalized.startsWith("fc")
		|| normalized.startsWith("fd") || normalized.startsWith("fe8")
		|| normalized.startsWith("fe9") || normalized.startsWith("fea")
		|| normalized.startsWith("feb");
}

function assertSafeAddress(address: string): void {
	if (isIP(address) === 4 && blockedIPv4(address)) throw new Error(`Blocked private or reserved address: ${address}`);
	if (isIP(address) === 6 && blockedIPv6(address)) throw new Error(`Blocked private or reserved address: ${address}`);
}

export async function validateUrl(value: string): Promise<URL> {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`Invalid URL: ${value}`);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error(`Unsupported URL protocol: ${url.protocol}`);
	}
	if (url.username || url.password) throw new Error("URLs with embedded credentials are not allowed");
	const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
	if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "metadata.google.internal") {
		throw new Error(`Blocked local or metadata hostname: ${hostname}`);
	}

	if (isIP(hostname)) {
		assertSafeAddress(hostname);
		return url;
	}

	const addresses = await lookup(hostname, { all: true });
	if (addresses.length === 0) throw new Error(`Could not resolve hostname: ${hostname}`);
	for (const address of addresses) assertSafeAddress(address.address);
	return url;
}

export async function fetchSafe(url: string, signal?: AbortSignal, maxRedirects = 5): Promise<Response> {
	let current = await validateUrl(url);
	for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
		const response = await fetch(current, { redirect: "manual", signal });
		if (!REDIRECT_STATUSES.has(response.status)) return response;
		const location = response.headers.get("location");
		if (!location) throw new Error(`Redirect from ${current.href} did not include a Location header`);
		if (redirectCount === maxRedirects) throw new Error(`Too many redirects while fetching ${url}`);
		current = await validateUrl(new URL(location, current).href);
	}
	throw new Error(`Too many redirects while fetching ${url}`);
}
