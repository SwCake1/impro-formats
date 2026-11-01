---
name: import-formats
description: Collect improv formats from a source, compare them with the Impro Formats catalog, and prepare an HTML review. Resume processing additions and updates from a returned format-review-selection.
---

# Import Formats

Work in the Impro Formats project. Locate its root through this skill's real path under `.agents/skills/import-formats/`. The [tool documentation](../../../docs/format-review.md) defines the data contract; the [example batch](../../../tools/format-review/example-recommendations.json) shows the input. Use the existing template and generator.

## Prepare a review

Collect candidates from the supplied source and compare their meaning with the current working sheet, `Все форматы`. Preserve verbatim source text and links. You may structure descriptions, but do not invent rules. Infer moderator, on-stage audience, props, and furniture requirements from the described mechanics, even without explicit requirement fields: use false and furniture "Нет" when clearly unnecessary; leave genuinely ambiguous requirements unknown. Never add overall format or round duration to `note`, including update proposals. Preserve timing that defines the game mechanics in the description, and keep source text and catalog snapshots verbatim. State any limits on coverage or data freshness.

For plausible matches, include the existing format's complete snapshot, permanent ID, videos, link, and an explanation of similarities and differences. Leave the merge decision to the user. Populate matches in the batch yourself; `--catalog` supplies only tag choices.

Assign every candidate a `recommendation` using the documented action codes, with one concise sentence explaining the decision and proposed field values for updates. Name the decisive difference, addition, or question; do not repeat the full description or generic import policy. Keep detailed comparisons in match reasons. Existing catalog data takes priority: missing source fields are not changes. Mark the same format without useful additions as `duplicate`; use `update` only for useful additions that preserve existing information, and `review` for uncertainty or conflicting known values. The tool supplies consistent emoji and initial selection from these recommendations.

Keep each batch in its own `ignore/format-review/<batch-name>/` folder: `batch.json`, `catalog.json`, `review.html`, and a brief `review-state.json` recording `batchId`, file paths, source, and progress so work can resume after review.

From the project root:
```bash
npm run review:generate -- --input ignore/format-review/<batch-name>/batch.json --catalog ignore/format-review/<batch-name>/catalog.json --output ignore/format-review/<batch-name>/review.html
```

Return a link to the HTML and end the turn, awaiting the user's next message. The user edits fields, chooses creation or update, and returns the result of “Скопировать для агента” (Copy for agent). Remind them that closing or reloading the page loses unsaved edits.

## Resume after review

Find the original batch by `batchId`, save the returned `format-review-selection` as `selection.json`, and validate it:
```bash
node .agents/skills/import-formats/scripts/validate-selection.mjs --batch ignore/format-review/<batch-name>/batch.json --selection ignore/format-review/<batch-name>/selection.json
```

This validates the decision against the original batch. It neither checks the current sheet nor writes to it.

Apply selected operations when the user explicitly authorizes writes, respecting current project instructions; do not ask again for permission already given. Before an update, compare current values with `before`: skip values already equal to `after` and surface other differences as conflicts. Update only selected fields by `targetId`, preserving other data and the permanent ID. Add new formats separately with blank IDs until Publish.

Verify actual writes and record the outcome in the batch state to prevent duplicate application. Publish and deployment require a separate request.
