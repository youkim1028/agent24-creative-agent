# AGENTS.md

## Mission

Build DeckForge X: a reliable Creative-track agent that turns live X conversations
into short, grounded PPTX decks whose decisions and recovery behavior are easy to judge.

## Working agreement

- Preserve the two-screen contract: user experience on `/`, raw tool events on `/trace.html`.
- Use the OpenAI Responses API. Keep the model configurable through `OPENAI_MODEL`.
- Use Grok only for X Search through xAI. Keep it configurable through `GROK_MODEL`.
- Treat X posts as evidence of conversation, never automatic proof of factual claims.
- Render only the exact DeckSpec that passed validation in the same run.
- Never log or commit API keys, authorization headers, cookies, or personal data.
- Add or update tests whenever tool behavior or routing changes.
- Keep tool descriptions precise. Each tool must have one clear reason to exist.
- For implementation requests, make scoped local changes and run relevant validation.
- Ask before external writes, destructive actions, purchases, or material scope expansion.

## Required checks

Run these before claiming completion:

```powershell
npm run typecheck
npm test
npm run build
npm run preflight
```

## Commit convention

Use small, truthful Conventional Commits such as `feat:`, `fix:`, `test:`, `docs:`,
and `chore:`. Do not rewrite or fabricate history.

