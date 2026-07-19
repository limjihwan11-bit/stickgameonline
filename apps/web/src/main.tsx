import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { SessionProvider } from "./session";
import { AppShell } from "./ui";
import { AuthPage, FriendlyPage, HomePage, LeaderboardPage, OnlinePage, QueuePage, SetupPage } from "./pages";
import { GamePage } from "./game/GamePage";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode><SessionProvider><BrowserRouter><AppShell><Routes>
    <Route path="/" element={<HomePage />} />
    <Route path="/online" element={<OnlinePage />} />
    <Route path="/setup/:kind" element={<SetupPage />} />
    <Route path="/queue" element={<QueuePage />} />
    <Route path="/auth/:mode" element={<AuthPage />} />
    <Route path="/leaderboard" element={<LeaderboardPage />} />
    <Route path="/friendly" element={<FriendlyPage />} />
    <Route path="/friendly/:code" element={<FriendlyPage />} />
    <Route path="/game/:mode/:gameId?" element={<GamePage />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></AppShell></BrowserRouter></SessionProvider></React.StrictMode>
);
