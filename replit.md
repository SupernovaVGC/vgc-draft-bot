# VGC Draft League Discord Bot

A Discord bot that manages Pokemon VGC snake draft leagues, running alongside an Express API server.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server + Discord bot (port from `$PORT`)
- `pnpm --filter @workspace/api-server run deploy-commands` — register slash commands with Discord (run once on setup)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL`, `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- Bot: discord.js v14 (slash commands, Guilds intent only)
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- Build: esbuild (CJS bundle, two entry points: server + deployCommands)

## Where things live

- `lib/db/src/schema/` — DB schema: `leagues.ts`, `draftPlayers.ts`, `draftPicks.ts`
- `artifacts/api-server/src/bot/` — Discord bot: `index.ts`, `utils.ts`, `deployCommands.ts`
- `artifacts/api-server/src/bot/commands/` — slash commands: createLeague, deleteLeague, pick, viewDraft
- `DISCORD_BOT_SETUP.md` — full setup guide for the Discord bot

## Architecture decisions

- Bot runs in the same process as Express — starts only when `DISCORD_TOKEN` is set, failing gracefully otherwise
- Snake draft position tracked as a single `currentDraftPosition` integer in the `leagues` table; player turn is derived algorithmically (no mutable "current player" field)
- Each channel supports exactly one active league at a time; soft-delete (`status = 'deleted'`) preserves history
- Players who exhaust budget or hit max picks are skipped automatically via `findNextEligiblePosition`
- `/view-draft` is always ephemeral (private); pick announcements are always public

## Product

- `/league-create` — Host/admin only; creates a snake draft league in the current channel with up to 16 players
- `/league-delete` — Host/admin only; soft-deletes the active league in this channel
- `/pick round:<n> pokemon:<name> cost:<amount>` — Draft a Pokemon on your turn; bot validates turn order, budget, round number
- `/view-draft [round:<n>]` — Private embed showing all picks grouped by round

## Gotchas

- Run `pnpm --filter @workspace/db run push` before starting the bot — tables must exist
- Run `pnpm --filter @workspace/api-server run deploy-commands` once to register slash commands with Discord (global commands can take up to 1 hour to propagate)
- The `Host` role must be named exactly "host" (case-insensitive) in the Discord server
- `noImplicitReturns: true` — all `execute()` functions use `await reply(); return;` pattern, never `return reply()`

## Pointers

- Full setup guide: `DISCORD_BOT_SETUP.md`
- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
