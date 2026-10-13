# Contributing

Pull requests are welcome, but this repository is designed to remain safe when public.

Before opening a pull request:

1. Use fabricated data only. Never use a real chat excerpt, name, identifier, mapping, screenshot, or export as a fixture/example.
2. Read [the public repository privacy policy](docs/privacy/public-repository-policy.md).
3. Run `npm run privacy:guard`, `npm test`, and `npm run build`.
4. If your change adds a fixture or screenshot, state how you confirmed that every visible value and event was fabricated.

External chat-like fixture files belong only under `tests/fixtures/synthetic/`. Text fixtures there must include `SYNTHETIC_FIXTURE` near the top. Synthetic screenshots for documentation belong under `docs/synthetic/`.

The automated privacy guard catches only some structured mistakes. Passing CI is not proof that content is anonymous, so human review is still required.
