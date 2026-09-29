# Witchbench

Which benchmarks are in fashion? A static, source-linked view of benchmark usage in 2026 coding-capable model announcements from OpenAI, Anthropic, and Google.

The interface contains coverage checks, never model benchmark scores. Desktop opens a matrix with the newest release on the right. Phones show one release’s benchmarks as a readable list, with a release selector and previous/next controls. Both support comma-separated model search and a monthly usage chart. Compare lets you select two releases and shows only benchmarks used by at least one of them, with Shared and Only one filters. Evidence remains a tap away. CSV export always includes the entire annual snapshot.

## Run locally

No frontend build or npm dependencies are required.

```sh
python3 -m http.server 4320 --bind 127.0.0.1 --directory site/dist
```

Open http://127.0.0.1:4320/. All fonts, scripts, styles, and source snapshots are local. External links open the original publications or GitHub.

## Data and reproducibility

The September 29, 2026 snapshot starts from the six original handoff files in `Data/`. It contains 32 announcement events, 30 launch posts, and 24 model cards. Grouped model launches remain one event; restricted previews and subsequent launches remain separate events. Missing dedicated cards are labeled explicitly.

- **Blog highlight:** named benchmark discussion in launch prose about the release model's performance or limitations. Tables, captions, citations, and setup notes alone do not qualify.
- **Card evaluation:** numerical evaluation evidence for the release model in its own card, including archived charts with extractable image text. Historical comparison models alone do not qualify.
- **Popularity:** distinct announcement events with either check; both tiers count once. Versions remain separate. Search filters the chart denominator but does not reorder the matrix rows.
- **Blank:** no qualifying finding identified in this snapshot. It is not proof that the benchmark was never run.

Classification uses deterministic text rules and macOS Vision chart extraction, with source locations retained for review. This is an MVP, not a completed independent manual audit. OCR and PDF extraction can miss content or misclassify adjacent discussion. Please report corrections with a source location. Future months and omitted events are not synthesized.

`Data/archive/2026-09-29/` contains the untouched original HTML/PDF bytes, retrieval records, SHA-256 checksums, extracted text, article image assets, image text, and inert reading copies. Reading copies simplify layout and remove active scripts; the original bytes remain available for comparison. Images from each article's primary HTML image URLs are captured; responsive variants, interactive widgets, and videos are not mirrored. Raw download hashes may differ from the handoff hashes because live HTML serialization changes; this alone does not establish a substantive source change.

`Data/classification-review.json` contains internal evidence candidates, including original numerical text. `Data/dataset.json` and the CSV are deliberately score-free and are copied to `site/dist/data/`. Original source archives retain the publications' complete original content.

To rebuild from the checked-in archive:

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python scripts/build_dataset.py
python scripts/validate.py
python -m unittest discover -s tests
```

Optional archive regeneration commands are `python scripts/archive_sources.py`, `python scripts/archive_media.py`, and, on macOS, `swift scripts/ocr_archive.swift Data/archive/2026-09-29/assets Data/archive/2026-09-29/image-text.json`. The source archiver reuses valid existing originals. Do not silently overwrite a published snapshot; a later refresh should use a new snapshot directory and explicit review.

## Hosting

The site is live at [witchbench.web.app](https://witchbench.web.app/) on the dedicated `witchbench` Hosting site in the `lyalinlabs` Firebase project. `firebase.json` serves `site/dist`, and `.firebaserc` selects that project. To publish a reviewed update, run `firebase deploy --only hosting --project lyalinlabs`. Raw archived HTML is served as a sandboxed download; inert reading copies have a separate restrictive content policy. The local Python server does not apply Firebase response headers.

## Contributions and rights

Corrections and contributions are welcome through issues and pull requests; see [CONTRIBUTING.md](CONTRIBUTING.md). The repository is public for transparency. Original Witchbench work is copyright © 2026 Dmitry Lyalin. All rights reserved; public visibility does not imply a permissive license. Archived source materials retain their owners' rights. The vendored CookieConsent 3.1.0 component is MIT-licensed, with its license included.

Claude Fable 5.1 contributed the original interface through the Claude CLI; Claude Opus 5.5 contributed the responsive redesign through Claude Code. Codex handled source archiving, classification, comparison behavior, integration, and validation.
