# Team architecture

`AGENT_ARCHITECTURE=team` is the default live mode. Each model role receives a
fresh Responses API context and a strict JSON contract; prior model transcripts
are never forwarded. Mock mode remains deterministic, and `single` preserves the
legacy tool-loop fallback.

## Roles and handoffs

1. Research Planner creates two bounded lanes: topic complaints and criticism of
   AI presentation/design treatment. Code overwrites its market list with the
   pre-resolved countries so the model cannot expand scope.
2. X Scout uses Grok twice with half of the configured post allowance per lane.
   Grok remains retrieval-only. Reddit Scout performs two token-free public JSON
   searches and degrades to warnings on timeout or rate limiting.
3. Evidence Analyst turns normalized community posts into `CommunityEvidence`.
4. Narrative Architect produces `NarrativeSpec` and does not choose aesthetics.
5. Art Director produces `VisualSystemSpec` and does not rewrite claims.
6. Deck Composer merges the two specs into a complete `DeckSpec` using only the
   normalized source catalog.
7. Independent Critic receives a separate context and produces `CritiqueReport`.
   Code validation, source-catalog checks, and deterministic evaluation run beside
   this model critique. One bounded repair and critic recheck are allowed.
8. The renderer receives only the final DeckSpec that passed all gates in the same
   run.

## Cost boundaries

Role output caps range from 800 to 2,600 tokens. A run-level observed token guard
still applies before every agent call. Research retrieval is capped separately;
Reddit uses no model tokens. Agent trace events store role names, sizes, usage, and
counts rather than full private handoff payloads.

## Known limitation

The Reddit public search endpoint may rate-limit or block anonymous requests. The
team continues with X and an explicit source limitation. Production deployments
should replace it with OAuth-backed Reddit access when credentials and policy are
available.
