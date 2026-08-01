# Research markets, memory, and token policy

## Market selection

When no market override is supplied, the output language selects a small default
set for complaint discovery:

- Korean: South Korea (`ko`) and United States (`en`).
- English: United States (`en`) and United Kingdom (`en`).

The browser can override this with up to three countries. The resolved list is
calculated by code and passed to the agent; GPT must not add markets on its own.

## Grok boundary

Grok is a retrieval worker only. Team mode makes two focused calls—topic complaints
and AI presentation/design criticism—sharing a maximum of six posts by default.
Each call receives the resolved markets, date/handle filters, and a 900-output-token
cap. It returns direct X URLs and short original-language excerpts. GPT is
responsible for interpretation. Grok is explicitly told not to summarize,
verify, score sentiment, recommend actions, or design slides.

YouTube uses the same two lanes and shares a six-comment default allowance across
them. Each lane searches up to three videos and inspects a bounded number of top-level
comments. It adds no model tokens; only ranked, normalized comments reach the Evidence
Analyst. Comment-author country is left empty rather than inferred from video locale.

YouTube video discovery is split across the selected markets with `regionCode` and
`relevanceLanguage`. The matched market is stored as `discoveryMarket`, which means
search context—not the comment author's country. Hacker News adds up to four ranked
stories/comments across the same lanes and carries no country signal.

## Optional GCS memory

GCS memory is disabled by default. Enable it with `GCS_MEMORY_ENABLED=true` and a
`GCS_BUCKET`. Application Default Credentials are used by the official Google
Cloud Storage client; no GCS key is placed in `.env`.

Objects use this stable partition:

```text
{GCS_PREFIX}/v5/x/{topic|design_critique}/{sha256}.json
{GCS_PREFIX}/v5/youtube/{topic|design_critique}/{sha256}.json
{GCS_PREFIX}/v5/hacker_news/{topic|design_critique}/{sha256}.json
```

The hash covers provider, lane, normalized focused query, markets, date range,
allowed handles or YouTube video/comment limits and language, and post limit. Neither the raw brief nor query
appears in the object path or JSON record. X records contain a bounded extract and
citations; YouTube records contain bounded normalized comments and the number of videos examined. Both carry platform,
lane, collection/expiry timestamps, markets, and source count. Dates, locale fields,
and exposed engagement are preserved in a common record shape through Evidence
Analyst and the citation catalog instead of being dropped on a cache hit.

The default application TTL is 24 hours. Expired objects are never reused, but the
application does not delete them automatically. Configure the bucket as private,
grant the runtime only object read/write permissions, and add a short GCS lifecycle
deletion rule (for example two days) before live use. Writes use `private, no-store`
cache metadata. Cache failure is a warning and research falls back to the provider.

## Token controls

- GPT output cap per response: 5,000 tokens.
- Grok output cap: 900 tokens.
- Total run guard: 20,000 observed tokens before another model round is allowed.
- X post cap: six across its two lanes, configurable up to eight.
- YouTube comment cap: six across its two lanes, configurable up to eight; it consumes no model tokens.
- Hacker News item cap: four across its two lanes, configurable up to eight; it consumes no model tokens.
- YouTube calls have a local daily counter, stop at the configured 80% threshold, and never retry HTTP 429 in the same run.
- Default reasoning effort: low; operators can raise it explicitly.
- Provider usage is accumulated in the run result and displayed in the UI.
- Only the tool valid for the current stage is exposed to GPT. The complete tool
  schema is not resent every round.
- `evaluate_deck` and `render_deck` use the DeckSpec stored by `validate_deck` and
  take no repeated DeckSpec argument. This both reduces tokens and prevents a
  post-validation deck swap.
