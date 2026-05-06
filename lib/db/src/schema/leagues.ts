import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const leaguesTable = pgTable("leagues", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  channelId: text("channel_id").notNull(),
  leagueName: text("league_name").notNull(),
  playerCount: integer("player_count").notNull(),
  playerBudget: integer("player_budget").notNull(),
  maxPicks: integer("max_picks").notNull(),
  currentDraftPosition: integer("current_draft_position").notNull().default(0),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertLeagueSchema = createInsertSchema(leaguesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertLeague = z.infer<typeof insertLeagueSchema>;
export type League = typeof leaguesTable.$inferSelect;
