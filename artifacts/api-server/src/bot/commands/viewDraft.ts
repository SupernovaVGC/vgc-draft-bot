import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
  EmbedBuilder,
} from "discord.js";
import { db } from "@workspace/db";
import { leaguesTable, draftPlayersTable, draftPicksTable } from "@workspace/db";
import { eq, and, asc, or, desc } from "drizzle-orm";
import { getCurrentRound } from "../utils";

export const viewDraftCommand = {
  data: new SlashCommandBuilder()
    .setName("view-draft")
    .setDescription("View the current draft picks (only visible to you)")
    .addIntegerOption((opt) =>
      opt
        .setName("round")
        .setDescription("Specific round to view — leave empty to see all rounds")
        .setRequired(false)
        .setMinValue(1),
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const channelId = interaction.channelId;

    const [league] = await db
      .select()
      .from(leaguesTable)
      .where(
        and(
          eq(leaguesTable.channelId, channelId),
          or(eq(leaguesTable.status, "active"), eq(leaguesTable.status, "ended")),
        ),
      )
      .orderBy(desc(leaguesTable.id))
      .limit(1);

    if (!league) {
      await interaction.reply({
        content: "There is no active or completed league in this channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const players = await db
      .select()
      .from(draftPlayersTable)
      .where(eq(draftPlayersTable.leagueId, league.id))
      .orderBy(asc(draftPlayersTable.draftOrder));

    const allPicks = await db
      .select()
      .from(draftPicksTable)
      .where(eq(draftPicksTable.leagueId, league.id))
      .orderBy(asc(draftPicksTable.id));

    if (allPicks.length === 0) {
      await interaction.reply({
        content: `No picks have been made yet in **${league.leagueName}**.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const requestedRound = interaction.options.getInteger("round");
    const playerMap = new Map(players.map((p) => [p.id, p]));

    const picksByRound = new Map<number, typeof allPicks>();
    for (const pick of allPicks) {
      if (!picksByRound.has(pick.round)) picksByRound.set(pick.round, []);
      picksByRound.get(pick.round)!.push(pick);
    }

    const roundsToShow = requestedRound
      ? [requestedRound]
      : [...picksByRound.keys()].sort((a, b) => a - b);

    const currentRound = getCurrentRound(league.currentDraftPosition, league.playerCount);
    const statusText =
      league.status === "ended"
        ? "✅ Draft Complete"
        : `📍 Round ${currentRound} in progress`;

    const embed = new EmbedBuilder()
      .setTitle(`🏆 ${league.leagueName} — Draft Picks`)
      .setColor(0x5865f2)
      .setDescription(
        `${statusText}\nBudget per player: **${league.playerBudget}** | Max picks: **${league.maxPicks}**`,
      );

    let fieldsAdded = 0;
    for (const round of roundsToShow) {
      const picks = picksByRound.get(round);
      if (!picks || picks.length === 0) {
        embed.addFields({ name: `Round ${round}`, value: "*No picks yet*" });
        fieldsAdded++;
        continue;
      }

      const fieldLines = picks.map((pick) => {
        const player = playerMap.get(pick.playerId);
        const name = player?.playerName ?? "Unknown";
        return `**${name}** — ${pick.pokemonName} — ${pick.cost}`;
      });

      const fieldValue = fieldLines.join("\n").slice(0, 1020);
      embed.addFields({ name: `Round ${round}`, value: fieldValue });
      fieldsAdded++;
    }

    if (fieldsAdded === 0) {
      await interaction.reply({
        content: requestedRound
          ? `No picks found for Round ${requestedRound}.`
          : "No picks have been made yet.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
