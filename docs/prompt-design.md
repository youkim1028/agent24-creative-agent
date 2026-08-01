# Prompt Design Notes

The system prompt lives in `src/agent/prompt.ts` so judges can inspect it directly.

## Intent

- State the outcome and operating boundaries once.
- Describe when each tool is useful rather than forcing calls mechanically.
- Define recovery behavior and a concrete stopping rule.
- Separate the final-answer contract from internal tool orchestration.

## Edge cases covered

- Ambiguous briefs: identify material assumptions.
- Missing facts: do not fabricate them.
- Tool failure: report it and use a safe alternative.
- Low-quality draft: revise once and optionally review again.
- Runaway behavior: stop after two reviews; server also caps rounds at six.
- Side effects: save only when requested or clearly required.

## What to customize after choosing the final product

Replace the generic tools with domain tools that create measurable user value. Keep one tool per
decision boundary, update its description and schema, add representative tests, and document why
its position in the pipeline is necessary.

