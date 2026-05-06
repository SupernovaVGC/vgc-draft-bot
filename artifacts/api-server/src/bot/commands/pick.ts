import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { db } from "@workspace/db";
import { leaguesTable, draftPlayersTable, draftPicksTable } from "@workspace/db";
import type { DraftPlayer } from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";
import { getPlayerAtPosition, getCurrentRound, findNextEligiblePosition } from "../utils";

export const pickCommand = {
  data: new SlashCommandBuilder()
    .setName("pick")
    .setDescription("Draft a Pokemon on your turn")
    .addIntegerOption((opt) =>
      opt
        .setName("round")
        .setDescription("The current round number")
        .setRequired(true)
        .setMinValue(1),
    )
    .addStringOption((opt) =>
      opt.setName("pokemon").setDescription("Name of the Pokemon to draft").setRequired(true),
    )
    .addIntegerOption((opt) =>
      opt
        .setName("cost")
        .setDescription("Cost of this Pokemon")
        .setRequired(true)
        .setMinValue(0),
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const channelId = interaction.channelId;

    const [league] = await db
      .select()
      .from(leaguesTable)
      .where(and(eq(leaguesTable.channelId, channelId), eq(leaguesTable.status, "active")))
      .limit(1);

    if (!league) {
      await interaction.reply({
        content: "There is no active draft league in this channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

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

    if (!currentPlayer) {
      await interaction.reply({
        content: "Unable to determine whose turn it is. The draft may be in an invalid state.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.user.id !== currentPlayer.discordUserId) {
      const currentRound = getCurrentRound(league.currentDraftPosition, league.playerCount);
      await interaction.reply({
        content: `It's not your turn! It's <@${currentPlayer.discordUserId}>'s turn (Round ${currentRound}).`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const inputRound = interaction.options.getInteger("round", true);
    const pokemonName = interaction.options.getString("pokemon", true).trim();
    const cost = interaction.options.getInteger("cost", true);
    const currentRound = getCurrentRound(league.currentDraftPosition, league.playerCount);

    if (inputRound !== currentRound) {
      await interaction.reply({
        content: `Incorrect round. You are currently picking in **Round ${currentRound}**, not Round ${inputRound}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (cost > currentPlayer.budgetRemaining) {
      await interaction.reply({
        content: `Not enough budget! **${pokemonName}** costs **${cost}** but you only have **${currentPlayer.budgetRemaining}** remaining.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (currentPlayer.picksCount >= league.maxPicks) {
      await interaction.reply({
        content: `You have already reached the maximum of ${league.maxPicks} picks.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const updatedPlayer: DraftPlayer = {
      ...currentPlayer,
      budgetRemaining: currentPlayer.budgetRemaining - cost,
      picksCount: currentPlayer.picksCount + 1,
    };
    const updatedPlayers = players.map((p) =>
      p.id === currentPlayer.id ? updatedPlayer : p,
    );

    const next = findNextEligiblePosition(
      updatedPlayers,
      league.currentDraftPosition + 1,
      league.playerCount,
      league.maxPicks,
    );

    await db.transaction(async (tx) => {
      await tx.insert(draftPicksTable).values({
        leagueId: league.id,
        playerId: currentPlayer.id,
        round: currentRound,
        pokemonName,
        cost,
      });

      await tx
        .update(draftPlayersTable)
        .set({
          budgetRemaining: updatedPlayer.budgetRemaining,
          picksCount: updatedPlayer.picksCount,
        })
        .where(eq(draftPlayersTable.id, currentPlayer.id));

      if (next !== null) {
        await tx
          .update(leaguesTable)
          .set({ currentDraftPosition: next.position })
          .where(eq(leaguesTable.id, league.id));
      } else {
        await tx
          .update(leaguesTable)
          .set({ status: "ended" })
          .where(eq(leaguesTable.id, league.id));
      }
    });

    const lines: string[] = [
      `✅ **${pokemonName}** drafted by <@${currentPlayer.discordUserId}>!`,
      `💰 Cost: **${cost}** | Budget remaining: **${updatedPlayer.budgetRemaining}** | Picks: **${updatedPlayer.picksCount}/${league.maxPicks}**`,
      `📍 Round **${currentRound}**`,
    ];

    if (next !== null) {
      const nextRound = getCurrentRound(next.position, league.playerCount);
      if (nextRound > currentRound) {
        lines.push("");
        lines.push(`🔄 **Round ${nextRound} begins!**`);
      }
      lines.push("");
      lines.push(
        `➡️ <@${next.player.discordUserId}> it's your turn! Use \`/pick round:${nextRound} pokemon:<name> cost:<amount>\``,
      );
    } else {
      lines.push("");
      lines.push(
        "🏆 **The draft is complete!** All players have finished picking. Use `/view-draft` to see the full results.",
      );
    }

    await interaction.reply({ content: lines.join("\n") });
  },
};
