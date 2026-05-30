# Release Trust Report 2026-05-23
- Mode: fast
- Status: pass
- Started: 2026-05-23T10:53:13.360Z
- Finished: 2026-05-23T10:53:50.380Z
- Warning budget: 20
- Observed warnings: 1
- Storage note: Project report path was not writable: D:\temp\Codex\AgentCode\doc\release\TRUST_REPORT_2026-05-23.md. Fallback file is authoritative for this run. Original error: EPERM: operation not permitted, open 'D:\temp\Codex\AgentCode\doc\release\TRUST_REPORT_2026-05-23.md'
## Gates
| Gate | Status | Exit | Duration | Warnings |
| --- | --- | ---: | ---: | ---: |
| `npx tsc --noEmit` | pass | 0 | 7717ms | 0 |
| `npm run lint` | pass | 0 | 14870ms | 1 |
| `npx vitest run tests/collaboration-commands.test.ts tests/diff-explain.test.ts tests/memory-experience.test.ts tests/repl-ai-routing.test.ts tests/tool-executor-web-search-root.test.ts` | pass | 0 | 14432ms | 0 |
## Decision
All required gates passed. Release can proceed subject to human product review.