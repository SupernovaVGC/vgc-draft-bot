import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { db } from "@workspace/db";
import {
  leaguesTable,
  draftPlayersTable,
  draftPicksTable,
  makeupPicksTable,
} from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";

export const makeupPickCommand = {
  data: new SlashCommandBuilder()
    .setName("makeup-pick")
    .setDescription("Make a makeup pick for a turn you were skipped on")
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

    // Get the oldest pending makeup pick
    const [makeupPick] = await db
      .select()
      .from(makeupPicksTable)
      .where(
        and(
          eq(makeupPicksTable.leagueId, league.id),
          eq(makeupPicksTable.playerId, player.id),
          eq(makeupPicksTable.status, "pending"),
        ),
      )
      .orderBy(asc(makeupPicksTable.id))
      .limit(1);

    if (!makeupPick) {
      await interaction.reply({
        content: "You have no pending makeup picks.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Check if deadline has already passed
    if (makeupPick.deadlineDraftPosition <= league.currentDraftPosition) {
      await db
        .update(makeupPicksTable)
        .set({ status: "forfeited" })
        .where(eq(makeupPicksTable.id, makeupPick.id));

      await interaction.reply({
        content:
          "Your makeup pick deadline has already passed — it has been forfeited and your timer has been halved.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const pokemonName = interaction.options.getString("pokemon", true).trim();
    const cost = interaction.options.getInteger("cost", true);

    if (cost > player.budgetRemaining) {
      await interaction.reply({
        content: `Not enough budget! **${pokemonName}** costs **${cost}** but you only have **${player.budgetRemaining}** remaining.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Check if the Pokemon is already taken
    const allPicks = await db
      .select({ pokemonName: draftPicksTable.pokemonName })
      .from(draftPicksTable)
      .where(eq(draftPicksTable.leagueId, league.id));

    const pickedSet = new Set(allPicks.map((p) => p.pokemonName.toLowerCase()));

    if (pickedSet.has(pokemonName.toLowerCase())) {
      await interaction.reply({
        content: `**${pokemonName}** has already been drafted! Choose a different Pokemon.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const newBudget = player.budgetRemaining - cost;

    await db.transaction(async (tx) => {
      await tx.insert(draftPicksTable).values({
        leagueId: league.id,
        playerId: player.id,
        round: makeupPick.originalRound,
        pokemonName,
        cost,
      });
      await tx
        .update(draftPlayersTable)
        .set({ budgetRemaining: newBudget, picksCount: player.picksCount + 1 })
        .where(eq(draftPlayersTable.id, player.id));
      await tx
        .update(makeupPicksTable)
        .set({ status: "completed" })
        .where(eq(makeupPicksTable.id, makeupPick.id));
    });

    await interaction.reply({
      content: [
        `📝 **Makeup pick recorded!** <@${interaction.user.id}> drafted **${pokemonName}** for Round **${makeupPick.originalRound}**.`,
        `💰 Cost: **${cost}** | Budget remaining: **${newBudget}** | Picks: **${player.picksCount + 1}/${league.maxPicks}**`,
      ].join("\n"),
    });
  },
};
