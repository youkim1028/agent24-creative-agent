# Team architecture

`AGENT_ARCHITECTURE=team` is the default live mode. Each model role receives a
fresh Responses API context and a strict JSON contract; prior model transcripts
are never forwarded. Mock mode remains deterministic, and `single` preserves the
legacy tool-loop fallback.

## Exactly six agents

1. **Research Planner** resolves one shared presentation profile from the brief and
   optional additional context, then creates two bounded lanes: topic complaints
   and criticism of AI presentation/design treatment. Explicit user constraints
   override inference. Code replaces its market list with the pre-resolved countries
   so the model cannot expand scope.
2. **Evidence Analyst** receives one deduplicated `CommunityPost[]` contract from
   both platforms and turns only cited posts into `CommunityEvidence`.
3. **Narrative Architect** converts evidence into an ordered `NarrativeSpec` and
   does not choose aesthetics.
4. **Art Director** maps every narrative slide ID to exactly one render-supported
   visual directive and selects `none`, `photo`, `screenshot`, `chart`, or
   `diagram`. Each directive names its `informationShape`, `dominantVisual`, and
   `layoutFamily`; five-slide decks cannot repeat a family and adjacent slides
   cannot repeat a derived silhouette. It adds `ImageIntent` only for external
   visuals; it cannot rewrite claims, add sources, or fetch image bytes.
5. **Deck Composer** merges NarrativeSpec, VisualSystemSpec, and the source catalog
   into `DeckSpec`, preserving slide order, evidence URLs, and visual directives.
   Same-run image metadata is injected by code after the model returns.
6. **Independent Critic** receives a fresh context and produces `CritiqueReport`.

Grok X Search, YouTube video/comment search, Hacker News search, Pexels/Unsplash search, upload handling,
selected-image download, and native PowerPoint chart/diagram/timeline/spatial-map rendering are tools, not additional agents.
The validator, evaluator, and renderer are deterministic code gates, not agents.
If repair is needed, Agent 5 is called again with `stage=repair`, then Agent 6 with
`stage=recheck`; the unique-agent count remains six. The renderer receives only the
same-run DeckSpec that passed all gates.

Each boundary is visible as an `agent_handoff` status event. Code rejects missing or
reordered Art Director slide mappings, citations that drift from NarrativeSpec,
visual directives that drift, and selected-image IDs or hashes that drift before rendering.
The critic also compares the composition of adjacent slides and distinct
information shapes for higher-order repetition that exact family checks cannot
see. Layout variation must follow content structure rather than random alternation.

Image retrieval builds a bounded cross-provider pool. User uploads, allowlisted
official images, Pexels, and Unsplash candidates are ranked deterministically by
source preference, orientation, resolution, and provider diversity. The trace
shows the candidate scores and selected asset; only that asset is downloaded.

## Cost boundaries

Role output caps are environment-configurable and default to 12,000–32,000 tokens.
A normal run is six model calls; a single repair plus recheck makes eight. The
GPT-only run budget defaults to 500,000 observed tokens and still applies before
every agent call. Research retrieval is capped separately; YouTube retrieval uses
no model tokens. If a role is cut off by its own cap the run stops with
the reason instead of parsing a truncated reply.

## Second-screen contract

Every role emits the exact request object passed to the Responses API as a
`tool_call`, and the model's raw `output` items plus `output_text` as a
`tool_result`. The result event is emitted before schema parsing, so a contract
violation is visible on the second screen rather than swallowed by an exception.
YouTube, Hacker News, Grok, and visual-asset tools emit their own request and result events. GCS hits emit the same
normalized research-result boundary without a provider call. The deduplicated
community posts, cache hit/miss state, and source catalog travel in the trace, not
just their counts. Trace history is memory-only and bounded to 250 events.

## Known limitation

The YouTube Data API may return quota or rate-limit errors and some videos disable
comments. The team continues with X and an explicit source limitation. A local
provider ledger stops calls at 80% of the configured daily call budget; HTTP 429 and
provider quota-limit reasons enter a long backoff without retry. X remains the primary
source for country-specific complaints because YouTube comment-author country is unavailable.
YouTube `discoveryMarket` only records the content-region search used to find the video.
Hacker News is a country-neutral technical/community supplement.

Research Planner and Evidence Analyst use the fast model profile. Narrative Architect,
Art Director, Deck Composer, and Independent Critic use the critical profile, configurable
as `gpt-5.6-sol`, `reasoning.effort=high`, and `service_tier=priority`. Set the critical
service tier to `auto` if the OpenAI project is not eligible for Priority Processing.

Dribbble API v2 no longer provides a generic aggregated shot-search stream. DeckForge
therefore accepts explicit public Dribbble links as Art Director references and does
not download them into the deck. Official image URLs are disabled until an operator
sets an HTTPS host allowlist. The provider quota ledger is local to the deployment;
multi-instance hosting should replace it with a shared transactional counter.
