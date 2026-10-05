# 스트리머 팬페이지

스트리머 게임시리즈의 인증 스트리머 팬페이지입니다. GitHub Pages로 정적 화면을 배포하고, Firebase Cloud Functions를 통해 공유 RTDB의 스트리머 인증 정보를 확인하고 페이지 데이터를 관리합니다.

- 정적 사이트: `https://neezu-crypto.github.io/streamer-fanpage/`
- Firebase 프로젝트: `soop-stock-market`
- Functions codebase: `fanpage`
- Functions 배포: `firebase deploy --only functions:fanpage:streamerFanPageBootstrap,functions:fanpage:streamerFanPageSearch,functions:fanpage:streamerFanPageRecent,functions:fanpage:streamerFanPageSave --project soop-stock-market`

팬페이지와 최근 방문 기록은 `streamerFanPages/` 및 `streamerFanPageRecentVisits/`에 저장되며, 브라우저에서 RTDB를 직접 읽거나 쓰지 않습니다.
