# Grocery Getter performance: docker-development

- Timestamp: 2026-09-16T15:31:44.391Z
- Target: http://127.0.0.1:5173
- Git commit: e8d4b2eb6a8a56aff2d1dcf555fd28eccb1539e8
- Browser: Chromium (Desktop Chrome profile)
- Host: win32 10.0.26200 (x64)
- Samples: 3 per route after 1 warmup
- Ready condition: fresh browser context, expected page heading visible, and initial API activity quiet for 250 ms

| Route | Median ready (ms) | p95 (ms) | Min (ms) | Max (ms) |
| --- | ---: | ---: | ---: | ---: |
| planner | 23673.2 | 26712.3 | 23030.0 | 26712.3 |
| recipes | 23060.2 | 23137.6 | 22905.8 | 23137.6 |
| shopping-lists | 23608.8 | 23840.5 | 22979.7 | 23840.5 |
| ingredients | 25623.9 | 25875.4 | 24385.4 | 25875.4 |

Full per-sample browser and API resource timings are available in the matching JSON report.
