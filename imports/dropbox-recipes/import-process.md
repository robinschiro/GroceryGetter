# Dropbox Recipe Import Process

This process converts plaintext Dropbox recipe exports into `parsed-recipes.json` for the local grocery planning app.

## Files

- `raw/`: source plaintext recipe files.
- `import-prompt.md`: first-pass extraction prompt used to generate `parsed-recipes.json`.
- `review-prompt.md`: second-pass review prompt used to find semantic extraction errors.
- `parsed-recipes.json`: generated import file consumed by the sync script.
- `parsed-recipes.example.json`: small example of the expected JSON shape.

## Workflow

1. Put source recipe text files in `imports/dropbox-recipes/raw/`.

2. Generate `parsed-recipes.json` using `import-prompt.md`.
   - The output must be a JSON array only.
   - Do not include markdown fences, prose, comments, or trailing commas.
   - Skip raw files that cannot produce a valid recipe with at least one ingredient, such as empty files or instruction-only notes.

3. Review the generated file using `review-prompt.md`.
   - Compare `parsed-recipes.json` against the raw source files.
   - The review output should be a JSON array of findings.
   - `[]` means no review findings.

4. Fix review findings before importing.
   - Fix every `severity: "error"` finding.
   - Manually inspect `severity: "warning"` findings.
   - Do not blindly auto-apply review output; use it as an error report.
   - If the same error pattern appears repeatedly, update `import-prompt.md` so future imports avoid it.

5. Re-run the review prompt after fixes.
   - Continue until there are no high-confidence semantic errors.

6. Validate the final JSON:

```powershell
& 'C:\Users\AI\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\scripts\import-recipes.ts --validate-only .\imports\dropbox-recipes\parsed-recipes.json
```

7. Dry-run sync against the local API before committing any import:

```powershell
& 'C:\Users\AI\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\scripts\import-recipes.ts --sync .\imports\dropbox-recipes\parsed-recipes.json
```

8. Only run a real import when the validation and dry run are clean.
   - Use the sync script's commit mode only when you intentionally want to create, update, or delete local recipes.
   - Preserve local recipe data unless the task explicitly asks to change it.

## Common Review Issues

Remove ingredient rows that are actually:

- Recipe titles, such as `Chicken Casserole` or `Chili`.
- Serving lines, such as `4 people`.
- Section headings, such as `Step:`, `Marinade:`, or `Tenderizing the chicken thighs:`.
- Equipment, such as `9 x 5 baking pan` or `9" circular pie pan`.
- Cooking steps, such as `Then, sear the skin side...`.
- Storage, scaling, timing, technique, TODO, warning, or disclaimer notes.
- Instruction shorthand, such as `Mayo -> Mustard -> Curry -> Soup -> Milk -> Cheddar`.

Clean ingredient rows when the grocery item is valid but the parsed data is malformed:

- `30 oz. package frozen vegetables` should keep the text but use `item: "frozen vegetables"`.
- `16 oz. package of hearty egg noodles` should keep the text but use `item: "hearty egg noodles"`.
- `3 room temp eggs - put in warm water for 5 minutes` should become `3 room temp eggs`.
- `1/2 cup oyster + 1/2 cup soy` should be split into separate oyster sauce and soy sauce rows.

## Acceptance Criteria

Before importing, all of these should be true:

- `parsed-recipes.json` is valid JSON.
- Every recipe has at least one ingredient.
- Every ingredient has non-empty `text` and `item`.
- No ingredient row is a title, heading, serving count, equipment line, step, or note.
- `item` values are grocery search terms, not instruction fragments.
- `scripts/import-recipes.ts --validate-only` passes.
- The sync dry run reports expected new, changed, unchanged, name-conflict, and missing-source recipes.
