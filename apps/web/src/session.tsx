import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@stickgame/shared";

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
interface SessionValue { playerId: string; nickname: string; setNickname: (name: string) => void; socket: GameSocket; connected: boolean; registered: boolean }
const SessionContext = createContext<SessionValue | null>(null);
const socket: GameSocket = io({ autoConnect: true });

function getPlayerId() {
  let id = localStorage.getItem("stick-player-id");
  if (!id) { id = crypto.randomUUID(); localStorage.setItem("stick-player-id", id); }
  return id;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [playerId] = useState(getPlayerId);
  const [nickname, setName] = useState(() => localStorage.getItem("stick-nickname") || "");
  const [connected, setConnected] = useState(socket.connected);
  const [registered, setRegistered] = useState(false);
  const setNickname = (name: string) => { const clean = name.trim().slice(0, 12); localStorage.setItem("stick-nickname", clean); setName(clean); if (socket.connected && clean) socket.emit("session:hello", { playerId, nickname: clean }, (result) => setRegistered(result.ok)); };
  useEffect(() => {
    const hello = () => { setConnected(true); if (nickname) socket.emit("session:hello", { playerId, nickname }, (result) => setRegistered(result.ok)); };
    const off = () => { setConnected(false); setRegistered(false); };
    socket.on("connect", hello); socket.on("disconnect", off); if (socket.connected) hello();
    return () => { socket.off("connect", hello); socket.off("disconnect", off); };
  }, [nickname, playerId]);
  const value = useMemo(() => ({ playerId, nickname, setNickname, socket, connected, registered }), [playerId, nickname, connected, registered]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
export const useSession = () => { const value = useContext(SessionContext); if (!value) throw new Error("SessionProvider missing"); return value; };
