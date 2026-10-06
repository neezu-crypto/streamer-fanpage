# 스트리머 팬페이지 작업 지침

- 이 사이트는 GitHub Pages 정적 화면과 Firebase Functions `fanpage` codebase로 구성되며 Firebase 프로젝트는 `soop-stock-market`을 공유한다.
- 인증 스트리머 판정은 서버에서 `streamerVerifications`를 조회한다. 클라이언트가 제공한 UID를 소유권 판단에 사용하지 않는다.
- 공개 프로필 응답에는 `id`, `nickname`, `soopId`, `avatarUrl`, `soopUrl`만 포함하고 인증 UID는 반환하지 않는다. 팬페이지 내용은 `streamerFanPages/{soopId}`, 최근 방문은 `streamerFanPageRecentVisits/{uid}/{soopId}`에 저장하며, 두 데이터는 Admin SDK를 거치는 callable로만 접근한다.
- 인증된 스트리머가 접속하면 서버가 확인한 본인 SOOP ID 페이지로 이동한다. 안내 모달은 인증과 화면 데이터·폰트·프로필 이미지 로드가 끝난 뒤에 닫는다.
- 인증 계정 연결은 공유 `DEFAULT` Firebase Auth 세션을 사용한다. Google은 클라이언트 `linkWithPopup` 후 공유 `linkGoogleAccount` callable을, Kakao는 공식 SDK와 공유 `linkKakaoAccount` callable을 사용한다. 기존 보호 계정 전환 전에는 방문 기록이 자동 병합되지 않는다는 점을 확인받는다.
- SOOP 다시보기 캐시는 `streamerFanPageVods/{soopId}/generations/{generation}` 아래 순번 키로 저장한다. bootstrap은 첫 24개만 반환하고 나머지는 인증된 callable 페이지로 읽는다. 갱신은 임시 세대에 응답을 묶음 저장·검증한 뒤 활성 세대 포인터를 교체하며 실패 시 기존 활성 세대를 유지한다. 예전 flat `items` 캐시도 다음 갱신 전까지 읽기를 지원한다.
- 다시보기 카드는 SOOP 임베드 모달로 열고, 플레이어가 동작하지 않을 때 원본 링크를 제공한다. 갱신 UI 잠금은 스트리머 ID별로 관리한다.
- 스트리머 캘린더는 `api-channel.sooplive.com` 응답을 서버에서 조회해 월간/주간으로 보여준다. 응답은 `streamerFanPageCalendarCache/{soopId}` 아래 기간별로 캐시하며 10분 TTL, 최근 24개 기간 제한을 적용한다. 브라우저는 캘린더를 직접 읽거나 쓰지 않고 `streamerFanPageCalendar` callable만 사용한다.
- 새 함수는 프로젝트+리전에서 이름이 겹치지 않는지 `firebase functions:list --project soop-stock-market`으로 확인하고 함수명을 지정해 배포한다. 전체 Functions 배포는 금지한다.
- 이 저장소에는 `database.rules.json`을 추가하지 않는다. 팬페이지 내용·최근 방문은 callable을 통하지만, 상단 devbar 링크는 기존 공개 읽기 경로인 `devbarLinks`를 브라우저에서 직접 읽는다. RTDB 규칙을 변경할 필요가 생기면 공통 지침에 따라 여섯 사본 모두를 동기화한다.
- 새 시리즈 등록은 `admin-center/functions/index.js`의 `GAME_CATALOG`에 포함한다.
