import type { Client } from "discord.js";
import { db } from "@workspace/db";
import {
  leaguesTable,
  draftPlayersTable,
  draftPicksTable,
  makeupPicksTable,
  queuedPicksTable,
} from "@workspace/db";
import type { League, DraftPlayer } from "@workspace/db";
import { eq, and, asc, lte, sql } from "drizzle-orm";
import {
  getPlayerAtPosition,
  getCurrentRound,
  findNextEligiblePosition,
  findPlayerNextPosition,
} from "./utils";
import { timerManager } from "./timerManager";

export async function sendToChannel(
  client: Client,
  channelId: string,
  content: string,
): Promise<void> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel && "send" in channel && typeof (channel as any).send === "function") {
      await (channel as any).send(content);
    }
  } catch (err) {
    console.error("Failed to send channel message", { err, channelId });
  }
}

function effectiveTimerMs(league: League, player: DraftPlayer): number {
  return Math.floor(
    league.turnTimerSeconds * Math.pow(0.5, player.timerHalvingCount) * 1000,
  );
}

async function processForfeitedMakeups(
  leagueId: number,
  currentPosition: number,
): Promise<void> {
  const forfeited = await db
    .select()
    .from(makeupPicksTable)
    .where(
      and(
        eq(makeupPicksTable.leagueId, leagueId),
        eq(makeupPicksTable.status, "pending"),
        lte(makeupPicksTable.deadlineDraftPosition, currentPosition),
      ),
    );

  for (const mp of forfeited) {
    await db
      .update(makeupPicksTable)
      .set({ status: "forfeited" })
      .where(eq(makeupPicksTable.id, mp.id));
    await db
      .update(draftPlayersTable)
      .set({ timerHalvingCount: sql`${draftPlayersTable.timerHalvingCount} + 1` })
      .where(eq(draftPlayersTable.id, mp.playerId));
  }
}

/** Skips the player at the current draft position, creates a makeup pick, and advances the league. */
async function skipPlayer(
  league: League,
  players: DraftPlayer[],
  player: DraftPlayer,
  client: Client,
  reason: string,
): Promise<boolean> {
  const round = getCurrentRound(league.currentDraftPosition, league.playerCount);
  const next = findNextEligiblePosition(
    players,
    league.currentDraftPosition + 1,
    league.playerCount,
    league.maxPicks,
  );
  const nextPlayerPos = findPlayerNextPosition(
    players,
    player.id,
    league.currentDraftPosition + 1,
    league.playerCount,
    league.maxPicks,
  );

  await db.transaction(async (tx) => {
    if (nextPlayerPos !== null) {
      await tx.insert(makeupPicksTable).values({
        leagueId: league.id,
        playerId: player.id,
        originalRound: round,
        deadlineDraftPosition: nextPlayerPos,
        status: "pending",
      });
    }
    if (next !== null) {
      await tx
        .update(leaguesTable)
        .set({ currentDraftPosition: next.position, turnStartedAt: null })
        .where(eq(leaguesTable.id, league.id));
    } else {
      await tx
        .update(leaguesTable)
        .set({ status: "ended", turnStartedAt: null })
        .where(eq(leaguesTable.id, league.id));
    }
  });

  const makeupText =
    nextPlayerPos !== null
      ? `\n📝 Use \`/makeup-pick\` before your next turn to make up this pick.`
      : "";

  await sendToChannel(
    client,
    league.channelId,
    `⏭️ <@${player.discordUserId}> has been skipped (Round **${round}**) — ${reason}.${makeupText}`,
  );

  if (next === null) {
    await sendToChannel(
      client,
      league.channelId,
      "🏆 **The draft is complete!** Use `/view-draft` to see the final results.",
    );
    return false;
  }
  return true;
}

/**
 * Core turn loop — call this after any pick, skip, or league creation to
 * advance to the next human turn. Handles auto-queue picks and auto-skips
 * in a loop so cascading events (e.g. multiple queued picks) are resolved
 * before surfacing to the user.
 */
export async function advanceTurn(leagueId: number, client: Client): Promise<void> {
  const MAX_ITERATIONS = 200;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const [league] = await db
      .select()
      .from(leaguesTable)
      .where(eq(leaguesTable.id, leagueId))
      .limit(1);

    if (!league || league.status !== "active") return;

    const players = await db
      .select()
      .from(draftPlayersTable)
      .where(eq(draftPlayersTable.leagueId, leagueId))
      .orderBy(asc(draftPlayersTable.draftOrder));

    await processForfeitedMakeups(leagueId, league.currentDraftPosition);

    const currentPlayer = getPlayerAtPosition(
      players,
      league.currentDraftPosition,
      league.playerCount,
    );

    if (!currentPlayer) {
      await db
        .update(leaguesTable)
        .set({ status: "ended" })
        .where(eq(leaguesTable.id, leagueId));
      await sendToChannel(
        client,
        league.channelId,
        "🏆 **The draft is complete!** Use `/view-draft` to see the final results.",
      );
      return;
    }

    // Check this player's queued picks
    const queued = await db
      .select()
      .from(queuedPicksTable)
      .where(
        and(
          eq(queuedPicksTable.leagueId, leagueId),
          eq(queuedPicksTable.playerId, currentPlayer.id),
          eq(queuedPicksTable.status, "pending"),
        ),
      )
      .orderBy(asc(queuedPicksTable.priority));

    if (queued.length > 0) {
      const existing = await db
        .select({ pokemonName: draftPicksTable.pokemonName })
        .from(draftPicksTable)
        .where(eq(draftPicksTable.leagueId, leagueId));
      const pickedSet = new Set(existing.map((p) => p.pokemonName.toLowerCase()));

      let autoPicked = false;

      for (const q of queued) {
        if (pickedSet.has(q.pokemonName.toLowerCase())) {
          await db
            .update(queuedPicksTable)
            .set({ status: "sniped" })
            .where(eq(queuedPicksTable.id, q.id));
          continue;
        }
        if (q.cost > currentPlayer.budgetRemaining) {
          await db
            .update(queuedPicksTable)
            .set({ status: "cancelled" })
            .where(eq(queuedPicksTable.id, q.id));
          continue;
        }

        const round = getCurrentRound(league.currentDraftPosition, league.playerCount);
        const newBudget = currentPlayer.budgetRemaining - q.cost;
        const newPicksCount = currentPlayer.picksCount + 1;
        const updatedPlayers = players.map((p) =>
          p.id === currentPlayer.id
            ? { ...currentPlayer, budgetRemaining: newBudget, picksCount: newPicksCount }
            : p,
        );
        const next = findNextEligiblePosition(
          updatedPlayers,
          league.currentDraftPosition + 1,
          league.playerCount,
          league.maxPicks,
        );

        await db.transaction(async (tx) => {
          await tx
            .update(queuedPicksTable)
            .set({ status: "used" })
            .where(eq(queuedPicksTable.id, q.id));
          await tx.insert(draftPicksTable).values({
            leagueId: league.id,
            playerId: currentPlayer.id,
            round,
            pokemonName: q.pokemonName,
            cost: q.cost,
          });
          await tx
            .update(draftPlayersTable)
            .set({ budgetRemaining: newBudget, picksCount: newPicksCount })
            .where(eq(draftPlayersTable.id, currentPlayer.id));
          if (next !== null) {
            await tx
              .update(leaguesTable)
              .set({ currentDraftPosition: next.position, turnStartedAt: null })
              .where(eq(leaguesTable.id, league.id));
          } else {
            await tx
              .update(leaguesTable)
              .set({ status: "ended", turnStartedAt: null })
              .where(eq(leaguesTable.id, league.id));
          }
        });

        await sendToChannel(
          client,
          league.channelId,
          [
            `🤖 **Auto-pick:** **${q.pokemonName}** drafted by <@${currentPlayer.discordUserId}> from their queue!`,
            `💰 Cost: **${q.cost}** | Budget remaining: **${newBudget}** | Picks: **${newPicksCount}/${league.maxPicks}**`,
            `📍 Round **${round}**`,
          ].join("\n"),
        );

        if (next === null) {
          await sendToChannel(
            client,
            league.channelId,
            "🏆 **The draft is complete!** Use `/view-draft` to see the final results.",
          );
          return;
        }

        autoPicked = true;
        break;
      }

      if (!autoPicked) {
        const continues = await skipPlayer(
          league,
          players,
          currentPlayer,
          client,
          "all queued picks were sniped or unaffordable",
        );
        if (!continues) return;
      }
      continue;
    }

    // No queued picks — human turn
    const round = getCurrentRound(league.currentDraftPosition, league.playerCount);

    let timerText = "";
    if (league.turnTimerSeconds > 0) {
      const timerMs = effectiveTimerMs(league, currentPlayer);
      const timerSecs = Math.floor(timerMs / 1000);
      timerText = ` ⏱️ **${timerSecs}s** to pick.`;

      await db
        .update(leaguesTable)
        .set({ turnStartedAt: new Date() })
        .where(eq(leaguesTable.id, league.id));

      timerManager.set(league.id, timerMs, () => {
        autoSkip(leagueId, currentPlayer.id, client).catch((err) =>
          console.error("autoSkip error", err),
        );
      });
    }

    const pendingMakeups = await db
      .select({ id: makeupPicksTable.id })
      .from(makeupPicksTable)
      .where(
        and(
          eq(makeupPicksTable.leagueId, leagueId),
          eq(makeupPicksTable.playerId, currentPlayer.id),
          eq(makeupPicksTable.status, "pending"),
        ),
      );

    const makeupReminder =
      pendingMakeups.length > 0
        ? `\n⚠️ **${pendingMakeups.length}** pending makeup pick(s) — use \`/makeup-pick\` before your next turn.`
        : "";

    await sendToChannel(
      client,
      league.channelId,
      `➡️ <@${currentPlayer.discordUserId}> it's your turn (Round **${round}**)!${timerText}${makeupReminder}\nUse \`/pick round:${round} pokemon:<name> cost:<amount>\``,
    );
    return;
  }

  console.error("advanceTurn exceeded max iterations", { leagueId });
}

export async function autoSkip(
  leagueId: number,
  playerId: number,
  client: Client,
): Promise<void> {
  const [league] = await db
    .select()
    .from(leaguesTable)
    .where(eq(leaguesTable.id, leagueId))
    .limit(1);

  if (!league || league.status !== "active") return;

  const players = await db
    .select()
    .from(draftPlayersTable)
    .where(eq(draftPlayersTable.leagueId, leagueId))
    .orderBy(asc(draftPlayersTable.draftOrder));

  const currentPlayer = getPlayerAtPosition(
    players,
    league.currentDraftPosition,
    league.playerCount,
  );

  if (!currentPlayer || currentPlayer.id !== playerId) return;

  const continues = await skipPlayer(
    league,
    players,
    currentPlayer,
    client,
    "time ran out ⏱️",
  );

  if (continues) {
    await advanceTurn(leagueId, client);
  }
}

/** Called on bot startup to restore timers for all active leagues. */
export async function restoreTimers(client: Client): Promise<void> {
  const activeLeagues = await db
    .select()
    .from(leaguesTable)
    .where(eq(leaguesTable.status, "active"));

  for (const league of activeLeagues) {
    try {
      if (league.turnTimerSeconds === 0 || !league.turnStartedAt) continue;

      const players = await db
        .select()
        .from(draftPlayersTable)
        .where(eq(draftPlayersTable.leagueId, league.id))
        .orderBy(asc(draftPlayersTable.draftOrder));

      const currentPlayer = getPlayerAtPosition(
        players,
        league.currentDraftPosition,
        league.playerCount,
      );
      if (!currentPlayer) continue;

      // Drizzle may return timestamps as strings depending on driver version —
      // normalise to Date before calling .getTime().
      const turnStartedAt =
        league.turnStartedAt instanceof Date
          ? league.turnStartedAt
          : new Date(league.turnStartedAt as unknown as string);

      const elapsed = Date.now() - turnStartedAt.getTime();
      const timerMs = effectiveTimerMs(league, currentPlayer);
      const remaining = timerMs - elapsed;

      if (remaining <= 0) {
        autoSkip(league.id, currentPlayer.id, client).catch((err) =>
          console.error("restoreTimers autoSkip error", err),
        );
      } else {
        timerManager.set(league.id, remaining, () => {
          autoSkip(league.id, currentPlayer.id, client).catch((err) =>
            console.error("restored timer autoSkip error", err),
          );
        });
      }
    } catch (err) {
      console.error(`restoreTimers: failed for league ${league.id}`, err);
    }
  }
}
