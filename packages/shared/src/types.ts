import { z } from "zod";

export const ruleIds = ["classic", "no-repeat", "no-opening-split", "rollover", "items"] as const;
export type RuleId = typeof ruleIds[number];
export const itemIds = ["lightning", "bomb", "jelly", "wind", "thief"] as const;
export type ItemId = typeof itemIds[number];
export const itemMissionIds = ["attack", "split"] as const;
export type ItemMissionId = typeof itemMissionIds[number];
export const itemMissionGoals: Record<ItemMissionId, number> = { attack: 5, split: 5 };
export type Difficulty = "easy" | "medium" | "hard";
export type Hands = [number, number];

export function normalizeRuleSet(input?: RuleId | readonly RuleId[] | null): RuleId[] {
  const raw = (Array.isArray(input) ? input : input ? [input] : ["classic"]) as readonly string[];
  const selected = ruleIds.filter((rule) => raw.includes(rule));
  return selected.length ? selected : ["classic"];
}

export interface ItemEvent {
  id: ItemId;
  label: string;
  message: string;
  actorId: string;
  affectedPlayerIds: string[];
  turnNumber: number;
  kind?: "earned" | "used";
  mission?: ItemMissionId;
}

export interface PlayerItemState {
  inventory: ItemId[];
  missions: Record<ItemMissionId, number>;
  earnedItems: number;
}

export interface GamePlayer {
  id: string;
  nickname: string;
  hands: Hands;
  connected: boolean;
  isAI?: boolean;
}

export interface GameState {
  id: string;
  rule: RuleId;
  rules?: RuleId[];
  players: GamePlayer[];
  turnIndex: number;
  status: "playing" | "finished";
  winnerId?: string;
  turnStartedAt: number;
  turnNumber: number;
  firstTurnCompleted: Record<string, boolean>;
  boardHistory: string[];
  itemState?: Record<string, PlayerItemState>;
  lastItemEvent?: ItemEvent;
  ranked?: boolean;
  ratingChanges?: Record<string, RatingChange>;
}

export interface RatingChange {
  before: number;
  after: number;
  delta: number;
}

export interface PublicUser {
  id: string;
  username: string;
  nickname: string;
  elo: number;
  wins: number;
  losses: number;
  winRate: number;
  streak: number;
  bestStreak: number;
}

export interface LeaderboardEntry extends PublicUser {
  rank: number;
}

export type AttackAction = { type: "attack"; sourceHand: 0 | 1; targetPlayerId: string; targetHand: 0 | 1; clientActionId?: string };
export type SplitAction = { type: "split"; hands: Hands; clientActionId?: string };
export type UseItemAction = { type: "use-item"; itemId: ItemId; clientActionId?: string };
export type PassAction = { type: "pass"; reason: "timeout" | "disconnect"; clientActionId?: string };
export type GameAction = AttackAction | SplitAction | UseItemAction | PassAction;

export interface RoomSettings { playerCount: 2 | 3 | 4; rule: RuleId; rules?: RuleId[] }
export interface LobbyPlayer { id: string; nickname: string; ready: boolean; connected: boolean }
export interface RoomState { code: string; hostId: string; settings: RoomSettings; players: LobbyPlayer[]; status: "waiting" | "playing"; gameId?: string }

const playerCountSchema = z.union([z.literal(2), z.literal(3), z.literal(4)]);
export const roomSettingsSchema = z.object({
  playerCount: playerCountSchema,
  rule: z.enum(ruleIds).optional(),
  rules: z.array(z.enum(ruleIds)).optional()
}).transform((settings): RoomSettings => {
  const rules = normalizeRuleSet(settings.rules ?? settings.rule);
  return { playerCount: settings.playerCount, rule: rules[0], rules };
});
export const attackActionSchema = z.object({ type: z.literal("attack"), sourceHand: z.union([z.literal(0), z.literal(1)]), targetPlayerId: z.string().min(1), targetHand: z.union([z.literal(0), z.literal(1)]), clientActionId: z.string().optional() });
export const splitActionSchema = z.object({ type: z.literal("split"), hands: z.tuple([z.number().int().min(0).max(4), z.number().int().min(0).max(4)]), clientActionId: z.string().optional() });
export const useItemActionSchema = z.object({ type: z.literal("use-item"), itemId: z.enum(itemIds), clientActionId: z.string().optional() });
export const gameActionSchema = z.discriminatedUnion("type", [attackActionSchema, splitActionSchema, useItemActionSchema]);

export interface ClientToServerEvents {
  "session:hello": (payload: { playerId: string; nickname: string }, ack: (result: { ok: boolean; error?: string }) => void) => void;
  "queue:join": (payload: { settings: RoomSettings }, ack: (result: { ok: boolean; error?: string }) => void) => void;
  "queue:leave": () => void;
  "room:create": (payload: { settings: RoomSettings }, ack: (result: { ok: boolean; code?: string; error?: string }) => void) => void;
  "room:join": (payload: { code: string }, ack: (result: { ok: boolean; code?: string; error?: string }) => void) => void;
  "room:leave": (ack: (result: { ok: boolean; error?: string }) => void) => void;
  "room:update": (settings: RoomSettings) => void;
  "room:ready": (ready: boolean) => void;
  "game:action": (action: AttackAction | SplitAction | UseItemAction, ack: (result: { ok: boolean; error?: string }) => void) => void;
  "game:sync": (ack: (result: { ok: boolean; state?: GameState; error?: string }) => void) => void;
  "game:pose": (pose: { x: number; y: number; fingers: number; hand: 0 | 1 }) => void;
}

export interface ServerToClientEvents {
  "queue:state": (payload: { waiting: boolean; count: number }) => void;
  "match:found": (payload: { gameId: string }) => void;
  "room:state": (room: RoomState) => void;
  "game:state": (state: GameState) => void;
  "game:error": (payload: { message: string }) => void;
  "game:pose": (payload: { playerId: string; x: number; y: number; fingers: number; hand: 0 | 1 }) => void;
  "player:connection": (payload: { playerId: string; connected: boolean; graceUntil?: number }) => void;
}
