# Release Trust Report 2026-05-21
- Mode: fast
- Status: pass
- Started: 2026-05-21T03:11:56.879Z
- Finished: 2026-05-21T03:12:22.365Z
- Warning budget: 20
- Observed warnings: 0
## Gates
| Gate | Status | Exit | Duration | Warnings |
| --- | --- | ---: | ---: | ---: |
| `npx tsc --noEmit` | pass | 0 | 7261ms | 0 |
| `npm run lint` | pass | 0 | 11211ms | 0 |
| `npx vitest run tests/collaboration-commands.test.ts tests/diff-explain.test.ts tests/memory-experience.test.ts tests/repl-ai-routing.test.ts tests/tool-executor-web-search-root.test.ts` | pass | 0 | 7010ms | 0 |
## Decision
All required gates passed. Release can proceed subject to human product review.