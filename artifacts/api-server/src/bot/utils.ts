import type { DraftPlayer } from "@workspace/db";

/**
 * Returns the player whose turn it is at a given absolute draft position.
 * Snake draft: odd rounds go forward (0→n-1), even rounds go backward (n-1→0).
 */
export function getPlayerAtPosition(
  players: DraftPlayer[],
  position: number,
  playerCount: number,
): DraftPlayer | undefined {
  const round = Math.floor(position / playerCount) + 1;
  const posInRound = position % playerCount;
  const playerOrder = round % 2 === 1 ? posInRound : playerCount - 1 - posInRound;
  return players.find((p) => p.draftOrder === playerOrder);
}

/** 1-indexed round number for a given absolute draft position. */
export function getCurrentRound(draftPosition: number, playerCount: number): number {
  return Math.floor(draftPosition / playerCount) + 1;
}

/**
 * Finds the next absolute draft position (≥ startPosition) where an eligible
 * player (has budget left AND has not hit max picks) exists.
 */
export function findNextEligiblePosition(
  players: DraftPlayer[],
  startPosition: number,
  playerCount: number,
  maxPicks: number,
): { position: number; player: DraftPlayer } | null {
  const maxPosition = playerCount * maxPicks;
  for (let pos = startPosition; pos < maxPosition; pos++) {
    const player = getPlayerAtPosition(players, pos, playerCount);
    if (player && player.budgetRemaining > 0 && player.picksCount < maxPicks) {
      return { position: pos, player };
    }
  }
  return null;
}

/**
 * Finds the next absolute draft position (≥ fromPosition) where the given
 * player appears in the snake draft order (regardless of eligibility).
 * Used to calculate makeup pick deadlines.
 */
export function findPlayerNextPosition(
  players: DraftPlayer[],
  playerId: number,
  fromPosition: number,
  playerCount: number,
  maxPicks: number,
): number | null {
  const maxPosition = playerCount * maxPicks;
  for (let pos = fromPosition; pos < maxPosition; pos++) {
    const p = getPlayerAtPosition(players, pos, playerCount);
    if (p && p.id === playerId) return pos;
  }
  return null;
}
