import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { db } from "@workspace/db";
import { leaguesTable, draftPlayersTable, queuedPicksTable } from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";

export const viewQueueCommand = {
  data: new SlashCommandBuilder()
    .setName("view-queue")
    .setDescription("See your currently queued picks (only visible to you)"),

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

    const [player] = await db
      .select()
      .from(draftPlayersTable)
      .where(
        and(
          eq(draftPlayersTable.leagueId, league.id),
          eq(draftPlayersTable.discordUserId, interaction.user.id),
        ),
      )
      .limit(1);

    if (!player) {
      await interaction.reply({
        content: "You are not in this draft league.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const queued = await db
      .select()
      .from(queuedPicksTable)
      .where(
        and(
          eq(queuedPicksTable.leagueId, league.id),
          eq(queuedPicksTable.playerId, player.id),
          eq(queuedPicksTable.status, "pending"),
        ),
      )
      .orderBy(asc(queuedPicksTable.priority));

    if (queued.length === 0) {
      await interaction.reply({
        content:
          "You have no queued picks. Use `/queue-pick` to add up to 5 picks that will be auto-drafted on your turn.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const lines = queued.map(
      (q) => `**Priority ${q.priority}:** ${q.pokemonName} — ${q.cost}pts`,
    );

    await interaction.reply({
      content: [
        `**Your queued picks for ${league.leagueName}:**`,
        ...lines,
        "",
        "The bot will try them in priority order when it's your turn. Sniped or unaffordable picks are skipped automatically.",
      ].join("\n"),
      flags: MessageFlags.Ephemeral,
    });
  },
};
