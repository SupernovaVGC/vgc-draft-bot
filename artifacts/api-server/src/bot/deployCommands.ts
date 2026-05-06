import { REST, Routes } from "discord.js";
import { createLeagueCommand } from "./commands/createLeague";
import { deleteLeagueCommand } from "./commands/deleteLeague";
import { pickCommand } from "./commands/pick";
import { viewDraftCommand } from "./commands/viewDraft";

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

if (!token || !clientId) {
  console.error("Both DISCORD_TOKEN and DISCORD_CLIENT_ID must be set.");
  process.exit(1);
}

const commands = [
  createLeagueCommand.data.toJSON(),
  deleteLeagueCommand.data.toJSON(),
  pickCommand.data.toJSON(),
  viewDraftCommand.data.toJSON(),
];

const rest = new REST().setToken(token);

async function main() {
  try {
    console.log(`Deploying ${commands.length} slash commands globally...`);
    await rest.put(Routes.applicationCommands(clientId!), { body: commands });
    console.log("Slash commands deployed successfully!");
  } catch (err) {
    console.error("Failed to deploy slash commands:", err);
    process.exit(1);
  }
}

main();
