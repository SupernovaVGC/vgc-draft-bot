import { Client, GatewayIntentBits, Events } from "discord.js";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "../lib/logger";
import { restoreTimers } from "./draftEngine";
import { createLeagueCommand } from "./commands/createLeague";
import { deleteLeagueCommand } from "./commands/deleteLeague";
import { pickCommand } from "./commands/pick";
import { viewDraftCommand } from "./commands/viewDraft";
import { queuePickCommand } from "./commands/queuePick";
import { viewQueueCommand } from "./commands/viewQueue";
import { clearQueueCommand } from "./commands/clearQueue";
import { makeupPickCommand } from "./commands/makeupPick";
import { editPickCommand } from "./commands/editPick";

const commandMap = new Map([
  [createLeagueCommand.data.name, createLeagueCommand],
  [deleteLeagueCommand.data.name, deleteLeagueCommand],
  [pickCommand.data.name, pickCommand],
  [viewDraftCommand.data.name, viewDraftCommand],
  [queuePickCommand.data.name, queuePickCommand],
  [viewQueueCommand.data.name, viewQueueCommand],
  [clearQueueCommand.data.name, clearQueueCommand],
  [makeupPickCommand.data.name, makeupPickCommand],
  [editPickCommand.data.name, editPickCommand],
]);

export function startBot(): void {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error("DISCORD_TOKEN is required");

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once(Events.ClientReady, (c) => {
    logger.info({ tag: c.user.tag }, "Discord bot ready");
  });
    // Warm the DB connection first (Neon free tier cold-starts on first query),
    // then restore timers and start the keepalive ping.
    db.execute(sql`SELECT 1`)
      .then(() => restoreTimers(c))
      .catch((err) => logger.error({ err }, "Failed to restore timers"))
      .finally(() => {
        // Keep the connection warm every 4 minutes so Neon never suspends
        // while the bot is running (free tier suspends after 5 min idle).
        setInterval(() => {
          db.execute(sql`SELECT 1`).catch((err) =>
            logger.warn({ err }, "DB keepalive ping failed"),
          );
        }, 4 * 60 * 1000);
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
        await interaction
          .followUp({ content: "An error occurred while running this command.", ephemeral: true })
          .catch(() => {});
      } else {
        await interaction
          .reply({ content: "An error occurred while running this command.", ephemeral: true })
          .catch(() => {});
      }
    }
  });

  client.login(token).catch((err) => {
    logger.error({ err }, "Failed to login to Discord");
    process.exit(1);
  });
}
