import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { LeaderboardEntry, PublicUser, RatingChange, RuleId } from "@stickgame/shared";

export interface StoredUser {
  id: string;
  username: string;
  nickname: string;
  passwordHash: string;
}

interface StoredStats {
  userId: string;
  elo: number;
  wins: number;
  losses: number;
  streak: number;
  bestStreak: number;
}

export interface RankedRecordInput {
  gameId: string;
  winnerUserId: string;
  playerUserIds: string[];
  rules: RuleId[];
}

export interface AuthStore {
  createUser(username: string, nickname: string, passwordHash: string): Promise<StoredUser>;
  findUserByUsername(username: string): Promise<StoredUser | undefined>;
  findUserById(userId: string): Promise<StoredUser | undefined>;
  createSession(userId: string, token: string, expiresAt: Date): Promise<void>;
  findSessionUser(token: string): Promise<StoredUser | undefined>;
  deleteSession(token: string): Promise<void>;
  getPublicUser(userId: string): Promise<PublicUser | undefined>;
  getLeaderboard(limit?: number): Promise<LeaderboardEntry[]>;
  recordRankedMatch(input: RankedRecordInput): Promise<Record<string, RatingChange> | undefined>;
  close?(): Promise<void>;
}

const DEFAULT_ELO = 1000;
const K_FACTOR = 32;

const lower = (value: string) => value.trim().toLowerCase();
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const winRate = (stats: Pick<StoredStats, "wins" | "losses">) => {
  const total = stats.wins + stats.losses;
  return total ? Math.round((stats.wins / total) * 1000) / 10 : 0;
};

function expectedScore(own: number, opponent: number) {
  return 1 / (1 + Math.pow(10, (opponent - own) / 400));
}

function ratingDeltas(winnerElo: number, loserElo: number) {
  const winnerDelta = Math.round(K_FACTOR * (1 - expectedScore(winnerElo, loserElo)));
  const loserDelta = Math.round(K_FACTOR * (0 - expectedScore(loserElo, winnerElo)));
  return { winnerDelta, loserDelta };
}

function publicUser(user: StoredUser, stats: StoredStats): PublicUser {
  return {
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    elo: stats.elo,
    wins: stats.wins,
    losses: stats.losses,
    winRate: winRate(stats),
    streak: stats.streak,
    bestStreak: stats.bestStreak
  };
}

export class MemoryAuthStore implements AuthStore {
  users = new Map<string, StoredUser>();
  usernameIndex = new Map<string, string>();
  sessions = new Map<string, { userId: string; expiresAt: Date }>();
  stats = new Map<string, StoredStats>();
  recordedGames = new Set<string>();

  async createUser(username: string, nickname: string, passwordHash: string): Promise<StoredUser> {
    const key = lower(username);
    if (this.usernameIndex.has(key)) throw new Error("이미 사용 중인 아이디입니다.");
    const user: StoredUser = { id: randomUUID(), username: username.trim(), nickname: nickname.trim(), passwordHash };
    this.users.set(user.id, user);
    this.usernameIndex.set(key, user.id);
    this.stats.set(user.id, { userId: user.id, elo: DEFAULT_ELO, wins: 0, losses: 0, streak: 0, bestStreak: 0 });
    return user;
  }

  async findUserByUsername(username: string) {
    const id = this.usernameIndex.get(lower(username));
    return id ? this.users.get(id) : undefined;
  }

  async findUserById(userId: string) {
    return this.users.get(userId);
  }

  async createSession(userId: string, token: string, expiresAt: Date) {
    this.sessions.set(tokenHash(token), { userId, expiresAt });
  }

  async findSessionUser(token: string) {
    const session = this.sessions.get(tokenHash(token));
    if (!session || session.expiresAt.getTime() <= Date.now()) return undefined;
    return this.users.get(session.userId);
  }

  async deleteSession(token: string) {
    this.sessions.delete(tokenHash(token));
  }

  async getPublicUser(userId: string) {
    const user = this.users.get(userId);
    const stats = this.stats.get(userId);
    return user && stats ? publicUser(user, stats) : undefined;
  }

  async getLeaderboard(limit = 50) {
    return [...this.users.values()]
      .map((user) => publicUser(user, this.stats.get(user.id)!))
      .sort((a, b) => b.elo - a.elo || b.wins - a.wins || a.nickname.localeCompare(b.nickname))
      .slice(0, limit)
      .map((entry, index) => ({ ...entry, rank: index + 1 }));
  }

  async recordRankedMatch(input: RankedRecordInput) {
    if (this.recordedGames.has(input.gameId)) return undefined;
    const uniquePlayers = [...new Set(input.playerUserIds)];
    if (!uniquePlayers.includes(input.winnerUserId) || uniquePlayers.length < 2) return undefined;
    const before = new Map(uniquePlayers.map((id) => [id, this.stats.get(id)?.elo ?? DEFAULT_ELO]));
    const delta = new Map(uniquePlayers.map((id) => [id, 0]));
    for (const loserId of uniquePlayers.filter((id) => id !== input.winnerUserId)) {
      const pair = ratingDeltas(before.get(input.winnerUserId)!, before.get(loserId)!);
      delta.set(input.winnerUserId, delta.get(input.winnerUserId)! + pair.winnerDelta);
      delta.set(loserId, delta.get(loserId)! + pair.loserDelta);
    }

    const changes: Record<string, RatingChange> = {};
    for (const userId of uniquePlayers) {
      const current = this.stats.get(userId) ?? { userId, elo: DEFAULT_ELO, wins: 0, losses: 0, streak: 0, bestStreak: 0 };
      const won = userId === input.winnerUserId;
      const nextElo = Math.max(100, current.elo + delta.get(userId)!);
      const nextStreak = won ? current.streak + 1 : 0;
      this.stats.set(userId, {
        ...current,
        elo: nextElo,
        wins: current.wins + (won ? 1 : 0),
        losses: current.losses + (won ? 0 : 1),
        streak: nextStreak,
        bestStreak: Math.max(current.bestStreak, nextStreak)
      });
      changes[userId] = { before: current.elo, after: nextElo, delta: nextElo - current.elo };
    }
    this.recordedGames.add(input.gameId);
    return changes;
  }
}

export class PostgresAuthStore implements AuthStore {
  private pool: Pool;
  private ready: Promise<void>;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, ssl: process.env.PGSSLMODE === "disable" ? false : process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined });
    this.ready = this.init();
  }

  private async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        username_lower TEXT NOT NULL UNIQUE,
        nickname TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS auth_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS player_stats (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        elo INTEGER NOT NULL DEFAULT 1000,
        wins INTEGER NOT NULL DEFAULT 0,
        losses INTEGER NOT NULL DEFAULT 0,
        streak INTEGER NOT NULL DEFAULT 0,
        best_streak INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS ranked_matches (
        game_id TEXT PRIMARY KEY,
        winner_user_id TEXT NOT NULL REFERENCES users(id),
        player_count INTEGER NOT NULL,
        rules TEXT[] NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS ranked_match_players (
        game_id TEXT NOT NULL REFERENCES ranked_matches(game_id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id),
        result TEXT NOT NULL,
        elo_before INTEGER NOT NULL,
        elo_after INTEGER NOT NULL,
        delta INTEGER NOT NULL,
        PRIMARY KEY (game_id, user_id)
      );
    `);
  }

  private async rowToUser(row: any): Promise<StoredUser | undefined> {
    return row ? { id: row.id, username: row.username, nickname: row.nickname, passwordHash: row.password_hash } : undefined;
  }

  async createUser(username: string, nickname: string, passwordHash: string) {
    await this.ready;
    const user: StoredUser = { id: randomUUID(), username: username.trim(), nickname: nickname.trim(), passwordHash };
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO users (id, username, username_lower, nickname, password_hash) VALUES ($1, $2, $3, $4, $5)",
        [user.id, user.username, lower(user.username), user.nickname, user.passwordHash]
      );
      await client.query("INSERT INTO player_stats (user_id) VALUES ($1)", [user.id]);
      await client.query("COMMIT");
      return user;
    } catch (error: any) {
      await client.query("ROLLBACK");
      if (error?.code === "23505") throw new Error("이미 사용 중인 아이디입니다.");
      throw error;
    } finally {
      client.release();
    }
  }

  async findUserByUsername(username: string) {
    await this.ready;
    const result = await this.pool.query("SELECT * FROM users WHERE username_lower = $1", [lower(username)]);
    return this.rowToUser(result.rows[0]);
  }

  async findUserById(userId: string) {
    await this.ready;
    const result = await this.pool.query("SELECT * FROM users WHERE id = $1", [userId]);
    return this.rowToUser(result.rows[0]);
  }

  async createSession(userId: string, token: string, expiresAt: Date) {
    await this.ready;
    await this.pool.query("INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)", [tokenHash(token), userId, expiresAt]);
  }

  async findSessionUser(token: string) {
    await this.ready;
    const result = await this.pool.query(
      "SELECT u.* FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > NOW()",
      [tokenHash(token)]
    );
    return this.rowToUser(result.rows[0]);
  }

  async deleteSession(token: string) {
    await this.ready;
    await this.pool.query("DELETE FROM auth_sessions WHERE token_hash = $1", [tokenHash(token)]);
  }

  async getPublicUser(userId: string) {
    await this.ready;
    const result = await this.pool.query(
      `SELECT u.id, u.username, u.nickname, s.elo, s.wins, s.losses, s.streak, s.best_streak
       FROM users u JOIN player_stats s ON s.user_id = u.id WHERE u.id = $1`,
      [userId]
    );
    const row = result.rows[0];
    return row ? publicUser(
      { id: row.id, username: row.username, nickname: row.nickname, passwordHash: "" },
      { userId: row.id, elo: row.elo, wins: row.wins, losses: row.losses, streak: row.streak, bestStreak: row.best_streak }
    ) : undefined;
  }

  async getLeaderboard(limit = 50) {
    await this.ready;
    const result = await this.pool.query(
      `SELECT u.id, u.username, u.nickname, s.elo, s.wins, s.losses, s.streak, s.best_streak
       FROM users u JOIN player_stats s ON s.user_id = u.id
       ORDER BY s.elo DESC, s.wins DESC, u.nickname ASC LIMIT $1`,
      [limit]
    );
    return result.rows.map((row, index) => ({
      ...publicUser(
        { id: row.id, username: row.username, nickname: row.nickname, passwordHash: "" },
        { userId: row.id, elo: row.elo, wins: row.wins, losses: row.losses, streak: row.streak, bestStreak: row.best_streak }
      ),
      rank: index + 1
    }));
  }

  async recordRankedMatch(input: RankedRecordInput) {
    await this.ready;
    const uniquePlayers = [...new Set(input.playerUserIds)];
    if (!uniquePlayers.includes(input.winnerUserId) || uniquePlayers.length < 2) return undefined;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        "INSERT INTO ranked_matches (game_id, winner_user_id, player_count, rules) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING game_id",
        [input.gameId, input.winnerUserId, uniquePlayers.length, input.rules]
      );
      if (!inserted.rowCount) {
        await client.query("ROLLBACK");
        return undefined;
      }
      const statsResult = await client.query("SELECT * FROM player_stats WHERE user_id = ANY($1::text[]) FOR UPDATE", [uniquePlayers]);
      const stats = new Map<string, StoredStats>(statsResult.rows.map((row) => [row.user_id, {
        userId: row.user_id, elo: row.elo, wins: row.wins, losses: row.losses, streak: row.streak, bestStreak: row.best_streak
      }]));
      const before = new Map(uniquePlayers.map((id) => [id, stats.get(id)?.elo ?? DEFAULT_ELO]));
      const delta = new Map(uniquePlayers.map((id) => [id, 0]));
      for (const loserId of uniquePlayers.filter((id) => id !== input.winnerUserId)) {
        const pair = ratingDeltas(before.get(input.winnerUserId)!, before.get(loserId)!);
        delta.set(input.winnerUserId, delta.get(input.winnerUserId)! + pair.winnerDelta);
        delta.set(loserId, delta.get(loserId)! + pair.loserDelta);
      }

      const changes: Record<string, RatingChange> = {};
      for (const userId of uniquePlayers) {
        const current = stats.get(userId) ?? { userId, elo: DEFAULT_ELO, wins: 0, losses: 0, streak: 0, bestStreak: 0 };
        const won = userId === input.winnerUserId;
        const nextElo = Math.max(100, current.elo + delta.get(userId)!);
        const nextStreak = won ? current.streak + 1 : 0;
        const next = {
          ...current,
          elo: nextElo,
          wins: current.wins + (won ? 1 : 0),
          losses: current.losses + (won ? 0 : 1),
          streak: nextStreak,
          bestStreak: Math.max(current.bestStreak, nextStreak)
        };
        await client.query(
          `UPDATE player_stats SET elo = $2, wins = $3, losses = $4, streak = $5, best_streak = $6, updated_at = NOW()
           WHERE user_id = $1`,
          [userId, next.elo, next.wins, next.losses, next.streak, next.bestStreak]
        );
        await client.query(
          "INSERT INTO ranked_match_players (game_id, user_id, result, elo_before, elo_after, delta) VALUES ($1, $2, $3, $4, $5, $6)",
          [input.gameId, userId, won ? "win" : "loss", current.elo, next.elo, next.elo - current.elo]
        );
        changes[userId] = { before: current.elo, after: next.elo, delta: next.elo - current.elo };
      }
      await client.query("COMMIT");
      return changes;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async close() {
    await this.pool.end();
  }
}

export function createAuthStore(): AuthStore {
  return process.env.DATABASE_URL ? new PostgresAuthStore(process.env.DATABASE_URL) : new MemoryAuthStore();
}
