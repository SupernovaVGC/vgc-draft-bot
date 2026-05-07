import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { leaguesTable } from "./leagues";
import { draftPlayersTable } from "./draftPlayers";

export const queuedPicksTable = pgTable("queued_picks", {
  id: serial("id").primaryKey(),
  leagueId: integer("league_id")
    .notNull()
    .references(() => leaguesTable.id),
  playerId: integer("player_id")
    .notNull()
    .references(() => draftPlayersTable.id),
  priority: integer("priority").notNull(), // 1–5, lower = higher priority
  pokemonName: text("pokemon_name").notNull(),
  cost: integer("cost").notNull(),
  status: text("status").notNull().default("pending"), // pending | used | sniped | cancelled
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertQueuedPickSchema = createInsertSchema(queuedPicksTable).omit({
  id: true,
  createdAt: true,
});
export type InsertQueuedPick = z.infer<typeof insertQueuedPickSchema>;
export type QueuedPick = typeof queuedPicksTable.$inferSelect;
