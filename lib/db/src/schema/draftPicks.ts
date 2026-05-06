import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { leaguesTable } from "./leagues";
import { draftPlayersTable } from "./draftPlayers";

export const draftPicksTable = pgTable("draft_picks", {
  id: serial("id").primaryKey(),
  leagueId: integer("league_id")
    .notNull()
    .references(() => leaguesTable.id),
  playerId: integer("player_id")
    .notNull()
    .references(() => draftPlayersTable.id),
  round: integer("round").notNull(),
  pokemonName: text("pokemon_name").notNull(),
  cost: integer("cost").notNull(),
  pickedAt: timestamp("picked_at").defaultNow().notNull(),
});

export const insertDraftPickSchema = createInsertSchema(draftPicksTable).omit({
  id: true,
  pickedAt: true,
});
export type InsertDraftPick = z.infer<typeof insertDraftPickSchema>;
export type DraftPick = typeof draftPicksTable.$inferSelect;
