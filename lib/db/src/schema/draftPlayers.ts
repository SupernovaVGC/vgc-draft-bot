import { pgTable, serial, text, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { leaguesTable } from "./leagues";

export const draftPlayersTable = pgTable("draft_players", {
  id: serial("id").primaryKey(),
  leagueId: integer("league_id")
    .notNull()
    .references(() => leaguesTable.id),
  playerName: text("player_name").notNull(),
  discordUserId: text("discord_user_id").notNull(),
  draftOrder: integer("draft_order").notNull(),
  budgetRemaining: integer("budget_remaining").notNull(),
  picksCount: integer("picks_count").notNull().default(0),
});

export const insertDraftPlayerSchema = createInsertSchema(draftPlayersTable).omit({ id: true });
export type InsertDraftPlayer = z.infer<typeof insertDraftPlayerSchema>;
export type DraftPlayer = typeof draftPlayersTable.$inferSelect;
