# Deck evaluation

After schema validation, the agent calls `evaluate_deck` before rendering. This
is a deterministic critique pass, not a claim that code can judge taste or truth.

It scores four dimensions:

- narrative progression: declaration opening, synthesis/action closing, and claim titles;
- visual intent: rationale and explicit cliche guardrails;
- rhythm: diversity of the actual rendered `visualDirective.layout` values;
- grounding: whether body evidence/case slides cite community sources.

Grounding has two code gates. A deck with no cited body slide is rejected, and every
slide whose visual role is `evidence` or `case` must carry at least one cataloged
community citation. Numeric claims also require a URL. Community citations establish
what people said, not whether the post's factual claim is true.

The validator also rejects body `hero` layouts, `evidence_focus` without an excerpt,
`split`/`steps` without bullets, required imagery when no image-retrieval stage exists,
and title/closing layouts that the renderer cannot honor.

Scores below 70, repeated rendered layouts, generic titles, or thin aesthetic intent
are instructions to revise the smallest affected part, revalidate, and evaluate
again. The existing same-run validation fingerprint still controls rendering.
