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

Reddit uses the same two lanes and shares a six-post default allowance across
them. It adds no model tokens; only bounded normalized records reach the Evidence
Analyst.

## Optional GCS memory

GCS memory is disabled by default. Enable it with `GCS_MEMORY_ENABLED=true` and a
`GCS_BUCKET`. Application Default Credentials are used by the official Google
Cloud Storage client. Cache objects use a hash of the focused query and markets;
the raw user brief is not written. Stored records contain only expiry metadata,
markets, a bounded extract, and cited X post metadata. The default TTL is 24 hours.

## Token controls

- GPT output cap per response: 5,000 tokens.
- Grok output cap: 900 tokens.
- Total run guard: 20,000 observed tokens before another model round is allowed.
- X post cap: six, configurable up to eight.
- Default reasoning effort: low; operators can raise it explicitly.
- Provider usage is accumulated in the run result and displayed in the UI.
- Only the tool valid for the current stage is exposed to GPT. The complete tool
  schema is not resent every round.
- `evaluate_deck` and `render_deck` use the DeckSpec stored by `validate_deck` and
  take no repeated DeckSpec argument. This both reduces tokens and prevents a
  post-validation deck swap.
