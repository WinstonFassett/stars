## Development

Run the dev server with `npm run dev` — it wraps **portless**
(`portless run astro dev`) to give a named URL like
http://stars-site.localhost:PORT/stars/ (the app is served under the `/stars`
base). No portless installed? Run `npx astro dev` directly (→
http://localhost:4321/stars/); `astro.config` also honors `PORT`/`HOST`.

### Foreground vs Astro's dev daemon

The `dev` script sets `ASTRO_DEV_BACKGROUND=1`. This name is misleading — it
forces the server to run **foreground**. Astro 7.0.3+ added an `isRunByAgent()`
check: when a coding agent (Claude Code, Devin, etc.) launches `astro dev`, it
auto-daemonizes and detaches, which breaks portless's proxy route (the launcher
exits, so the named URL 404s). Setting `ASTRO_DEV_BACKGROUND` to any value skips
that auto-detection and keeps the process attached, so portless (and agents)
work. Humans starting it in a terminal were never affected.

If you *want* the daemon: `astro dev --background`, managed with
`astro dev stop` / `status` / `logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
