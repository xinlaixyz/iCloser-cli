# Release Trust Report 2026-05-25
- Mode: full
- Status: pass
- Started: 2026-05-24T16:17:58.055Z
- Finished: 2026-05-24T16:27:51.933Z
- Warning budget: 20
- Observed warnings: 2
## Gates
| Gate | Status | Exit | Duration | Warnings |
| --- | --- | ---: | ---: | ---: |
| `npm run build` | pass | 0 | 6559ms | 0 |
| `npx tsc --noEmit` | pass | 0 | 5859ms | 0 |
| `npm run lint` | pass | 0 | 10789ms | 2 |
| `npm test` | pass | 0 | 60985ms | 0 |
| `npm run smoke` | pass | 0 | 81291ms | 0 |
| `npm run smoke:tools` | pass | 0 | 946ms | 0 |
| `npm run package` | pass | 0 | 427436ms | 0 |
## Decision
All required gates passed. Release can proceed subject to human product review.