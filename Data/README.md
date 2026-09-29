# Which Bench — research handoff

**Snapshot:** September 29, 2026. This set covers 2026 releases so far of coding-capable general models and specifically coding/security variants from OpenAI, Anthropic, and Google DeepMind. It is an artifact inventory, not a leaderboard of model quality.

## Files

- `release-index.md` — 32 release events with date, model, launch URL and linked card URL.
- `blog-posts.md` — 30 distinct launch articles, with every detected named benchmark in selectable prose, HTML tables or accessible captions. Image-only labels and alt text are excluded by design.
- `model-cards.md` — 24 distinct model/system cards, including 11 long Anthropic PDFs. Each source has the card URL and a page or extracted-text location for named benchmarks.
- `benchmark-notes.md` — definitions, official sources, name/version traps and the data fields needed for valid comparisons.
- `source-manifest.md` — source URLs, byte counts, SHA-256 hashes, and PDF page counts for retrieval verification.

The inventories preserve spelling and version labels from the source. A name appearing in a card may be in a comparison, methods section or safety assessment; presence alone does not mean the model has a published score. Shared posts or cards are inventoried once and linked from each relevant release event.

## Retrieval and completeness check

All **54 identified public source artifacts** were downloaded and parsed: 30 launch articles and 24 cards. Every linked Anthropic PDF opened and produced searchable text, including the card for Sonnet 5.5, which was linked from its launch page but had not yet appeared in Anthropic's card index. No identified artifact failed retrieval. The PDF/page extraction and HTML text extraction are the basis of these inventories, not search-result snippets. The controlled name scan was checked against article benchmark tables and the capability-section headings of the long cards.

The official indexes used for discovery were [Google DeepMind model cards](https://deepmind.google/models/model-cards/) and [Anthropic system cards](https://www.anthropic.com/system-cards), supplemented by each lab's launch archive and OpenAI's [Deployment Safety Hub](https://deploymentsafety.openai.com/). All artifact links are in the inventories. `No dedicated card located` in the index means that the launch page and relevant public card indexes did not provide a separate document for that variant. It does **not** mean a card fetch failed. This applies to Codex-Spark and the Cyber-specific variants listed there. GPT-5.4 mini is covered by an addendum to the GPT-5.4 card; GPT-6 Sol and Luna by a September 22 appendix to the Astra card. Do not assign all results in those parent cards to the added variants. No separate GPT-5.4 nano assessment was identified in the card addendum.

## Scope decisions

- Include a limited-access model when it is a new general coding/cyber model with a public launch (Mythos and Cyber variants).
- Keep preview and generally available launch events separate when they have different posts/cards; the underlying model family remains the same.
- Exclude voice, video, image generation, embedding, robotics, and product-only announcements. Gemini 3.1 Deep Think is treated as a mode evaluated within the Gemini 3.1 Pro card, rather than a separate release row. Gemini 3.5 Pro was still described as testing in the July launch and has no release row.
- Count named benchmarks outside coding when a lab chose to feature them. This is needed to answer *which* benchmarks a release chooses to discuss.
- Exclude anonymous internal tests from the named benchmark inventory. They remain in the original source but have no stable benchmark identity to normalize.

## Practical observations

The amount of benchmark discussion differs sharply by artifact. Google's [Gemini 3.1 Pro launch post](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-1-pro/) has one detected benchmark name in selectable article text (ARC-AGI-2), while its [card](https://deepmind.google/models/model-cards/gemini-3-1-pro/) has a broad native results table. Anthropic's [Sonnet 5 launch](https://www.anthropic.com/news/claude-sonnet-5) similarly puts a comparison table in an image; the article text names a smaller set than its [system card](https://www.anthropic.com/claude-sonnet-5-system-card). These are precisely the presentation choices Which Bench can measure. They are not claims that the other evaluations were never run.

## Next implementation pass

1. Convert each artifact section into structured records keyed by stable `artifact_id`, `release_event_id`, and `model_id`. Keep the artifact-to-model relationship many-to-many.
2. Preserve occurrence type (`narrative`, `table`, `caption`, `card`) and exact source location. Add a separate `discussed` field for surrounding explanation rather than assuming every table entry is discussed.
3. Apply the benchmark identity fields from `benchmark-notes.md`. Store unknown version and harness as unknown. Keep historical snapshots of edited posts/cards.
4. Add a review workflow for ambiguous names and newly introduced benchmarks. Never silently merge versions or substitute current leaderboard scores for launch claims.

## Limits of this snapshot

The public source set can change after September 29. Cards and launch posts can be edited or corrected later, so a future run should record retrieval time, content hash, and change log. The inventory is of **named benchmark mentions in readable source text**, not a complete extraction of every numerical score or unnamed safety metric. An image-only chart in a blog intentionally contributes zero mentions under this project's rule. Cards contain many broader safety evaluations; a benchmark's presence should be checked at its cited page before treating it as a coding performance result.
