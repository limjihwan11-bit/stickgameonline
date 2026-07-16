import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, PublicUser, ServerToClientEvents } from "@stickgame/shared";

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
interface SessionValue {
  playerId: string;
  nickname: string;
  setNickname: (name: string) => void;
  socket: GameSocket;
  connected: boolean;
  registered: boolean;
  user: PublicUser | null;
  authLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, nickname: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}
const SessionContext = createContext<SessionValue | null>(null);
const socket: GameSocket = io({ autoConnect: true });

function getPlayerId() {
  let id = localStorage.getItem("stick-player-id");
  if (!id) { id = crypto.randomUUID(); localStorage.setItem("stick-player-id", id); }
  return id;
}

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "요청을 처리하지 못했습니다.");
  return data as T;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [playerId] = useState(getPlayerId);
  const [nickname, setName] = useState(() => localStorage.getItem("stick-nickname") || "");
  const [connected, setConnected] = useState(socket.connected);
  const [registered, setRegistered] = useState(false);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const reconnectSocket = () => {
    setRegistered(false);
    if (socket.connected) socket.disconnect();
    socket.connect();
  };
  const setNickname = (name: string) => {
    const clean = name.trim().slice(0, 12);
    localStorage.setItem("stick-nickname", clean);
    setName(clean);
    if (socket.connected && clean) socket.emit("session:hello", { playerId, nickname: clean }, (result) => setRegistered(result.ok));
  };
  const refreshUser = async () => {
    const data = await readJson<{ user: PublicUser | null }>(await fetch("/api/auth/me", { credentials: "include" }));
    setUser(data.user);
    if (data.user) {
      localStorage.setItem("stick-nickname", data.user.nickname);
      setName(data.user.nickname);
    }
  };
  const login = async (username: string, password: string) => {
    const data = await readJson<{ user: PublicUser }>(await fetch("/api/auth/login", {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password })
    }));
    setUser(data.user); setNickname(data.user.nickname); reconnectSocket();
  };
  const register = async (username: string, nextNickname: string, password: string) => {
    const data = await readJson<{ user: PublicUser }>(await fetch("/api/auth/register", {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, nickname: nextNickname, password })
    }));
    setUser(data.user); setNickname(data.user.nickname); reconnectSocket();
  };
  const logout = async () => {
    await readJson<{ ok: boolean }>(await fetch("/api/auth/logout", { method: "POST", credentials: "include" }));
    setUser(null); reconnectSocket();
  };
  useEffect(() => {
    refreshUser().catch(() => setUser(null)).finally(() => setAuthLoading(false));
  }, []);
  useEffect(() => {
    const hello = () => { setConnected(true); if (nickname) socket.emit("session:hello", { playerId, nickname }, (result) => setRegistered(result.ok)); };
    const off = () => { setConnected(false); setRegistered(false); };
    socket.on("connect", hello); socket.on("disconnect", off); if (socket.connected) hello();
    return () => { socket.off("connect", hello); socket.off("disconnect", off); };
  }, [nickname, playerId]);
  const value = useMemo(() => ({ playerId, nickname, setNickname, socket, connected, registered, user, authLoading, login, register, logout, refreshUser }), [playerId, nickname, connected, registered, user, authLoading]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
export const useSession = () => { const value = useContext(SessionContext); if (!value) throw new Error("SessionProvider missing"); return value; };
