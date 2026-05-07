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

- `lib/db/src/schema/` — DB schema: `leagues.ts`, `draftPlayers.ts`, `draftPicks.ts`, `makeupPicks.ts`, `queuedPicks.ts`
- `artifacts/api-server/src/bot/` — Discord bot: `index.ts`, `utils.ts`, `deployCommands.ts`, `timerManager.ts`, `draftEngine.ts`
- `artifacts/api-server/src/bot/commands/` — slash commands: createLeague, deleteLeague, pick, viewDraft, queuePick, viewQueue, clearQueue, makeupPick, editPick
- `DISCORD_BOT_SETUP.md` — full setup guide for the Discord bot

## Architecture decisions

- Bot runs in the same process as Express — starts only when `DISCORD_TOKEN` is set, failing gracefully otherwise
- Snake draft position tracked as a single `currentDraftPosition` integer in the `leagues` table; player turn is derived algorithmically (no mutable "current player" field)
- Each channel supports exactly one active league at a time; soft-delete (`status = 'deleted'`) preserves history
- Players who exhaust budget or hit max picks are skipped automatically via `findNextEligiblePosition`
- `/view-draft` is always ephemeral (private); pick announcements are always public
- **Draft engine** (`draftEngine.ts`) handles all turn advancement in an iterative loop (max 200 iterations): auto-queue picks → auto-skips → human turn ping + timer. `autoSkip` is called by timer expiry. `restoreTimers` is called on bot ready to recover timers after restarts.
- **Timer state** persisted via `turnStartedAt` timestamp on leagues; surviving restarts is handled via `restoreTimers`
- **Queued picks** (priority 1–5) are auto-executed in priority order when it's a player's turn. Sniped/unaffordable picks are skipped; if all fail, the player is skipped and a makeup pick is created.
- **Makeup picks**: created on timer skip or all-queued-sniped. Deadline = player's next draft position. Missing the deadline halves the player's timer (`timerHalvingCount + 1`).
- **Edit pick**: allowed only while no one has picked after the user (check by highest pick ID in the league).
- `sendToChannel(client, channelId, content)` helper in draftEngine for non-interaction messages.
- `timerManager` is a module-level singleton that stores active `setTimeout` handles keyed by league ID.

## Product

- `/league-create` — Host/admin only; creates a snake draft league with optional turn timer (0 = off)
- `/league-delete` — Host/admin only; soft-deletes the active league in this channel
- `/pick round:<n> pokemon:<name> cost:<amount>` — Draft a Pokemon on your turn; bot validates turn, budget, round, and duplicate picks
- `/view-draft [round:<n>]` — Private embed showing all picks grouped by round
- `/queue-pick priority:<1-5> pokemon:<name> cost:<amount>` — Pre-queue up to 5 picks to be auto-drafted on your turn
- `/view-queue` — See your current queued picks (ephemeral)
- `/queue-clear [priority:<1-5>]` — Remove one or all queued picks
- `/makeup-pick pokemon:<name> cost:<amount>` — Make a makeup pick for a skipped turn (before your next regular turn)
- `/edit-pick pokemon:<name> cost:<amount>` — Edit your most recent pick while the next player hasn't picked yet

## Gotchas

- Run `pnpm --filter @workspace/db run push` before starting the bot — tables must exist
- Run `pnpm --filter @workspace/api-server run deploy-commands` once to register slash commands with Discord (global commands can take up to 1 hour to propagate)
- The `Host` role must be named exactly "host" (case-insensitive) in the Discord server
- `noImplicitReturns: true` — all `execute()` functions use `await reply(); return;` pattern, never `return reply()`
- Discord option descriptions must be ≤ 100 characters

## Pointers

- Full setup guide: `DISCORD_BOT_SETUP.md`
- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
