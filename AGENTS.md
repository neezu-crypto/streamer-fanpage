# 스트리머 팬페이지 작업 지침

- 이 사이트는 GitHub Pages 정적 화면과 Firebase Functions `fanpage` codebase로 구성되며 Firebase 프로젝트는 `soop-stock-market`을 공유한다.
- 인증 스트리머 판정은 서버에서 `streamerVerifications`를 조회한다. 클라이언트가 제공한 UID를 소유권 판단에 사용하지 않는다.
- 공개 프로필 응답에는 `id`, `nickname`, `soopId`, `avatarUrl`, `soopUrl`만 포함하고 인증 UID는 반환하지 않는다. 팬페이지 내용은 `streamerFanPages/{soopId}`, 최근 방문은 `streamerFanPageRecentVisits/{uid}/{soopId}`에 저장하며, 두 데이터는 Admin SDK를 거치는 callable로만 접근한다.
- 팬페이지 페이지뷰는 관리자와 대상 스트리머 본인을 제외하고 `streamerFanPageStats/{soopId}`에 누적·최근 30일 일별 조회와 일별 고유 방문 수를 기록한다. 방문 식별 해시는 `streamerFanPageDailyVisitors/{soopId}/{date}/{hash}`에 분리 저장하고 30일이 지난 날짜별 키를 정리한다. 통계 callable은 서버에서 `adminCenter/adminUids/{uid} === true`를 재검증한 뒤 인증 스트리머별 합계만 반환하며 방문자 식별 키는 반환하지 않는다.
- 인증된 스트리머가 접속하면 서버가 확인한 본인 SOOP ID 페이지로 이동한다. 안내 모달은 인증과 화면 데이터·폰트·프로필 이미지 로드가 끝난 뒤에 닫는다.
- 인증 계정 연결은 공유 `DEFAULT` Firebase Auth 세션을 사용한다. Google은 클라이언트 `linkWithPopup` 후 공유 `linkGoogleAccount` callable을, Kakao는 공식 SDK와 공유 `linkKakaoAccount` callable을 사용한다. 기존 보호 계정 전환 전에는 방문 기록이 자동 병합되지 않는다는 점을 확인받는다.
- 스트리머 인증 상태는 `users/{현재 UID}/streamerVerified`를 본인 전용으로 실시간 구독한다. 관리자 승인 결과는 페이지가 열려 있고 연결된 동안 화면에 자동 반영된다. `streamerVerificationSwitchApproval`이 도착하면 공유 `requestStreamerVerification` callable에서 신청·승인 상태를 다시 검증하고 기존 인증 UID의 custom token으로 세션을 전환한다. 토큰을 DB에 기록하지 않으며 처리 후 신호를 삭제한다. 페이지가 닫힌 상태의 푸시는 없다.
- SOOP 다시보기 캐시는 `streamerFanPageVods/{soopId}/generations/{generation}` 아래 순번 키로 저장한다. bootstrap은 첫 24개만 반환하고 나머지는 인증된 callable 페이지로 읽는다. 갱신은 임시 세대에 응답을 묶음 저장·검증한 뒤 활성 세대 포인터를 교체하며 실패 시 기존 활성 세대를 유지한다. 예전 flat `items` 캐시도 다음 갱신 전까지 읽기를 지원한다.
- 다시보기 카드는 SOOP 임베드 모달로 열고, 플레이어가 동작하지 않을 때 원본 링크를 제공한다. 갱신 UI 잠금은 스트리머 ID별로 관리한다.
- 스트리머 캘린더는 `api-channel.sooplive.com` 응답을 서버에서 조회해 월간/주간으로 보여준다. 응답은 `streamerFanPageCalendarCache/{soopId}` 아래 기간별로 캐시하며 10분 TTL, 최근 24개 기간 제한을 적용한다. 브라우저는 캘린더를 직접 읽거나 쓰지 않고 `streamerFanPageCalendar` callable만 사용한다.
- 라이브 바로가기는 서버 `streamerFanPageLiveStatus` callable이 SOOP 방송국 상태를 조회해 방송 중 여부·제목·시청자 수·미리보기 썸네일 URL을 반환한다. 브라우저는 1분마다 상태를 새로 확인하고 SOOP 플레이어 링크를 연다.
- 스트리머 갤러리 미리보기는 `streamerFanPageGallery` callable이 갤러리의 공개 이미지 미러와 통계를 읽어 최신 썸네일 8개·분류별 최신 목록·전체 수를 반환한다. 대상 갤러리 ID는 인증 UID의 관리자 연결을 우선 사용하고, 연결이 없으면 `streamerNames`에서 닉네임이 유일하게 일치할 때만 매칭한다. 브라우저는 RTDB를 직접 읽지 않으며 공유 규칙은 변경하지 않는다. 갤러리 전체 보기 링크는 `streamer`/`category` 쿼리로 기존 갤러리 검색 필터를 연다.
- YouTube 채널 주소는 인증 스트리머가 프로필 설정에서 저장한다. 최신 공개 영상은 YouTube Data API를 서버에서 조회해 `streamerFanPageYouTubeCache/{soopId}`에 30분 캐시하며, 현재 조회 크기는 24개이고 캐시·클라이언트 전체 상한은 500개다. 브라우저는 `streamerFanPageYouTubeVideos` callable만 사용한다. API 키는 Secret Manager의 `YOUTUBE_DATA_API_KEY`로 관리하고 RTDB 규칙에는 브라우저 접근을 추가하지 않는다.
- SOOP 다시보기 갱신은 전체 개수 메타데이터를 유지하면서 최신 500개까지만 세대 캐시에 저장한다. 페이지 조회도 500개 상한을 적용하고, 이후 항목은 목록에 추가하지 않는다.
- 인증 스트리머와 관리자가 추가한 일정은 `streamerFanPageSchedules/{soopId}/{eventId}`에 저장한다. 캘린더 callable은 이를 SOOP 일정과 합쳐 반환하며 브라우저는 `streamerFanPageScheduleAdd`/`streamerFanPageScheduleDelete` callable을 통해서만 일정을 추가·삭제한다.
- 새 함수는 프로젝트+리전에서 이름이 겹치지 않는지 `firebase functions:list --project soop-stock-market`으로 확인하고 함수명을 지정해 배포한다. 현재 관리자 통계 callable은 `streamerFanPageAdminStats`이며, VOD 댓글 callable은 `streamerFanPageCommentProfileSave`, `streamerFanPageVodComments`, `streamerFanPageVodCommentAdd`, `streamerFanPageVodCommentDelete`다. 페이지뷰 writer는 기존 `streamerFanPageBootstrap`에서 호출한다. 전체 Functions 배포는 금지한다.
- 이 저장소에는 `database.rules.json`을 추가하지 않는다. 팬페이지 내용·최근 방문은 callable을 통하지만, 상단 devbar 링크는 기존 공개 읽기 경로인 `devbarLinks`를 브라우저에서 직접 읽는다. RTDB 규칙을 변경할 필요가 생기면 공통 지침에 따라 여섯 사본 모두를 동기화한다.
- 새 시리즈 등록은 `admin-center/functions/index.js`의 `GAME_CATALOG`에 포함한다.
