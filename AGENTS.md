# Sierra Grid

Public-data explorer for the Ebbetts Pass corridor, built with Astro,
`@sierragridteam/sdk` and `@sierragridteam/design-system`. Read
`docs/architecture.md` before changing how pages mount, load or keep URL state.

- API: https://data.sierragridteam.org. Real data only: no demo transport, no
  fixtures in the product. A page that states a conclusion ("No active
  wildfires", "Up") must not state it when its source failed or is stale.
- Use the design system's tokens, classes and components. Do not redefine
  palette, type sizes, buttons or cards in page styles. A new reusable
  primitive belongs in the design system; domain composition belongs here.
- Every page starts with `pageHero` (`src/lib/hero.ts`): the design system's
  page header, one title size.
- Static Astro routes and ClientRouter. Page modules mount once per DOM root,
  clean up listeners and timers and abort requests before swaps. Modules load
  by domain.
- Keep URL state validated (`src/lib/state.ts`). Times are 24-hour Pacific.
- Put logic that decides what a page says in a pure module with tests
  (`*-model.ts`, `road-corridor.ts`, `mesh-monitors.ts`), not in the view.
- Use pnpm. Run `make verify` and `pnpm test:browser` before a pull request.
- No credentials, tokens or private data in the repository.

Don't add `Co-Authored-By:` trailers naming an agent or model, or any other AI attribution (such as a "Generated with" footer), to commit messages or pull request descriptions. `.claude/settings.json` turns off Claude Code's default commit trailer; follow the same rule with any other tool.
