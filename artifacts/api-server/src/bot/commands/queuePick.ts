import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { db } from "@workspace/db";
import { leaguesTable, draftPlayersTable, queuedPicksTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

export const queuePickCommand = {
  data: new SlashCommandBuilder()
    .setName("queue-pick")
    .setDescription("Leave a pick in your queue to be auto-drafted when it's your turn")
    .addIntegerOption((opt) =>
      opt
        .setName("priority")
        .setDescription("Priority slot 1–5 (1 = first choice, 5 = last resort)")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(5),
    )
    .addStringOption((opt) =>
      opt.setName("pokemon").setDescription("Pokemon name to draft").setRequired(true),
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

    if (player.picksCount >= league.maxPicks) {
      await interaction.reply({
        content: "You have already reached your maximum number of picks.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const priority = interaction.options.getInteger("priority", true);
    const pokemonName = interaction.options.getString("pokemon", true).trim();
    const cost = interaction.options.getInteger("cost", true);

    if (cost > player.budgetRemaining) {
      await interaction.reply({
        content: `Cost **${cost}** exceeds your current budget of **${player.budgetRemaining}**.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Check if a pending pick already exists at this priority slot
    const [existing] = await db
      .select()
      .from(queuedPicksTable)
      .where(
        and(
          eq(queuedPicksTable.leagueId, league.id),
          eq(queuedPicksTable.playerId, player.id),
          eq(queuedPicksTable.priority, priority),
          eq(queuedPicksTable.status, "pending"),
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .update(queuedPicksTable)
        .set({ pokemonName, cost })
        .where(eq(queuedPicksTable.id, existing.id));

      await interaction.reply({
        content: `✅ Priority **${priority}** updated: **${pokemonName}** (${cost}pts)`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Count total pending picks
    const pending = await db
      .select({ id: queuedPicksTable.id })
      .from(queuedPicksTable)
      .where(
        and(
          eq(queuedPicksTable.leagueId, league.id),
          eq(queuedPicksTable.playerId, player.id),
          eq(queuedPicksTable.status, "pending"),
        ),
      );

    if (pending.length >= 5) {
      await interaction.reply({
        content:
          "You already have 5 queued picks. Use `/queue-clear` to remove one before adding more.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await db.insert(queuedPicksTable).values({
      leagueId: league.id,
      playerId: player.id,
      priority,
      pokemonName,
      cost,
      status: "pending",
    });

    await interaction.reply({
      content: `✅ Priority **${priority}** queued: **${pokemonName}** (${cost}pts)\nThe bot will auto-draft this when it's your turn (if it hasn't been taken).`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
