# Grocery Getter performance: native-development

- Timestamp: 2026-09-16T15:39:13.713Z
- Target: http://127.0.0.1:5173
- Git commit: e8d4b2eb6a8a56aff2d1dcf555fd28eccb1539e8
- Browser: Chromium (Desktop Chrome profile)
- Host: win32 10.0.26200 (x64)
- Samples: 3 per route after 1 warmup
- Ready condition: fresh browser context, expected page heading visible, and initial API activity quiet for 250 ms

| Route | Median ready (ms) | p95 (ms) | Min (ms) | Max (ms) |
| --- | ---: | ---: | ---: | ---: |
| planner | 872.1 | 874.5 | 857.8 | 874.5 |
| recipes | 585.6 | 589.1 | 582.8 | 589.1 |
| shopping-lists | 589.2 | 590.1 | 582.1 | 590.1 |
| ingredients | 844.7 | 860.9 | 816.3 | 860.9 |

Full per-sample browser and API resource timings are available in the matching JSON report.
