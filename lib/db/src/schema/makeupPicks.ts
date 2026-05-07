import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { leaguesTable } from "./leagues";
import { draftPlayersTable } from "./draftPlayers";

export const makeupPicksTable = pgTable("makeup_picks", {
  id: serial("id").primaryKey(),
  leagueId: integer("league_id")
    .notNull()
    .references(() => leaguesTable.id),
  playerId: integer("player_id")
    .notNull()
    .references(() => draftPlayersTable.id),
  originalRound: integer("original_round").notNull(),
  deadlineDraftPosition: integer("deadline_draft_position").notNull(),
  status: text("status").notNull().default("pending"), // pending | completed | forfeited
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMakeupPickSchema = createInsertSchema(makeupPicksTable).omit({
  id: true,
  createdAt: true,
});
export type InsertMakeupPick = z.infer<typeof insertMakeupPickSchema>;
export type MakeupPick = typeof makeupPicksTable.$inferSelect;
