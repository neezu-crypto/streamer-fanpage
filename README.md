# 스트리머 팬페이지

스트리머 게임시리즈의 인증 스트리머 팬페이지입니다. GitHub Pages로 정적 화면을 배포하고, Firebase Cloud Functions를 통해 공유 RTDB의 스트리머 인증 정보를 확인하고 페이지 데이터를 관리합니다.

- 정적 사이트: `https://neezu-crypto.github.io/streamer-fanpage/`
- Firebase 프로젝트: `soop-stock-market`
- Functions codebase: `fanpage`
- Functions 배포 시 변경한 함수만 codebase와 함께 지정합니다. 관리자 통계 기능은 `firebase deploy --only functions:fanpage:streamerFanPageBootstrap,functions:fanpage:streamerFanPageAdminStats --project soop-stock-market`으로 배포합니다. 다시보기 시청 통계와 구독 게이트는 `firebase deploy --only functions:fanpage:streamerFanPageViewerStats,functions:fanpage:streamerFanPageViewerSubscription,functions:fanpage:streamerFanPageAdminViewerSubscriptionRequests --project soop-stock-market`으로 배포합니다.

팬페이지, 수동 갱신한 SOOP 다시보기 목록, 집계는 각각 `streamerFanPages/`, `streamerFanPageVods/`, `streamerFanPageStats/`에 서버 전용으로 저장하며 브라우저는 RTDB를 직접 읽거나 쓰지 않습니다. 최근 방문 목록은 이 브라우저의 `localStorage`에 최대 8개까지만 저장하고 계정과 동기화하지 않습니다. 팬페이지 조회 통계는 관리자와 해당 스트리머 본인의 열람을 제외한 조회 합계만 기록하며 방문자 식별값이나 순방문자 수는 수집하지 않습니다. 통계 조회 callable은 `adminCenter/adminUids/{uid}`를 서버에서 확인해 관리자에게만 데이터를 반환합니다. 다시보기 목록은 24개씩 서버 callable로 페이지를 읽고, 전체 갱신은 임시 세대에 분할 저장한 뒤 검증을 마치면 활성 세대를 바꿉니다. 갱신은 인증 스트리머 본인 또는 관리자만 실행할 수 있습니다. 각 항목은 SOOP 임베드 모달로 열고, 재생이 지원되지 않으면 SOOP 원본 링크를 제공합니다.

인증 스트리머가 팬페이지에 접속하면 서버가 인증 UID를 확인하고, 공개 닉네임·SOOP 아이디·접속 시각을 하루 한 번 관리자 접속 알림으로 보냅니다. 이 알림 기록에는 Firebase UID를 넣지 않습니다.

`스트리머 고점체크(viewer-stats.html)`는 SOOP 다시보기별 별별통계에서 1분 단위 유저 수 그래프를 가져와 최고·최저 시점을 계산합니다. 다시보기 카드에는 최고·최저 시점만 표시하고, 각 시점에서 바로 재생할 수 있습니다. 구독자는 최근 1년 분석으로 7일·30일·90일·365일 최고 시청 순간을 확인하고, 같은 날 두 스트리머 비교에서 평균 대비 상승률을 볼 수 있습니다. 키워드 고점 비교에서는 직접 고른 2~5명의 다시보기 검색 결과를 비교하며, 스트리머별 최신 결과 최대 10개만 분석합니다. 구독은 Google·Kakao 연결 또는 스트리머 인증을 마친 개인 계정에 적용됩니다. 운영자 방송국에 별풍선 33개를 후원하면 관리자가 후원 내역을 수동 확인한 뒤 구독을 승인합니다. 신청 등록만으로 후원 알림을 감시하거나 자동 승인하지 않으며, 후원 완료 알리기는 관리자 확인을 돕는 신청자 신호입니다. 무료 체험·자동 갱신은 없고, 조기 갱신은 남은 기간에 30일을 더합니다. 구독 신청·만료 데이터는 `streamerFanPageViewerSubscriptions/`, 신청 이력은 `streamerFanPageViewerSubscriptionRequests/`, 대기 목록은 `streamerFanPageViewerSubscriptionPending/`에 서버 전용으로 저장합니다. 성공한 VOD 통계는 `streamerFanPageViewerStatsCache/{soopId}/{vodId}`에 영구 보관해 재분석을 막습니다. GitHub Actions는 Workload Identity Federation을 통해 이 캐시를 하루 한 번 읽고 `static-data/viewer-stats/{soopId}.json`으로 공개 가능한 최고·최저 시점만 GitHub Pages에 배포합니다. 평균 시청자 수 등 구독 전용 지표와 원본 그래프는 정적 파일에 포함하지 않습니다. 카드가 정적 파일에서 통계를 찾으면 서버 callable을 호출하지 않으며, 아직 정적 파일에 없는 항목만 사용자가 직접 분석을 요청할 때 기존 callable 경로를 사용합니다. 구독자 평균 지표 비교는 계속 callable에서 권한을 확인합니다. 기간 분석은 필요한 때만 실행되고 브라우저 통계 요청은 최대 3개로 제한합니다. 요청 한도는 등급별로 다르며, 최신 기준은 `functions/viewer-stats-policy.js`의 `VIEWER_STATS_RATE_LIMITS`에 있습니다. 제한 카운터는 UID 해시와 현재 시간대의 창만 `streamerFanPageViewerStatsLimits/`에 저장합니다.

오늘의 후원 스트리머 광고는 하루 별풍선 10개, 1~30일 신청이며, SOOP 후원 알림을 자동 감시하거나 자동 승인하지 않습니다. 신청자가 후원 완료 알리기를 전달하면 관리자가 후원 내역을 확인해 광고를 수동 승인합니다. 완료 알림이 없는 신청은 기존 정책대로 7일 후 만료됩니다. 광고 신청·대기·슬롯 예약은 `streamerFanPageSponsorRequests/`, `streamerFanPageSponsorPending/`, `streamerFanPageSponsorPlacementClaims/`에, 공개 중 광고만 `streamerFanPageSponsorAds/`에 서버 전용으로 저장합니다.

고점체크 사용량은 `streamerFanPageViewerStatsLimits/{uidHash}/recentUsageByDay/{YYYY-MM-DD}`에 최근 30일 일별로 계측합니다. 관리자 화면에서 RTDB·SOOP API·callable payload 크기와 Cloud Functions 실행량, 예상 비용을 확인할 수 있습니다. 비용은 RTDB 다운로드와 Cloud Functions 2세대 실행료 기준 USD 추정이며, 공유 무료 한도·할인·인터넷 송신·Cloud Tasks·RTDB 저장 비용은 제외합니다. GitHub Actions 정적 변환의 RTDB 읽기량도 IAM 인증된 reporter로 같은 집계에 전달합니다. 브라우저의 SOOP 직접 조회와 GitHub Pages 전송량은 별도 집계입니다. 계측 전 과거의 바이트 사용량은 제공하지 않습니다.
