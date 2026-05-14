import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  MessageFlags,
} from "discord.js";
import { db } from "@workspace/db";
import { leaguesTable, draftPlayersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { advanceTurn } from "../draftEngine";

const builder = new SlashCommandBuilder()
  .setName("league-create")
  .setDescription("Create a new VGC Pokemon draft league in this channel")
  .addStringOption((opt) =>
    opt.setName("league_name").setDescription("Name of the league").setRequired(true),
  )
  .addIntegerOption((opt) =>
    opt
      .setName("player_count")
      .setDescription("Number of players (2–16)")
      .setRequired(true)
      .setMinValue(2)
      .setMaxValue(16),
  )
  .addIntegerOption((opt) =>
    opt
      .setName("player_budget")
      .setDescription("Starting budget for each player")
      .setRequired(true)
      .setMinValue(1),
  )
  .addIntegerOption((opt) =>
    opt
      .setName("max_picks")
      .setDescription("Maximum number of Pokemon picks per player")
      .setRequired(true)
      .setMinValue(1),
  )
  .addUserOption((opt) =>
    opt.setName("player1").setDescription("Player 1 in draft order").setRequired(true),
  )
  .addUserOption((opt) =>
    opt.setName("player2").setDescription("Player 2 in draft order").setRequired(true),
  )
  .addIntegerOption((opt) =>
    opt
      .setName("timer")
      .setDescription(
        "Seconds per turn (0 = no timer). Missed turns create makeup picks; misses halve the timer.",
      )
      .setRequired(false)
      .setMinValue(0),
  )
  .addUserOption((opt) =>
    opt.setName("player3").setDescription("Player 3 in draft order").setRequired(false),
  )
  .addUserOption((opt) =>
    opt.setName("player4").setDescription("Player 4 in draft order").setRequired(false),
  )
  .addUserOption((opt) =>
    opt.setName("player5").setDescription("Player 5 in draft order").setRequired(false),
  )
  .addUserOption((opt) =>
    opt.setName("player6").setDescription("Player 6 in draft order").setRequired(false),
  )
  .addUserOption((opt) =>
    opt.setName("player7").setDescription("Player 7 in draft order").setRequired(false),
  )
  .addUserOption((opt) =>
    opt.setName("player8").setDescription("Player 8 in draft order").setRequired(false),
  )
  .addUserOption((opt) =>
    opt.setName("player9").setDescription("Player 9 in draft order").setRequired(false),
  )
  .addUserOption((opt) =>
    opt.setName("player10").setDescription("Player 10 in draft order").setRequired(false),
  )
  .addUserOption((opt) =>
    opt.setName("player11").setDescription("Player 11 in draft order").setRequired(false),
  )
  .addUserOption((opt) =>
    opt.setName("player12").setDescription("Player 12 in draft order").setRequired(false),
  )
  .addUserOption((opt) =>
    opt.setName("player13").setDescription("Player 13 in draft order").setRequired(false),
  )
  .addUserOption((opt) =>
    opt.setName("player14").setDescription("Player 14 in draft order").setRequired(false),
  )
  .addUserOption((opt) =>
    opt.setName("player15").setDescription("Player 15 in draft order").setRequired(false),
  )
  .addUserOption((opt) =>
    opt.setName("player16").setDescription("Player 16 in draft order").setRequired(false),
  );

function hasHostAccess(interaction: ChatInputCommandInteraction): boolean {
  const member = interaction.member;
  if (!member) return false;

  const isAdmin =
    "permissions" in member &&
    (member.permissions as any)?.has?.(PermissionFlagsBits.Administrator);

  const hasHostRole =
    "roles" in member &&
    member.roles &&
    typeof member.roles === "object" &&
    "cache" in member.roles &&
    (member.roles as any).cache?.some((r: any) => r.name?.toLowerCase() === "host");

  return Boolean(isAdmin || hasHostRole);
}

export const createLeagueCommand = {
  data: builder,
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!hasHostAccess(interaction)) {
      await interaction.reply({
        content: "You need the **Host** role (or Administrator permission) to create a league.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const leagueName = interaction.options.getString("league_name", true);
    const playerCount = interaction.options.getInteger("player_count", true);
    const playerBudget = interaction.options.getInteger("player_budget", true);
    const maxPicks = interaction.options.getInteger("max_picks", true);
    const turnTimerSeconds = interaction.options.getInteger("timer") ?? 0;

    const players: { id: string; username: string }[] = [];
    for (let i = 1; i <= 16; i++) {
      const user = interaction.options.getUser(`player${i}`);
      if (user) {
        if (user.bot) {
          await interaction.reply({
            content: `Player ${i} is a bot account. Please only add real players.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        players.push({ id: user.id, username: user.displayName ?? user.username });
      }
    }

    if (players.length !== playerCount) {
      await interaction.reply({
        content: `You specified **${playerCount} players** but provided **${players.length}** Discord users. Please supply exactly ${playerCount} players.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const channelId = interaction.channelId;
    const guildId = interaction.guildId!;

    const existing = await db
      .select()
      .from(leaguesTable)
      .where(and(eq(leaguesTable.channelId, channelId), eq(leaguesTable.status, "active")))
      .limit(1);

    if (existing.length > 0) {
      await interaction.reply({
        content: `There is already an active league **${existing[0].leagueName}** in this channel. Use \`/league-delete\` to remove it first.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferReply();
    const [league] = await db
      .insert(leaguesTable)
      .values({
        guildId,
        channelId,
        leagueName,
        playerCount,
        playerBudget,
        maxPicks,
        turnTimerSeconds,
        currentDraftPosition: 0,
        status: "active",
      })
      .returning();

    for (let i = 0; i < players.length; i++) {
      await db.insert(draftPlayersTable).values({
        leagueId: league.id,
        playerName: players[i].username,
        discordUserId: players[i].id,
        draftOrder: i,
        budgetRemaining: playerBudget,
        picksCount: 0,
        timerHalvingCount: 0,
      });
    }

    const orderLines = players.map((p, i) => `**${i + 1}.** <@${p.id}>`).join("\n");
    const reversedLines = [...players]
      .reverse()
      .map((p, i) => `**${i + 1}.** <@${p.id}>`)
      .join("\n");

    const timerLine =
      turnTimerSeconds > 0
        ? `⏱️ **Turn timer:** ${turnTimerSeconds}s (missed turns create makeup picks; missed makeups halve the timer)`
        : "⏱️ **Turn timer:** None";

    await interaction.editReply({
      content: [
        `## 🏆 ${leagueName}`,
        `**Budget:** ${playerBudget} per player  |  **Max Picks:** ${maxPicks}  |  **Players:** ${playerCount}`,
        timerLine,
        "",
        "**Round 1 Draft Order:**",
        orderLines,
        "",
        "**Round 2 Draft Order (reversed — snake draft):**",
        reversedLines,
        "",
        `*Round 3 returns to Round 1 order, and so on.*`,
        "",
        "Starting the draft now...",
      ].join("\n"),
    });

    await advanceTurn(league.id, interaction.client);
  },
};
