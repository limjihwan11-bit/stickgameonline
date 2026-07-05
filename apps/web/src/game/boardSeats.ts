export type BoardSeat = "north" | "west" | "east";

export function getOpponentSeats(playerCount: number): BoardSeat[] {
  if (playerCount <= 2) return ["north"];
  if (playerCount === 3) return ["west", "east"];
  return ["west", "north", "east"];
}
