# Contributing to Translator

Thanks for helping improve Translator. Small, reviewable changes with a reproducible reason are the easiest to merge.

## Before opening a change

- Search existing issues and pull requests.
- For bugs, include the platform, CPU architecture, Translator version, expected behavior, actual behavior, and the smallest reliable reproduction.
- For product proposals, describe the user workflow and failure mode before proposing an implementation.
- Never include customer media, API keys, checkout identifiers, private logs, or copyrighted test content you cannot redistribute.

Security reports belong in [SECURITY.md](SECURITY.md), not a public issue.

## Development setup

```bash
git clone https://github.com/mikey1384/translator.git
cd translator
npm install
npm run dev
```

Translator contains native Electron dependencies. Development and packaging behavior can differ across macOS Apple Silicon, macOS Intel, and Windows.

## Checks

Run the checks relevant to the files you changed:

```bash
npm run lint
npm run build
npm run --prefix packages/main test
```

Changes to native binaries, packaging, downloads, tabs, IPC, billing, credential handling, or job cancellation require focused platform testing in addition to compilation.

## Pull requests

Keep pull requests focused. Include:

- the problem and why it matters;
- the chosen behavior and meaningful tradeoffs;
- the tests or manual checks performed;
- screenshots for visible interface changes;
- any migration, compatibility, privacy, cost, or release implications.

Do not reformat unrelated files or mix broad dependency updates into a product change.

## Localization

User-facing text must remain aligned across the locale files in `packages/renderer/locales`. Avoid literal machine translations when a short natural phrase conveys the product behavior better.

## License

By contributing, you agree that your contribution is licensed under the repository's [MIT License](LICENSE).
