# Grocery Getter performance: docker-compose-watch-development

- Timestamp: 2026-09-16T17:48:08.339Z
- Target: http://127.0.0.1:5173
- Git commit: 0d082187ca40d364de12c5a0cb0ae51b28258d37
- Browser: Chromium (Desktop Chrome profile)
- Host: win32 10.0.26200 (x64)
- Samples: 3 per route after 1 warmup
- Ready condition: fresh browser context, expected page heading visible, and initial API activity quiet for 250 ms

| Route | Median ready (ms) | p95 (ms) | Min (ms) | Max (ms) |
| --- | ---: | ---: | ---: | ---: |
| planner | 866.7 | 2834.8 | 849.3 | 2834.8 |
| recipes | 600.0 | 603.1 | 573.4 | 603.1 |
| shopping-lists | 586.8 | 618.1 | 575.9 | 618.1 |
| ingredients | 846.0 | 846.3 | 843.9 | 846.3 |

Full per-sample browser and API resource timings are available in the matching JSON report.
