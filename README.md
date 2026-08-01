# Agent24 Creative Agent Starter

A hackathon-ready Node.js/TypeScript starter for a tool-using Creative agent. It uses the OpenAI
Responses API, displays unmodified `function_call` and `function_call_output` payloads on a second
screen, validates tool arguments, and supports a local rehearsal mode without an API key.

## Quick start

Requirements: Node.js 20+ and an OpenAI API key.

```powershell
npm install
Copy-Item .env.example .env
# Edit .env and set OPENAI_API_KEY
npm run dev
```

Open:

- Main demo: <http://localhost:3000>
- Raw tool events: <http://localhost:3000/trace.html>

If `.env` or `OPENAI_API_KEY` is missing, the app enters clearly labelled `MOCK` mode. Mock mode is
only for layout and event-screen rehearsal; it does not satisfy the requirement to use OpenAI in the
final result.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start the TypeScript development server |
| `npm run typecheck` | Verify TypeScript types |
| `npm test` | Run deterministic tool tests |
| `npm run build` | Compile production JavaScript to `dist/` |
| `npm start` | Run the compiled server |
| `npm run preflight` | Check files, Git timing, secrets, and local API-key readiness |

## Current pipeline

1. The model calls `analyze_brief` to normalize objective, audience, format, and constraints.
2. The model creates a draft and calls `review_draft` against testable criteria.
3. It adapts when the review reports a material gap, within explicit stopping limits.
4. It calls `save_artifact` only when persistence is requested or clearly required.
5. Every raw call/result payload is sent to `/trace.html` through server-sent events and logged to
   ignored `data/events.ndjson` for rehearsal review.

See [pipeline rationale](docs/architecture.md), [prompt design](docs/prompt-design.md),
[surprise-input tests](docs/test-cases.md), and the [two-minute demo script](docs/demo-script.md).

## Customize for your product

This starter deliberately keeps the creative domain generic. Once the final user problem is chosen:

1. Rename the product and rewrite the example brief.
2. Replace generic tools in `src/agent/tools.ts` with domain-specific actions.
3. Update `src/agent/prompt.ts` with real success criteria and approval boundaries.
4. Add representative tests before adding more tools.
5. Keep the raw-event contract and verify failures on the second screen.

## Security

- `.env`, generated artifacts, logs, and dependencies are ignored by Git.
- API credentials never enter tool payloads or browser responses.
- The server limits request size, validates all tool arguments, and caps tool rounds.
- Run `npm run preflight` before every push and before recording.

## Model configuration

The default is `gpt-5.6-sol` with `medium` reasoning effort, configurable in `.env`. The app uses the
Responses API because the workflow needs reasoning, function tools, multi-round continuation, and
inspectable output items.

