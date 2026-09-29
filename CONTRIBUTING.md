# Contributing

Feedback about the design, methodology, missing releases, and incorrect checks is welcome. Open an issue with the release, benchmark name and version, the disputed tier, and the original or archived source location. A screenshot of the relevant source passage or chart helps when extraction misses it. No model benchmark score needs to be reproduced in the site's data.

For a code or data correction, fork the repository and open a pull request describing the problem, source evidence, and resulting behavior. Keep the scope to 2026 coding-capable models from OpenAI, Anthropic, and Google. Use the archived snapshot when possible so the evidence remains reproducible. Preserve original source bytes and checksums; future snapshots belong in a new directory.

Make classification fixes in `scripts/build_dataset.py` or the source inventories, regenerate the public JSON/CSV, and run `scripts/validate.py` and the regression tests. Keep scores out of the application dataset and export. Original source archives and the internal classification review may retain source results for verification.

By submitting original contributions, you grant the project maintainer permission to incorporate and distribute them as part of Witchbench. You retain ownership of your contribution. Do not contribute materials you lack permission to submit. Third-party archives and vendored components retain their existing rights.
