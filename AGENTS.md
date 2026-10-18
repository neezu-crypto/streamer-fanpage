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
- 노래책은 `streamerFanPageSongbooks/{soopId}/{videoId}`에 YouTube 영상 제목·썸네일·등록 시각을 저장한다. 팬페이지 bootstrap에서 공개 목록을 반환하고, 추가·삭제는 인증 스트리머 또는 관리자를 서버에서 확인하는 `streamerFanPageSongbook` callable만 사용한다. YouTube 영상 메타데이터는 `YOUTUBE_DATA_API_KEY`를 사용해 서버에서 조회하며 브라우저용 RTDB 규칙은 추가하지 않는다.
- SOOP 다시보기 갱신은 전체 개수 메타데이터를 유지하면서 최신 500개까지만 세대 캐시에 저장한다. 페이지 조회도 500개 상한을 적용하고, 이후 항목은 목록에 추가하지 않는다.
- `viewer-stats.html`은 `streamerNames`/`streamerVerifications`와 SOOP 공식 스트리머 검색에서 닉네임·SOOP ID 일부가 일치하는 결과를 찾아 다시보기 목록을 조회한다. 직접 입력한 SOOP ID나 방송국 주소도 지원한다. `streamerFanPageViewerStats` callable이 SOOP의 공개 VOD 목록과 별별통계 유저 수 그래프를 서버에서 읽어 방송 시작·종료 각 5분을 제외하고 최고·최저 분 단위 시점을 계산한다. 개별 다시보기 카드에는 최고·최저 시점만 표시하고, 평균 대비 상승률은 같은 날 두 스트리머 비교 결과에서만 제공한다. 기간 분석은 최근 1년 VOD를 한 번 훑어 7일·30일·90일·365일 각각의 최고 시청 순간을 찾는다. 완료된 기간별 요약은 서버 전용 `streamerFanPageViewerPeriodCache/{soopId}`에 저장해 모든 계정이 최대 6시간 재사용한다. 요약이 만료되거나 최고 VOD가 해당 기간에서 빠지면 기존 VOD 통계 캐시로 다시 조합하며, 10분마다 첫 VOD 페이지를 확인해 새 다시보기가 등록되면 더 일찍 갱신한다. 다시 분석 버튼은 기간별 요약을 강제로 다시 조합하며, 원본 그래프는 VOD별 공용 캐시에 없을 때만 재수집한다. 요약 생성은 통계가 모두 캐시된 경우에만 저장하고, 실패·페이지 상한으로 불완전한 결과는 공유하지 않는다. 구독·관리자 권한은 매 요약 요청마다 서버에서 확인한다. 통계 요청은 App Check를 적용하고, 익명·로그인·구독·관리자 등급별 분당·일일 한도를 적용한다. 익명은 로그인 계정보다 적은 요청 한도를 받고, 통계 작업은 전 등급이 공유하는 Cloud Tasks 대기열에 넣는다. 서버 작업자가 RTDB 대기 항목에서 구독·관리자·로그인·익명 순으로 선택하며, 1분마다 우선순위를 한 단계 올려 익명 요청도 오래 기다리면 처리되도록 한다. 전역 동시 처리 수는 최대 16개, 브라우저 동시 요청은 최대 3개다. 같은 날 비교는 VOD 카드를 고르는 대신 스트리머 두 명과 날짜를 입력받고, 각 스트리머의 당일 VOD를 찾아 최고 고점과 평균 대비 상승률을 비교한다. 대기 중·완료된 작업과 임시 결과는 `streamerFanPageViewerStatsJobs/{YYYY-MM-DD}/{uuid}`에 저장하며 요청 UID 해시를 서버에서 검증한 callable로만 읽게 한다. 만료된 대기열 항목은 요청 후 2시간부터 정리하고, 요청일 기준 3일 지난 작업 결과는 작업자와 매일 정리 스케줄러가 함께 정리한다. 성공적으로 계산한 통계 요약은 모든 계정이 재사용하도록 서버 전용 RTDB 경로 `streamerFanPageViewerStatsCache/{soopId}/{vodId}`에 만료 없이 저장한다. 다음 요청은 이 캐시를 먼저 확인해 Cloud Tasks와 SOOP 그래프 재수집을 건너뛰며, 첫 동시 요청은 RTDB 잠금으로 한 번만 계산되도록 조정한다. 캐시에는 최고·최저 시점, 평균, 분석 시각만 저장하고 원본 그래프는 저장하지 않는다. 실패한 분석은 캐시하지 않는다. 브라우저는 캐시를 직접 읽거나 쓰지 않으며, 캐시 적중 요청도 기존 사용량 한도에 포함된다. 사용량은 `streamerFanPageViewerStatsLimits/{uidHash}`에 최근 30일 등급·동작별 횟수, 스트리머별 첫 페이지 선택 횟수, 대기열 등록·완료·취소·실패·현재 대기·대기 시간·캐시 적중을 기록하고 관리자 callable에서만 합산한다. 원본 UID와 검색어는 저장·반환하지 않으며 관리자 화면은 최근 30일 상위 30개 스트리머를 표시한다. 공유 규칙은 수정하지 않는다.
- 고점체크의 `오늘의 후원 스트리머`는 `streamerFanPageSponsorAds`, `streamerFanPageSponsorRequests`, `streamerFanPageSponsorPending`, `streamerFanPageSponsorPlacementClaims`, `streamerFanPageSponsorLimits`에 저장한다. 이 노드는 Firebase Admin SDK 전용이며 브라우저 직접 읽기·쓰기를 열지 않는다. `streamerFanPageSponsorAds`는 만료 전 공개 카드 데이터(닉네임·SOOP ID·좌우 영역·시작/종료 시각)만 보유하고, `streamerFanPageSponsorAds` callable은 공개 카드와 신청 소유자 전용 상태 및 좌우 대기 칸 수만 반환한다. 신청 UID와 후원자 SOOP 아이디는 관리자 callable만 읽는다. 별풍선은 하루 10개, 최대 30일이며 관리자 확장 프로그램이 읽은 SOOP 후원 알림의 발신 아이디·수량·시각이 단일 신청과 일치하면 신청 완료 버튼 클릭 여부와 무관하게 자동 승인하고 광고를 즉시 노출한다. 후원 전 신청은 7일 후 만료, 승인된 광고는 최대 30일 노출되며, 동일 SOOP ID의 진행 중 신청·활성 광고 중복과 각 영역 5개(전체 10개) 상한을 서버 transaction으로 예약·제어한다. 여러 신청과 겹치거나 알림을 확인할 수 없으면 자동 승인하지 않고 관리자 수동 검수로 남기며, 이 경우 신청자가 후원 완료 버튼을 눌러 관리자가 검수할 수 있게 한다. UI는 좌우 영역마다 최대 5개를 남은 기간 긴 순으로 표시하고, 신청이 예약한 칸은 확인 중으로 표시하며, 비어 있는 자리가 있으면 영역마다 신청 칸 하나를 표시한다. 폭 1440px 미만은 가로 목록으로 보여준다. 관리자 관리는 `streamerFanPageAdminSponsorAds`, 라이브 미리보기는 `streamerFanPageLiveStatus`를 쓴다. 개인정보 처리방침·이용약관에도 비용, 항목, 보관 및 승인 흐름을 반영한다.
- 인증 스트리머와 관리자가 추가한 일정은 `streamerFanPageSchedules/{soopId}/{eventId}`에 저장한다. 캘린더 callable은 이를 SOOP 일정과 합쳐 반환하며 브라우저는 `streamerFanPageScheduleAdd`/`streamerFanPageScheduleDelete` callable을 통해서만 일정을 추가·삭제한다.
- 위플랩 룰렛 공유 페이지는 서버가 `weflab.com/user/{shareId}` 공개 HTML에서 후원 개수·항목·확률·수정 시각을 읽어 `streamerFanPageRouletteCache/{soopId}`에 1분 캐시한다. 페이지 접속 시 최신 데이터를 확인하고 수동 새로고침도 제공한다. 모바일은 iframe 대신 팬페이지 네이티브 UI로 표시하며 RTDB 규칙은 변경하지 않는다.
- 업보 정리의 새 신청 흐름은 `streamerFanPageUpbo/{soopId}/items`, `submissions`, `records`에 저장한다. 팬 제출은 인증 세션에서 닉네임·항목·수량·신청 시각만 기록하고, 대기 신청은 스트리머·관리자에게만 반환한다. 승인된 내용만 공개 기록에 원자적으로 옮긴다. 신청 항목·확정 기록의 변경은 해당 인증 스트리머 또는 관리자를 서버에서 확인한다. 이전 `topics`·`viewers` 데이터와 callable 동작은 보존하며 브라우저용 RTDB 규칙은 추가하지 않는다.
- 새 함수는 프로젝트+리전에서 이름이 겹치지 않는지 `firebase functions:list --project soop-stock-market`으로 확인하고 함수명을 지정해 배포한다. 현재 관리자 통계 callable은 `streamerFanPageAdminStats`, 룰렛 callable은 `streamerFanPageRoulette`, 업보 callable은 `streamerFanPageUpbo`, 노래책 callable은 `streamerFanPageSongbook`, 시청 통계 callable은 `streamerFanPageViewerStats`, 시청 통계 작업자는 `streamerFanPageViewerStatsWorker`, 정리 스케줄러는 `streamerFanPageViewerStatsJobCleanup`, 후원 광고·관리 callable은 `streamerFanPageSponsorAds`, `streamerFanPageAdminSponsorAds`이며, VOD 댓글 callable은 `streamerFanPageCommentProfileSave`, `streamerFanPageVodComments`, `streamerFanPageVodCommentAdd`, `streamerFanPageVodCommentDelete`다. 페이지뷰 writer는 기존 `streamerFanPageBootstrap`에서 호출한다. 전체 Functions 배포는 금지한다.
- 이 저장소에는 `database.rules.json`을 추가하지 않는다. 팬페이지 내용·최근 방문은 callable을 통하지만, 상단 devbar 링크는 기존 공개 읽기 경로인 `devbarLinks`를 브라우저에서 직접 읽는다. RTDB 규칙을 변경할 필요가 생기면 공통 지침에 따라 여섯 사본 모두를 동기화한다.
- 새 시리즈 등록은 `admin-center/functions/index.js`의 `GAME_CATALOG`에 포함한다.

## 3. 팬페이지 레이아웃·디자인 테마 추가 기준

새 레이아웃이나 시각 테마를 추가할 때는 일부 화면만 먼저 바꾸지 말고 아래 적용 범위를 한 번에 점검한다. 현재 레이아웃은 스트리머별 `profile.layoutDesign`으로 선택되며 기본값은 디자인 1, `2`는 기존 팬페이지 디자인이다. 저장된 값으로 공개 페이지도 같은 레이아웃을 렌더링해야 한다. 설정창에서 고른 레이아웃은 즉시 미리보기로 반영하고 저장 없이 닫으면 원래 설정으로 되돌린다.

### 구현 원칙

- 공통 구조와 동작은 재사용하고, 새 레이아웃의 스타일은 `fanpage-layouts.css`에 `#fanPageView.fanpage-layout-{번호}` 범위로 작성한다. `style.css`의 디자인 2 기본값을 새 테마에 전역 적용하지 않는다. 문서의 `<link>` 순서는 기본 `style.css` 다음 테마 스타일이며, CSS가 바뀌면 `index.html`의 테마 CSS 버전 쿼리도 갱신한다.
- 레이아웃 루트에서 배경, 카드 표면, 기본/보조 글자색, 테두리, 강조색, 그림자, 모서리, 입력 포커스 색을 CSS 변수로 정의한다. 구성 요소마다 임의의 고정 색을 반복하지 말고 변수에서 파생해 테마 전체가 같이 바뀌게 한다. 스트리머별 개별 테마(현재 유하띠의 파랑)는 일반 레이아웃 토큰 위에 별도 modifier로 겹쳐 적용한다.
- 기본 `style.css`의 어두운 색이 남기 쉬운 중첩 요소와 동적 생성 요소를 개별 점검한다. 바깥 카드만 바꿔 놓고 안쪽 카드·제목·상태 문구를 이전 테마 색으로 두지 않는다. 특히 라이브 미리보기의 정보 패널, 방송 제목, 방송 중/종료·오류 상태와 LIVE 뱃지는 `fanpage-layouts.css`에서 명시적으로 테마화한다.
- 프로필의 보기·수정 상태를 함께 맞춘다. 프로필 카드, 정보 행, 인라인 빠른 수정 입력창·저장/취소 버튼, 프로필 설정 모달의 필드·레이아웃 선택·저장 상태가 같은 팔레트를 사용해야 한다.
- 모든 모달을 목록화해 테마를 적용한다. 고정 HTML 모달뿐 아니라 JavaScript가 만드는 VOD/YouTube 플레이어, 댓글 프로필 편집, 일정 편집, 업보 항목·신청 검토, 룰렛 등 동적 모달도 배경, 제목, 설명, 입력, 탭, 빈 상태, 오류/로딩 메시지, 버튼과 닫기 동작을 확인한다. 모달 바깥 클릭으로 닫히지 않는 기존 동작은 보존한다.
- 버튼 역할별로 동일한 체계를 쓴다: 주요 저장/이동, 항목 추가·선택, 외부 링크, 새로고침 같은 보조 동작을 구분하고 기본·hover·pressed·focus-visible·disabled 상태를 정의한다. 디자인 1의 말랑한 젤리 버튼과 고양이 발바닥 닫기 버튼을 새 레이아웃에 그대로 강제하지 않는다. 발바닥 버튼을 쓰는 테마는 이미지가 안 뜨는 경우에도 보이는 닫기 표시, 접근성 이름, hover 툴팁, 터치 가능한 크기를 유지한다.
- 페이지 전체에서 상단/하단 배너, 프로필, 팬 캐릭터·OGQ, 갤러리, 업보, 룰렛, 라이브, 메신저, 다시보기·댓글, YouTube, 노래책, 카페, 캘린더, 푸터까지 누락 없이 확인한다. 각 카드의 중첩 표면, 텍스트 대비, 배지, 구분선, 링크, 입력 요소를 포함한다.
- 의미가 있는 상태 표시의 대비를 확보한다. 인증 스트리머 뱃지처럼 작은 글자도 배경에 묻히지 않게 색상 대비·크기·굵기를 확인한다. LIVE, offline, 빈 목록, loading, stale data, 오류, 성공, 비활성 버튼도 각각 구분할 수 있어야 한다.
- 데스크톱과 모바일에서 그리드 전환, 줄바꿈, 긴 스트리머 이름/방송 제목, 배너, 버튼 배열, 모달 스크롤과 닫기 버튼 위치를 확인한다. 터치 환경에도 hover 없이 상태와 버튼 기능을 알 수 있어야 한다.

### 현재 디자인 1에서 확정한 기준

- 파스텔 만화풍의 밝은 카드와 높은 글자 대비, 스트리머별 강조색(유하띠 파랑)을 사용한다.
- 프로필 인라인 수정 영역은 파스텔 패널·흰 입력창·강조 테두리로 바꾸고, 인증 뱃지는 진한 글자와 선명한 민트 표면으로 표시한다.
- 라이브 카드 안쪽 정보 패널, 방송 제목, 상태 뱃지, offline/loading/error 상태도 바깥 카드와 같은 테마로 표시한다. 미리보기 이미지만 별도 이미지 면으로 둔다.
- 젤리 버튼은 주요/추가/외부/보조 동작을 구분하고 눌림 상태를 제공한다. 모달 닫기 발바닥은 장식 이미지가 로드되지 않아도 ×가 보이는 fallback을 둔다.

### 디자인 참고 자료 (미적용)

- [CodePen — text stickers](https://codepen.io/vii120/pen/vEggVwV): 사용자가 선호한 스티커 타이포그래피 레퍼런스. 파스텔 단어를 크기와 회전을 달리해 흩어 놓고, 두꺼운 흰색 외곽선과 얇은 색상 테두리로 스티커처럼 보이게 한다. hover 시 살짝 커지며 글자 채움이 그라데이션으로 변한다. 향후 테마나 장식 요소를 설계할 때 참고하고, 현재 디자인에는 아직 적용하지 않는다.
- [CodePen — HYPER LINK. a sandbox concept](https://codepen.io/pharaohleap/pen/jEyzRXe): 사용자가 선호한 레트로 커뮤니티 포털 레퍼런스. 접히는 메뉴, 주제별 섹션 탐색, 다중 팔레트와 테마·글자 크기 조절이 특징이다. 팬페이지에 도입할 때는 프로필과 콘텐츠 구조를 유지하면서 메뉴·섹션 제목·팔레트 표현을 참고해 별도 디자인으로 발전시킨다. 정보가 과밀해지지 않도록 모바일과 실제 팬페이지 모듈에 맞춰 조정하며, 현재 디자인에는 아직 적용하지 않는다.

### 완료 전 점검

- 스트리머별 저장 레이아웃이 서로 독립적인지, 새로고침 후에도 유지되는지 확인한다. 설정 미리보기·저장·저장하지 않고 닫기 흐름도 확인한다.
- 새 디자인과 디자인 2를 각각 공개 방문자 및 인증 스트리머 화면에서 확인한다. 데스크톱/모바일, 일반 화면/모든 모달, loading·빈 상태·오류·방송 중·방송 종료 상태를 육안으로 점검한다.
- 선택자와 상태 클래스가 실제 DOM에 존재하는지 확인하고 `git diff --check`, 변경한 JavaScript의 `node --check` 등 해당 정적 검증을 수행한다. 서버 코드를 바꾸지 않은 테마 작업에는 Functions 배포를 하지 않고, Pages 정적 자산이면 배포 완료와 실제 CSS/자산 응답을 확인한다.
