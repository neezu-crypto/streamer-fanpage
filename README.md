# 스트리머 팬페이지

스트리머 게임시리즈의 인증 스트리머 팬페이지입니다. GitHub Pages로 정적 화면을 배포하고, Firebase Cloud Functions를 통해 공유 RTDB의 스트리머 인증 정보를 확인하고 페이지 데이터를 관리합니다.

- 정적 사이트: `https://neezu-crypto.github.io/streamer-fanpage/`
- Firebase 프로젝트: `soop-stock-market`
- Functions codebase: `fanpage`
- Functions 배포 시 변경한 함수만 codebase와 함께 지정합니다. 관리자 통계 기능은 `firebase deploy --only functions:fanpage:streamerFanPageBootstrap,functions:fanpage:streamerFanPageAdminStats --project soop-stock-market`으로 배포합니다.

팬페이지, 최근 방문 기록, 수동 갱신한 SOOP 다시보기 목록, 통계 집계는 각각 `streamerFanPages/`, `streamerFanPageRecentVisits/`, `streamerFanPageVods/`, `streamerFanPageStats/`에 저장되며 브라우저는 RTDB를 직접 읽거나 쓰지 않습니다. 통계 도입 이후의 페이지 열람을 서버에서 집계하며 관리자와 해당 스트리머 본인의 열람은 제외합니다. 방문 식별자는 스트리머별·한국 날짜별 해시로 저장하고 최근 30일 이후의 일별 방문 키를 정리합니다. 통계 조회 callable은 `adminCenter/adminUids/{uid}`를 서버에서 확인해 관리자에게만 데이터를 반환합니다. 다시보기 목록은 24개씩 서버 callable로 페이지를 읽고, 전체 갱신은 임시 세대에 분할 저장한 뒤 검증을 마치면 활성 세대를 바꿉니다. 갱신은 인증 스트리머 본인 또는 관리자만 실행할 수 있습니다. 각 항목은 SOOP 임베드 모달에서 열리고, 재생이 지원되지 않으면 SOOP 원본 링크를 사용할 수 있습니다.
