# Contributing to Orbis

Thank you for your interest in contributing to Orbis by Memora! We welcome community contributions, examples, documentation improvements, framework adapters, and bug reports.

## Ways to Contribute

1. **Add Examples:** Create new runnable workflows in the `examples/` directory showing how Orbis integrates with AI agent frameworks (LangChain, CrewAI, AutoGen, LlamaIndex, etc.).
2. **Report Issues:** Submit detailed bug reports with reproducible steps using our [Bug Report Template](.github/ISSUE_TEMPLATE/bug_report.md).
3. **Propose Features:** Share ideas for new locators, CDP domain extensions, or developer tools via [Feature Requests](.github/ISSUE_TEMPLATE/feature_request.md).
4. **Documentation:** Fix typos, clarify guides, or add tutorials for your favorite languages.

## Development Workflow

1. Fork the repository and create your branch from `main`:
   ```bash
   git checkout -b feature/my-new-example
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Test your example:
   ```bash
   npm run example:agent
   ```
4. Commit your changes with a clear commit message and submit a Pull Request.

## Documentation and Example Standards

The documentation in [`docs/`](docs/README.md) is meant to be safe to rely on in production. Please keep it that way:

- **Verify every claim against the released package.** Run code samples against the published `@memoracompany/orbis` / `memora-orbis` version before submitting. If you describe a behaviour, say which version you tested.
- **No unmeasured numbers.** Performance figures must come from a measurement you can describe (machine, date, method). Otherwise leave them out.
- **Document limitations openly.** Mark bugs with a `> **Known issue (x.y.z):**` callout and add them to [`docs/limitations.md`](docs/limitations.md) with a workaround.
- **Use the real names.** npm package `@memoracompany/orbis` (`npx -y @memoracompany/orbis`), CLI binary `orbis`, PyPI package `memora-orbis` (`from orbis import OrbisAgent`). Flags such as `--cdp`, `--webdriver`, `--stealth` and `--headless` do not exist.
- **Make examples deterministic.** Prefer a small local web server or `page.setContent()` over third-party sites, so examples work offline and in CI.
- **Keep secrets out of examples.** Read credentials from environment variables, and never commit session files.

## Code of Conduct

Please note that this project is released with a [Contributor Code of Conduct](CODE_OF_CONDUCT.md). By participating in this project you agree to abide by its terms.

## Questions?

- **Documentation:** [docs/README.md](docs/README.md) and https://orbis.memora.company
- **Support & Sales:** engineering@memora.company

