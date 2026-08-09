# pi-web-access-slim

A small web-access extension for Pi with one search provider: the Exa REST API.

It intentionally does not include MCP support, provider fallbacks, browser UI, PDF extraction, video analysis, or hosted page-extraction services.

## Features

- `web_search` — search with Exa, optionally summarize with a configured Pi model.
- `fetch_content` — fetch HTTP/HTTPS pages with local Readability and Turndown extraction; GitHub URLs are shallow-cloned locally.
- `get_search_content` — retrieve full results stored during the current session or restored from the session branch.
- Pi-native TUI progress for search and fetch operations; no browser is opened.

## Configuration

Create `~/.pi/web-search.json`:

```json
{
  "exaApiKey": "exa-...",
  "summary": {
    "enabled": false,
    "model": "openai-codex/gpt-5.6-luna"
  }
}
```

`EXA_API_KEY` can be used instead of `exaApiKey`.

Summary behavior is controlled by `summary.enabled`. A search call can override it with `summary: true|false` and can override the model with `summaryModel`. Summary models use the `provider/model-id` format. If summarization is enabled without a configured model, the tool returns an error rather than silently selecting one.

## Search options

`web_search` accepts `query` or `queries`, `numResults`, `recencyFilter`, `domainFilter`, and `includeContent`. It always uses Exa's REST `/search` endpoint and returns direct search results. It never uses Exa MCP or Exa's answer endpoint.

## Fetch behavior

`fetch_content` accepts `url` or `urls`.

- HTML is converted to Markdown locally.
- Plain text, Markdown, JSON, and XML are returned directly.
- GitHub repository URLs are cloned with a shallow Git clone and cached under `~/.cache/pi-web-access-slim/github`.
- Local and reserved network targets are blocked, including redirect destinations.
- PDFs, images, audio, and video are reported as unsupported.

## Development

```bash
npm ci
npm test
npm run typecheck
```

Install the fork in Pi with a pinned Git package reference after validating a commit:

```json
"git:github.com/a-essam23/pi-web-access-slim@<commit>"
```
