import { Client, GatewayIntentBits, Events } from "discord.js";
import { logger } from "../lib/logger";
import { createLeagueCommand } from "./commands/createLeague";
import { deleteLeagueCommand } from "./commands/deleteLeague";
import { pickCommand } from "./commands/pick";
import { viewDraftCommand } from "./commands/viewDraft";

const commandMap = new Map([
  [createLeagueCommand.data.name, createLeagueCommand],
  [deleteLeagueCommand.data.name, deleteLeagueCommand],
  [pickCommand.data.name, pickCommand],
  [viewDraftCommand.data.name, viewDraftCommand],
]);

export function startBot(): void {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error("DISCORD_TOKEN is required");

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once(Events.ClientReady, (c) => {
    logger.info({ tag: c.user.tag }, "Discord bot ready");
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const command = commandMap.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (error) {
      logger.error({ error, command: interaction.commandName }, "Command execution error");
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: "An error occurred while running this command.", ephemeral: true }).catch(() => {});
      } else {
        await interaction.reply({ content: "An error occurred while running this command.", ephemeral: true }).catch(() => {});
      }
    }
  });

  client.login(token).catch((err) => {
    logger.error({ err }, "Failed to login to Discord");
    process.exit(1);
  });
}
