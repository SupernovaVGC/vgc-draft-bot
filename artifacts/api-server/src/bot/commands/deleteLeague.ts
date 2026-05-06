import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  MessageFlags,
} from "discord.js";
import { db } from "@workspace/db";
import { leaguesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

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

export const deleteLeagueCommand = {
  data: new SlashCommandBuilder()
    .setName("league-delete")
    .setDescription("Delete the active draft league in this channel"),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!hasHostAccess(interaction)) {
      await interaction.reply({
        content:
          "You need the **Host** role (or Administrator permission) to delete a league.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const channelId = interaction.channelId;

    const [league] = await db
      .select()
      .from(leaguesTable)
      .where(and(eq(leaguesTable.channelId, channelId), eq(leaguesTable.status, "active")))
      .limit(1);

    if (!league) {
      await interaction.reply({
        content: "There is no active league in this channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await db
      .update(leaguesTable)
      .set({ status: "deleted" })
      .where(eq(leaguesTable.id, league.id));

    await interaction.reply({
      content: `🗑️ The draft league **${league.leagueName}** has been deleted.`,
    });
  },
};
