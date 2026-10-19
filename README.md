# 스트리머 팬페이지

스트리머 게임시리즈의 인증 스트리머 팬페이지입니다. GitHub Pages로 정적 화면을 배포하고, Firebase Cloud Functions를 통해 공유 RTDB의 스트리머 인증 정보를 확인하고 페이지 데이터를 관리합니다.

- 정적 사이트: `https://neezu-crypto.github.io/streamer-fanpage/`
- Firebase 프로젝트: `soop-stock-market`
- Functions codebase: `fanpage`
- Functions 배포 시 변경한 함수만 codebase와 함께 지정합니다. 관리자 통계 기능은 `firebase deploy --only functions:fanpage:streamerFanPageBootstrap,functions:fanpage:streamerFanPageAdminStats --project soop-stock-market`으로 배포합니다. 다시보기 시청 통계와 구독 게이트는 `firebase deploy --only functions:fanpage:streamerFanPageViewerStats,functions:fanpage:streamerFanPageViewerSubscription,functions:fanpage:streamerFanPageAdminViewerSubscriptionRequests --project soop-stock-market`으로 배포합니다.

팬페이지, 최근 방문 기록, 수동 갱신한 SOOP 다시보기 목록, 통계 집계는 각각 `streamerFanPages/`, `streamerFanPageRecentVisits/`, `streamerFanPageVods/`, `streamerFanPageStats/`에 저장되며 브라우저는 RTDB를 직접 읽거나 쓰지 않습니다. 통계 도입 이후의 페이지 열람을 서버에서 집계하며 관리자와 해당 스트리머 본인의 열람은 제외합니다. 방문 식별자는 스트리머별·한국 날짜별 해시로 저장하고 최근 30일 이후의 일별 방문 키를 정리합니다. 통계 조회 callable은 `adminCenter/adminUids/{uid}`를 서버에서 확인해 관리자에게만 데이터를 반환합니다. 다시보기 목록은 24개씩 서버 callable로 페이지를 읽고, 전체 갱신은 임시 세대에 분할 저장한 뒤 검증을 마치면 활성 세대를 바꿉니다. 갱신은 인증 스트리머 본인 또는 관리자만 실행할 수 있습니다. 각 항목은 SOOP 임베드 모달에서 열리고, 재생이 지원되지 않으면 SOOP 원본 링크를 사용할 수 있습니다.

`스트리머 고점체크(viewer-stats.html)`는 SOOP 다시보기별 별별통계에서 1분 단위 유저 수 그래프를 가져와 최고·최저 시점을 계산합니다. 다시보기 카드에는 최고·최저 시점만 표시하고, 각 시점에서 바로 재생할 수 있습니다. 구독자는 최근 1년 분석으로 7일·30일·90일·365일 최고 시청 순간을 확인하고, 같은 날 두 스트리머 비교에서 평균 대비 상승률을 볼 수 있습니다. 키워드 고점 비교에서는 직접 고른 2~5명의 다시보기 검색 결과를 비교하며, 스트리머별 최신 결과 최대 10개만 분석합니다. 구독은 Google·Kakao 연결 또는 스트리머 인증을 마친 개인 계정에 적용됩니다. 운영자 방송국에 별풍선 33개를 후원하면 신청 등록 즉시 1시간 자동 감시가 시작되고, 후원 완료 알리기는 선택 사항입니다. 관리자 브라우저 확장 프로그램이 후원자 SOOP 아이디와 별풍선 수량을 대조해 유일하게 일치하는 신청을 자동 승인하며, 완료 알림 버튼을 누르지 않아도 됩니다. 1시간이 지나도 신청은 취소되지 않고 관리자 확인 대기 상태로 남으며, 여러 신청이 겹치면 관리자 수동 검수로 남깁니다. 무료 체험·자동 갱신은 없고, 조기 갱신은 남은 기간에 30일을 더합니다. 구독 신청·만료 데이터는 `streamerFanPageViewerSubscriptions/`, 신청 이력은 `streamerFanPageViewerSubscriptionRequests/`, 대기 목록은 `streamerFanPageViewerSubscriptionPending/`에 서버 전용으로 저장합니다. 분석 결과는 RTDB에 저장하지 않습니다. 기간 분석은 필요한 때만 실행되고 브라우저 통계 요청은 최대 3개로 제한합니다. 계산 결과는 함수 인스턴스 메모리에 10분 캐시합니다. 요청 한도는 등급별로 다르며, 최신 기준은 `functions/viewer-stats-policy.js`의 `VIEWER_STATS_RATE_LIMITS`에 있습니다. 제한 카운터는 UID 해시와 현재 시간대의 창만 `streamerFanPageViewerStatsLimits/`에 저장합니다.

오늘의 후원 스트리머 광고는 하루 별풍선 10개, 1~30일 신청이며, 신청 등록 후 1시간 동안 관리자 브라우저 확장 프로그램이 SOOP 알림의 발신 아이디와 수량을 대조합니다. 두 정보가 유일하게 일치하면 완료 알리기 버튼이나 알림 시각 대조 없이 서버가 광고 슬롯을 활성화하고 승인합니다. 1시간이 지나거나 일치 신청이 여러 건이면 자동 승인을 멈추며, 완료 알리기는 선택적인 수동 확인 요청 신호입니다. 완료 알림이 없는 신청은 기존 정책대로 7일 후 만료됩니다. 광고 신청·대기·슬롯 예약은 `streamerFanPageSponsorRequests/`, `streamerFanPageSponsorPending/`, `streamerFanPageSponsorPlacementClaims/`에, 공개 중 광고만 `streamerFanPageSponsorAds/`에 서버 전용으로 저장합니다.
