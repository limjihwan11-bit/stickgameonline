import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createStickServer } from "./server.js";

const port = Number(process.env.PORT || 3001);
const { app, httpServer } = createStickServer();
httpServer.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") console.error(`포트 ${port}이 이미 사용 중입니다. 실행 중인 기존 게임 서버를 종료해 주세요.`);
  else console.error(error);
  process.exit(1);
});
if (process.env.NODE_ENV === "production") {
  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
  app.use(express.static(webDist));
  app.use((_req, res) => res.sendFile(path.join(webDist, "index.html")));
}
httpServer.listen(port, () => console.log(`Stick game server: http://localhost:${port}`));
