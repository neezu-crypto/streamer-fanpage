# 스트리머 팬페이지

스트리머 게임시리즈의 인증 스트리머 팬페이지입니다. GitHub Pages로 정적 화면을 배포하고, Firebase Cloud Functions를 통해 공유 RTDB의 스트리머 인증 정보를 확인하고 페이지 데이터를 관리합니다.

- 정적 사이트: `https://neezu-crypto.github.io/streamer-fanpage/`
- Firebase 프로젝트: `soop-stock-market`
- Functions codebase: `fanpage`
- Functions 배포: `firebase deploy --only functions:fanpage:streamerFanPageBootstrap,functions:fanpage:streamerFanPageSearch,functions:fanpage:streamerFanPageRecent,functions:fanpage:streamerFanPageSave,functions:fanpage:streamerFanPageVodRefresh --project soop-stock-market`

팬페이지, 최근 방문 기록, 수동 갱신한 SOOP 다시보기 목록은 `streamerFanPages/`, `streamerFanPageRecentVisits/`, `streamerFanPageVods/`에 저장되며, 브라우저에서 RTDB를 직접 읽거나 쓰지 않습니다. 다시보기 전체 갱신은 인증 스트리머 본인 또는 관리자만 실행할 수 있습니다.
