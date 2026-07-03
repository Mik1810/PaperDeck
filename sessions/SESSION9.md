# SESSION 9

Date: 2026-07-03
Task: Choose and declare the project license

## What was done

- Added the root `LICENSE` file using the MIT License.
- Declared `MIT` in `package.json` and refreshed the root package metadata in `package-lock.json`.
- Added a README license section clarifying that source code and documentation are MIT-licensed, while PaperDeck branding and third-party paper metadata remain subject to their own rights and terms.
- Updated `ROADMAP.md` to record the repository license decision.
- Updated `CHANGELOG.md` under `Unreleased`.

## Validation

- `npm install --package-lock-only --ignore-scripts` completed and only refreshed package metadata.
- `npm run lint` passed.
