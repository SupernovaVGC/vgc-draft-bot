import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { db } from "@workspace/db";
import { leaguesTable, draftPlayersTable, draftPicksTable } from "@workspace/db";
import { eq, and, desc, ne } from "drizzle-orm";

export const editPickCommand = {
  data: new SlashCommandBuilder()
    .setName("edit-pick")
    .setDescription("Edit your most recent pick — only while the next player hasn't picked yet")
    .addStringOption((opt) =>
      opt.setName("pokemon").setDescription("New Pokemon name").setRequired(true),
    )
    .addIntegerOption((opt) =>
      opt
        .setName("cost")
        .setDescription("New cost for this Pokemon")
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

    // Find this player's most recent pick
    const [myLastPick] = await db
      .select()
      .from(draftPicksTable)
      .where(
        and(
          eq(draftPicksTable.leagueId, league.id),
          eq(draftPicksTable.playerId, player.id),
        ),
      )
      .orderBy(desc(draftPicksTable.id))
      .limit(1);

    if (!myLastPick) {
      await interaction.reply({
        content: "You have no picks to edit.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Check if anyone has picked after us
    const [leagueLastPick] = await db
      .select()
      .from(draftPicksTable)
      .where(eq(draftPicksTable.leagueId, league.id))
      .orderBy(desc(draftPicksTable.id))
      .limit(1);

    if (!leagueLastPick || leagueLastPick.id !== myLastPick.id) {
      await interaction.reply({
        content:
          "You can no longer edit your pick — someone else has already picked after you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const pokemonName = interaction.options.getString("pokemon", true).trim();
    const cost = interaction.options.getInteger("cost", true);

    // Available budget = current remaining + old pick's cost (refunded)
    const availableBudget = player.budgetRemaining + myLastPick.cost;

    if (cost > availableBudget) {
      await interaction.reply({
        content: `Not enough budget. New cost **${cost}** exceeds available budget **${availableBudget}** (${player.budgetRemaining} remaining + ${myLastPick.cost} refunded from old pick).`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Check the new Pokemon isn't already taken (excluding the pick being replaced)
    if (pokemonName.toLowerCase() !== myLastPick.pokemonName.toLowerCase()) {
      const otherPicks = await db
        .select({ pokemonName: draftPicksTable.pokemonName })
        .from(draftPicksTable)
        .where(
          and(eq(draftPicksTable.leagueId, league.id), ne(draftPicksTable.id, myLastPick.id)),
        );

      const takenSet = new Set(otherPicks.map((p) => p.pokemonName.toLowerCase()));
      if (takenSet.has(pokemonName.toLowerCase())) {
        await interaction.reply({
          content: `**${pokemonName}** has already been drafted by someone else!`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    const newBudget = availableBudget - cost;
    const oldPokemon = myLastPick.pokemonName;
    const oldCost = myLastPick.cost;

    await db.transaction(async (tx) => {
      await tx
        .update(draftPicksTable)
        .set({ pokemonName, cost })
        .where(eq(draftPicksTable.id, myLastPick.id));
      await tx
        .update(draftPlayersTable)
        .set({ budgetRemaining: newBudget })
        .where(eq(draftPlayersTable.id, player.id));
    });

    await interaction.reply({
      content: [
        `✏️ Pick edited! **${oldPokemon}** (${oldCost}pts) → **${pokemonName}** (${cost}pts)`,
        `💰 Budget remaining: **${newBudget}**`,
      ].join("\n"),
    });
  },
};
