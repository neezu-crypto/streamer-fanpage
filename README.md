# 스트리머 팬페이지

스트리머 게임시리즈의 인증 스트리머 팬페이지입니다. GitHub Pages로 정적 화면을 배포하고, Firebase Cloud Functions를 통해 공유 RTDB의 스트리머 인증 정보를 확인하고 전용 RTDB의 페이지 데이터를 관리합니다.

- 정적 사이트: `https://neezu-crypto.github.io/streamer-fanpage/`
- Firebase 프로젝트: `soop-stock-market`
- 팬페이지·고점체크 RTDB: `streamer-fanpage-rtdb` (`us-central1`, 서버 전용)
- 공유 RTDB: `soop-stock-market-default-rtdb` (인증·관리자 권한·고점체크 구독 데이터)
- Functions codebase: `fanpage`
- Functions 배포 시 변경한 함수만 codebase와 함께 지정합니다. 관리자 통계 기능은 `firebase deploy --only functions:fanpage:streamerFanPageBootstrap,functions:fanpage:streamerFanPageAdminStats --project soop-stock-market`으로 배포합니다. 다시보기 시청 통계와 구독 게이트는 `firebase deploy --only functions:fanpage:streamerFanPageViewerStats,functions:fanpage:streamerFanPageViewerSubscription,functions:fanpage:streamerFanPageAdminViewerSubscriptionRequests --project soop-stock-market`으로 배포합니다.

팬페이지 콘텐츠·최근 방문·다시보기·관리자 집계와 고점체크 분석 결과·캐시·대기열·사용량은 전용 RTDB에 저장합니다. 공유 RTDB에는 Firebase 사용자/스트리머 인증, 관리자 권한, 고점체크 구독·신청처럼 다른 서비스와 공유하는 데이터만 둡니다. 전용 RTDB의 브라우저 읽기·쓰기는 차단하고 데이터 접근은 서버 callable로 처리합니다. 최근 방문은 UID별 최대 8개로 보관하고 `streamerFanPageRecent` callable은 로그인한 본인의 목록만 반환합니다. 팬페이지 일별 조회·순방문은 집계값으로 저장하며, 관리자 callable도 방문자별 식별 정보는 반환하지 않습니다. `streamerFanPageAdminStats`는 공유 RTDB의 `adminCenter/adminUids/{uid}`를 서버에서 확인하고 관리자에게 집계만 반환합니다. 고점체크 작업 결과는 요청 UID 해시와 대조해 본인만 조회할 수 있습니다. 다시보기 목록은 24개씩 서버 callable로 페이지를 읽고, 전체 갱신은 임시 세대에 분할 저장한 뒤 검증을 마치면 활성 세대를 바꿉니다. 갱신은 인증 스트리머 본인 또는 관리자만 실행할 수 있습니다. 각 항목은 SOOP 임베드 모달로 열고, 재생이 지원되지 않으면 SOOP 원본 링크를 제공합니다.

인증 스트리머가 팬페이지에 접속하면 서버가 인증을 확인해 하루 한 번 관리자 접속 알림을 보냅니다. 새 이벤트에는 공개 닉네임·SOOP 아이디·접속 시각만 기록하고, Firebase UID는 넣지 않습니다. Discord 알림도 공개 닉네임·SOOP 아이디·접속 시각만 전달합니다. 일반 이용자는 이벤트 경로를 읽을 수 없습니다. 과거 이벤트에 UID가 포함되어 있을 수 있으며 같은 관리자 전용 접근 제한을 적용합니다.

`스트리머 고점체크(viewer-stats.html)`는 서버가 SOOP 공개 VOD 목록과 별별통계 그래프를 조회해 최고·최저 시점을 계산합니다. VOD 목록·키워드 검색 요청에서 이용자의 IP를 SOOP에 직접 전달하지 않습니다. 다시보기 카드에는 최고·최저 시점을 표시하고 해당 지점에서 바로 재생할 수 있습니다. 구독자는 기간별 최고 시청 순간, 같은 날 두 스트리머 비교, 키워드로 직접 고른 2~5명의 고점 비교를 사용할 수 있습니다. 구독은 개인 계정에 적용되며 별풍선 후원을 관리자가 수동 확인해 30일 권한을 승인합니다. 구독 신청·만료 데이터와 VOD 분석 캐시는 서버 전용 RTDB에 저장합니다. 공개 정적 파일에는 최고·최저 시점과 확인 시각만 포함합니다. 사용량 제한과 요청 결과는 UID 해시로 관리하며 관리자 화면에는 최근 30일 합계만 표시하고, 개별 작업 결과는 요청 계정만 확인할 수 있습니다.

오늘의 후원 스트리머 광고는 하루 별풍선 10개, 1~30일 신청이며, SOOP 후원 알림을 자동 감시하거나 자동 승인하지 않습니다. 신청자가 후원 완료 알리기를 전달하면 관리자가 후원 내역을 확인해 광고를 수동 승인합니다. 완료 알림이 없는 신청은 기존 정책대로 7일 후 만료됩니다. 광고 신청·대기·슬롯 예약은 `streamerFanPageSponsorRequests/`, `streamerFanPageSponsorPending/`, `streamerFanPageSponsorPlacementClaims/`에, 공개 중 광고만 `streamerFanPageSponsorAds/`에 서버 전용으로 저장합니다.

고점체크 사용량은 `streamerFanPageViewerStatsLimits/{uidHash}/recentUsageByDay/{YYYY-MM-DD}`에 최근 30일 일별로 계측합니다. 관리자 화면에서 RTDB·SOOP API·callable payload 크기와 Cloud Functions 실행량, 예상 비용을 확인할 수 있습니다. 비용은 RTDB 다운로드와 Cloud Functions 2세대 실행료 기준 USD 추정이며, 공유 무료 한도·할인·인터넷 송신·Cloud Tasks·RTDB 저장 비용은 제외합니다. GitHub Actions 정적 변환의 RTDB 읽기량도 IAM 인증된 reporter로 같은 집계에 전달합니다. 브라우저의 SOOP 직접 조회와 GitHub Pages 전송량은 별도 집계입니다. 계측 전 과거의 바이트 사용량은 제공하지 않습니다.
