# 스트리머 팬페이지 작업 지침

- 이 사이트는 GitHub Pages 정적 화면과 Firebase Functions `fanpage` codebase로 구성되며 Firebase 프로젝트는 `soop-stock-market`을 공유한다.
- 인증 스트리머 판정은 서버에서 `streamerVerifications`를 조회한다. 클라이언트가 제공한 UID를 소유권 판단에 사용하지 않는다.
- 공개 프로필은 `nickname`과 `soopId`만 반환한다. 팬페이지 내용은 `streamerFanPages/{soopId}`, 최근 방문은 `streamerFanPageRecentVisits/{uid}/{soopId}`에 저장하고 Admin SDK를 거치는 callable로만 접근한다.
- 인증된 스트리머가 접속하면 서버가 확인한 본인 SOOP ID 페이지로 이동한다. 안내 모달은 인증과 화면 데이터·폰트·프로필 이미지 로드가 끝난 뒤에 닫는다.
- 새 함수는 프로젝트+리전에서 이름이 겹치지 않는지 `firebase functions:list --project soop-stock-market`으로 확인하고 함수명을 지정해 배포한다. 전체 Functions 배포는 금지한다.
- `database.rules.json`은 추가하지 않는다. 브라우저 DB 접근이 필요해져 RTDB 규칙을 변경한다면 공통 지침에 따라 여섯 사본 모두를 동기화한다.
- 새 시리즈 등록은 `admin-center/functions/index.js`의 `GAME_CATALOG`에 포함한다.
