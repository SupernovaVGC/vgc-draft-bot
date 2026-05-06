# VGC Draft League Discord Bot — Setup Guide

## Overview

This bot manages Pokemon VGC draft leagues inside Discord channels. Each channel hosts its own independent league, and multiple leagues can run simultaneously across different channels in the same server.

---

## Step 1 — Create a Discord Application & Bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and sign in.
2. Click **New Application**, give it a name (e.g. `VGC Draft Bot`), and click **Create**.
3. In the left sidebar, click **Bot**.
4. Click **Add Bot** → **Yes, do it!**
5. Under **Token**, click **Reset Token**, then copy the token. **Save this securely — you won't see it again.**
6. Scroll down to **Privileged Gateway Intents** and make sure all are **off** (the bot only needs slash commands, no message intents).

---

## Step 2 — Get Your Client ID

1. In the left sidebar, click **OAuth2 → General**.
2. Copy the **Client ID** (also called Application ID).

---

## Step 3 — Set Your Secrets

In the Replit Secrets tab (the lock icon), add two secrets:

| Key | Value |
|---|---|
| `DISCORD_TOKEN` | The bot token from Step 1 |
| `DISCORD_CLIENT_ID` | The Client ID from Step 2 |

You also need a `DATABASE_URL` secret if one isn't already set (a PostgreSQL connection string).

---

## Step 4 — Push the Database Schema

Run this once to create the required tables:

```bash
pnpm --filter @workspace/db run push
```

---

## Step 5 — Deploy Slash Commands

This registers the bot's slash commands with Discord. Run it once, and again any time you add new commands:

```bash
pnpm --filter @workspace/api-server run deploy-commands
```

> Commands are registered globally and can take up to 1 hour to appear in all servers. For faster testing during development, see the note on guild-specific commands below.

---

## Step 6 — Invite the Bot to Your Server

1. Go back to the Developer Portal → **OAuth2 → URL Generator**.
2. Under **Scopes**, check: `bot` and `applications.commands`.
3. Under **Bot Permissions**, check: `Send Messages`, `Embed Links`, `Use Slash Commands`.
4. Copy the generated URL, open it in your browser, and invite the bot to your server.

---

## Step 7 — Create the Host Role

In your Discord server:
1. Go to **Server Settings → Roles → Create Role**.
2. Name it exactly `Host` (case-insensitive).
3. Assign this role to anyone who should be able to create or delete draft leagues.

Server Administrators can also create/delete leagues regardless of role.

---

## Step 8 — Start the Bot

The bot starts automatically alongside the API server. In Replit, simply run the **API Server** workflow. You should see a log message like:

```
Discord bot ready — VGC Draft Bot#1234
```

---

## Commands Reference

### `/league-create` — Host only
Creates a new draft league in the current channel.

| Option | Type | Required | Description |
|---|---|---|---|
| `league_name` | Text | Yes | Name of the league |
| `player_count` | Number | Yes | Number of players (2–16) |
| `player_budget` | Number | Yes | Starting budget per player |
| `max_picks` | Number | Yes | Maximum picks per player |
| `player1` … `player16` | User | player1–2 required | Players in Round 1 draft order |

**Example:**
```
/league-create league_name:Spring Cup player_count:8 player_budget:100 max_picks:10 player1:@Alice player2:@Bob player3:@Carol ...
```

---

### `/league-delete` — Host only
Deletes the active league in this channel. Pick history is preserved in the database.

---

### `/pick` — Current player only
Drafts a Pokemon on your turn.

| Option | Type | Required | Description |
|---|---|---|---|
| `round` | Number | Yes | The current round number |
| `pokemon` | Text | Yes | Name of the Pokemon |
| `cost` | Number | Yes | Cost of the Pokemon (must not exceed your remaining budget) |

**Example:**
```
/pick round:1 pokemon:Charizard cost:15
```

The bot will validate it's your turn, check the round number matches, verify you have enough budget, and then ping the next player automatically.

---

### `/view-draft` — Any player
Shows all drafted Pokemon, grouped by round. **Only visible to you.**

| Option | Type | Required | Description |
|---|---|---|---|
| `round` | Number | No | Specific round to view. Leave empty to see all rounds. |

**Output format:**
```
Round 1
PlayerName — Pokemon — Cost
...

Round 2
...
```

---

## Snake Draft Logic

- **Odd rounds** (1, 3, 5…): picks go in the original order (Player 1 → 2 → … → N)
- **Even rounds** (2, 4, 6…): picks go in reverse order (Player N → … → 2 → 1)

This means the last player in round 1 picks first in round 2, effectively picking twice in a row. Likewise, Player 1 picks last in round 2 and first in round 3 (picking back-to-back across rounds).

Players who exhaust their budget before reaching `max_picks` are automatically skipped for the rest of the draft.

---

## League Lifecycle

| State | Description |
|---|---|
| **Active** | Draft is in progress |
| **Ended** | All players have used their full budget or reached max picks |
| **Deleted** | Manually deleted by a host |

The bot automatically ends a league when no eligible picks remain.

---

## Development Notes

- The bot only requires the `Guilds` gateway intent — no privileged intents needed.
- Each channel can have at most **one active league** at a time.
- Multiple channels in the same server can each have their own active league simultaneously.
- To test guild-specific command registration (instant propagation), you can modify `deployCommands.ts` to use `Routes.applicationGuildCommands(clientId, guildId)` instead of `Routes.applicationCommands(clientId)`.
