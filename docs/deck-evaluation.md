# Deck evaluation

After schema validation, the agent calls `evaluate_deck` before rendering. This
is a deterministic critique pass, not a claim that code can judge taste or truth.

It scores four dimensions:

- narrative progression: declaration opening, synthesis/action closing, and claim titles;
- visual intent: rationale and explicit cliche guardrails;
- rhythm: diversity of slide visual roles;
- grounding: evidence coverage across body slides.

Scores below 70, repeated visual roles, generic titles, or thin aesthetic intent
are instructions to revise the smallest affected part, revalidate, and evaluate
again. The existing same-run validation fingerprint still controls rendering.
