# @cyrus/dsh-anysearch

AnySearch-backed web search provider for DeepSeek Harness Personal.

It registers `searchProvider: anysearch` on the Harness `ctx.web` capability
layer, so Harness' built-in `web_search` tool uses the AnySearch JSON-RPC
endpoint.

## Configuration

| Item | Priority |
|---|---|
| API Key | Harness setting `anysearch.apiKey` (secret) > credential `ANYSEARCH_API_KEY` > environment `ANYSEARCH_API_KEY` |
| Endpoint | Harness setting `anysearch.endpoint` > environment `ANYSEARCH_ENDPOINT` > `https://api.anysearch.com/mcp` |

Never commit real API keys; the release preflight blocks credential patterns.

## Build

```powershell
npx pnpm@11.19.0 run check:plugins
```

## Install (bundle)

```powershell
dsh plugin --profile web add path/to/@cyrus-dsh-anysearch-0.1.0-beta.tgz
# restart dsh, then verify: web.searchProvider == "anysearch"
```

## License

MIT — see LICENSE.
