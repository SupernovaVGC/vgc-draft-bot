import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { db } from "@workspace/db";
import { leaguesTable, draftPlayersTable, queuedPicksTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

export const clearQueueCommand = {
  data: new SlashCommandBuilder()
    .setName("queue-clear")
    .setDescription("Remove queued picks")
    .addIntegerOption((opt) =>
      opt
        .setName("priority")
        .setDescription("Remove only this priority slot (leave empty to clear all)")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(5),
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

    const priority = interaction.options.getInteger("priority");

    if (priority !== null) {
      const deleted = await db
        .delete(queuedPicksTable)
        .where(
          and(
            eq(queuedPicksTable.leagueId, league.id),
            eq(queuedPicksTable.playerId, player.id),
            eq(queuedPicksTable.priority, priority),
            eq(queuedPicksTable.status, "pending"),
          ),
        )
        .returning({ id: queuedPicksTable.id });

      if (deleted.length === 0) {
        await interaction.reply({
          content: `No pending queued pick found at priority **${priority}**.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.reply({
        content: `🗑️ Priority **${priority}** queued pick removed.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const deleted = await db
      .delete(queuedPicksTable)
      .where(
        and(
          eq(queuedPicksTable.leagueId, league.id),
          eq(queuedPicksTable.playerId, player.id),
          eq(queuedPicksTable.status, "pending"),
        ),
      )
      .returning({ id: queuedPicksTable.id });

    if (deleted.length === 0) {
      await interaction.reply({
        content: "You have no queued picks to clear.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      content: `🗑️ Cleared **${deleted.length}** queued pick(s).`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
