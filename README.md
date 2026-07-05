# 젓가락 온라인

React, Vite, MediaPipe, Socket.IO로 만든 카메라 젓가락 게임입니다. AI 2~4인전, 조건별 공개 매칭, 친구방과 네 가지 룰을 지원합니다.

## 개발 실행

```powershell
npm install
npm run dev
```

Windows PowerShell 실행 정책 오류가 발생하면 `npm` 대신 아래 명령을 사용합니다.

```powershell
npm.cmd install
npm.cmd run dev
```

또는 프로젝트 폴더의 `start-game.cmd`를 더블클릭하면 설치 확인, 서버 실행, 브라우저 열기가 자동으로 진행됩니다.

- 웹: <http://localhost:5173>
- 서버 상태: <http://localhost:3001/api/health>

## 카메라 타격 조작

1. 사용할 게임 손의 숫자만큼 실제 손가락을 펼칩니다.
2. 손을 화면 아래쪽으로 내려 `READY` 상태를 만듭니다.
3. 공격할 상대 손을 향해 빠르게 위로 올려치면 공격합니다.

명중하면 게임 손 돌진, 화면 흔들림, 충격파, 파티클, 타격음과 지원 기기의 진동이 재생됩니다. 느린 이동은 조준만 하므로 실수로 공격하지 않습니다.

카메라 영상은 브라우저 안에서만 처리하며 서버에는 정규화된 손 위치와 손가락 수만 전달합니다. 카메라를 허용하지 않아도 화면의 손 카드를 눌러 플레이할 수 있습니다.

## 검사

```powershell
npm test
npm run build
```

온라인 방과 매칭은 단일 서버 메모리에 저장되므로 서버를 다시 시작하면 초기화됩니다.
