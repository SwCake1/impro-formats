---
name: import-formats
description: Collect improv formats from a source, compare them with the Impro Formats catalog, and prepare an HTML review. Resume processing additions and updates from a returned format-review-selection.
---

# Import Formats

Work in the Impro Formats project. Locate its root through this skill's real path under `.agents/skills/import-formats/`. The [tool documentation](../../../docs/format-review.md) defines the data contract; the [example batch](../../../tools/format-review/example-recommendations.json) shows the input. Use the existing template and generator.

## Prepare a review

Collect candidates from the supplied source and compare their meaning with the current working sheet, `Все форматы`. Preserve verbatim source text and links. You may structure descriptions, but do not invent rules. Infer moderator, on-stage audience, props, and furniture requirements from the described mechanics, even without explicit requirement fields: use false and furniture "Нет" when clearly unnecessary; leave genuinely ambiguous requirements unknown. Never add overall format or round duration to `note`, including update proposals. Preserve timing that defines the game mechanics in the description, and keep source text and catalog snapshots verbatim. State any limits on coverage or data freshness.

Prepare import fields as standalone catalog content: do not add source attributions, citations, or provenance commentary such as «в источнике сказано», «по материалам канала» or publisher branding such as «Это Импров». Keep source references and verbatim raw source text in the batch's source metadata for review, outside the imported fields. Video URLs remain in `video`. Video labels must omit the format name, including aliases and the «Формат …» prefix, because the video already belongs to that format's card; retain useful team, show, event, date, scene context, or timestamp details. Apply this rule to newly prepared text; preserve existing catalog snapshots and entries unless their cleanup is explicitly requested.

For each new video entry in `video`:

- Remove filename extensions such as `.mp4`, `.mov`, `.avi`, `.mkv`, `.webm`, and `.m4v`, along with technical sequence numbers such as the `2.` in `2. АБАБ.mp4`. Preserve meaningful numbers: dates, timestamps, team or show names, and numbers that define the format or scene. Clean only the label; never alter the URL, its video ID, or query parameters.
- Omit labels that merely repeat the format name or a known alias, allowing for capitalization, punctuation, and `е`/`ё`. If no useful context remains, use the URL alone, without a colon or an invented placeholder. For example, for «АБАБ (Ты мне, я тебе)», `2. АБАБ.mp4: https://…` becomes `https://…`.
- When useful context remains, put the concise plain-text label first, then a colon and the original URL: `Команда Близкие. Лига импрова: https://…`. Convert `URL — explanation` to `explanation: URL`. Retain useful team, show, event, date, scene, round, and timestamp details. Do not add the format name back into the label. If a video's title differs from the format name and is not a confirmed alias, retain its useful wording and flag uncertain attribution in review metadata rather than silently treating it as a duplicate.
- If the context or link attribution is unclear, open the linked page and inspect its title, description, or preview. If inaccessible, use only context supported by the source and record the verification limit in review metadata; do not invent a title or claim to have watched the video. A bare URL is valid when no informative label can be established.

Keep each video entry on its own line. Preserve original URLs, verbatim source text, catalog snapshots, and existing video entries; append new links without duplicating URLs already present, regardless of label differences. These cleanup rules apply to newly prepared video text. Change existing entries only when their cleanup is explicitly requested, comparing live values with the approved before/after proposal before writing. When one source message contains several formats or videos, verify which link belongs to which format rather than relying on link order alone.

For plausible matches, include the existing format's complete snapshot, permanent ID, videos, link, and a concise sentence naming the shared mechanic and decisive difference or conflict. Leave the merge decision to the user. Populate matches in the batch yourself; `--catalog` supplies only tag choices.

Assign every candidate a `recommendation` using the documented action codes, with one concise sentence explaining the decision and proposed field values for updates. Name the decisive difference, addition, or question; do not repeat the full description or generic import policy. Keep match reasons equally concise; avoid retelling descriptions or generic import policy. Existing catalog data takes priority: missing source fields are not changes. Mark the same format without useful additions as `duplicate`; use `update` only for useful additions that preserve existing information, and `review` for uncertainty or conflicting known values. The tool supplies consistent emoji and initial selection from these recommendations.

For every `duplicate`, set `recommendation.descriptionMatch` to `equivalent`, `different`, or `unknown` by comparing the rules with its target. The tool separately compares names and known requirement/tag values; missing values never count as matches.

Keep each batch in its own `ignore/format-review/<batch-name>/` folder: `batch.json`, `catalog.json`, `review.html`, and a brief `review-state.json` recording `batchId`, file paths, source, and progress so work can resume after review.

From the project root:
```bash
npm run review:generate -- --input ignore/format-review/<batch-name>/batch.json --catalog ignore/format-review/<batch-name>/catalog.json --output ignore/format-review/<batch-name>/review.html
```

Return a link to the HTML and a short next step: review “Проверить” and “Дубли”, adjust decisions with “Добавить как новый” or “Подготовить обновление”, then send the result of “Скопировать для агента” (Copy for agent). New formats and useful updates are preselected; only checked cards are exported, including those hidden by category filters. “Подготовить обновление” opens a local update draft without writing to the catalog, places the chosen match below the finding, and collapses other matches; the field editor follows and immediately shows differences between the finding and catalog alongside existing result edits, without applying any values automatically. “Редактировать” opens the fields; “Готово” returns to the readable card. Edits, separate action drafts, and selection autosave in the same browser. After confirmation, “Сбросить правки” restores the entire batch, while “↺ Сбросить” in an expanded card restores only that format's original values, action drafts, and initial selection; the individual reset autosaves and preserves other cards. The card reset appears only when fields differ from their initial values in any of its drafts; selection, mode switches, and initial agent proposals do not count as edits. If the page reports a save failure, tell the user to copy the result before closing. End the turn awaiting the user's next message.

The review shows the incoming title and description as one block, followed by the recommended or first catalog match already expanded. Keep reasons concise, avoid repeating the descriptions, and do not prefix reasons with “Агент:”. Raw source text stays in the batch and export; the interface shows only a source link. Use the existing layout rather than generating separate source panels or instructions inside cards.

## Resume after review

Find the original batch by `batchId`, save the returned `format-review-selection` as `selection.json`, and validate it:
```bash
node .agents/skills/import-formats/scripts/validate-selection.mjs --batch ignore/format-review/<batch-name>/batch.json --selection ignore/format-review/<batch-name>/selection.json
```

This validates the decision against the original batch. It neither checks the current sheet nor writes to it.

Apply selected operations when the user explicitly authorizes writes, respecting current project instructions; do not ask again for permission already given. Before an update, compare current values with `before`: skip values already equal to `after` and surface other differences as conflicts. Update only selected fields by `targetId`, preserving other data and the permanent ID. Add new formats separately with blank IDs until Publish.

Verify actual writes and record the outcome in the batch state to prevent duplicate application. Publish and deployment require a separate request.
