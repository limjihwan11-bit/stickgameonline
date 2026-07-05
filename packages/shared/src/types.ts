import { z } from "zod";

export const ruleIds = ["classic", "no-repeat", "no-opening-split", "rollover"] as const;
export type RuleId = typeof ruleIds[number];
export type Difficulty = "easy" | "medium" | "hard";
export type Hands = [number, number];

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
  players: GamePlayer[];
  turnIndex: number;
  status: "playing" | "finished";
  winnerId?: string;
  turnStartedAt: number;
  turnNumber: number;
  firstTurnCompleted: Record<string, boolean>;
  boardHistory: string[];
}

export type AttackAction = { type: "attack"; sourceHand: 0 | 1; targetPlayerId: string; targetHand: 0 | 1; clientActionId?: string };
export type SplitAction = { type: "split"; hands: Hands; clientActionId?: string };
export type PassAction = { type: "pass"; reason: "timeout" | "disconnect"; clientActionId?: string };
export type GameAction = AttackAction | SplitAction | PassAction;

export interface RoomSettings { playerCount: 2 | 3 | 4; rule: RuleId }
export interface LobbyPlayer { id: string; nickname: string; ready: boolean; connected: boolean }
export interface RoomState { code: string; hostId: string; settings: RoomSettings; players: LobbyPlayer[]; status: "waiting" | "playing"; gameId?: string }

export const roomSettingsSchema = z.object({ playerCount: z.union([z.literal(2), z.literal(3), z.literal(4)]), rule: z.enum(ruleIds) });
export const attackActionSchema = z.object({ type: z.literal("attack"), sourceHand: z.union([z.literal(0), z.literal(1)]), targetPlayerId: z.string().min(1), targetHand: z.union([z.literal(0), z.literal(1)]), clientActionId: z.string().optional() });
export const splitActionSchema = z.object({ type: z.literal("split"), hands: z.tuple([z.number().int().min(0).max(4), z.number().int().min(0).max(4)]), clientActionId: z.string().optional() });
export const gameActionSchema = z.discriminatedUnion("type", [attackActionSchema, splitActionSchema]);

export interface ClientToServerEvents {
  "session:hello": (payload: { playerId: string; nickname: string }, ack: (result: { ok: boolean; error?: string }) => void) => void;
  "queue:join": (payload: { settings: RoomSettings }, ack: (result: { ok: boolean; error?: string }) => void) => void;
  "queue:leave": () => void;
  "room:create": (payload: { settings: RoomSettings }, ack: (result: { ok: boolean; code?: string; error?: string }) => void) => void;
  "room:join": (payload: { code: string }, ack: (result: { ok: boolean; code?: string; error?: string }) => void) => void;
  "room:update": (settings: RoomSettings) => void;
  "room:ready": (ready: boolean) => void;
  "game:action": (action: AttackAction | SplitAction, ack: (result: { ok: boolean; error?: string }) => void) => void;
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
