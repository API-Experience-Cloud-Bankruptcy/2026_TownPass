import 'package:flutter/material.dart';
import 'package:town_pass/gen/assets.gen.dart';

abstract final class TrendingServiceModel {
  /// 「補助專區」微服務網址（subsidy-web/）。建置時指定：
  /// 開發：flutter run --dart-define=SUBSIDY_URL=http://<電腦區網 IP>:5173
  /// 未指定時使用正式網址。
  static const String subsidyUrl = String.fromEnvironment(
    'SUBSIDY_URL',
    defaultValue: 'https://2026-town-pass.vercel.app/',
  );

  static List<TrendingService> get serviceList {
    return [
      TrendingService(
        title: '找地點',
        icon: Assets.svg.iconLocationSearch.svg(),
        url: 'https://taipei-pass-service.vercel.app/surrounding-service/',
      ),
      TrendingService(
        icon: Assets.svg.iconDashboardReports.svg(),
        title: '市政資訊儀表板',
        url: 'https://dashboard.gov.taipei/',
        forceWebViewTitle: '市政資訊儀表板',
      ),
      TrendingService(
        icon: Assets.svg.iconLocationSearch.svg(),
        title: '施工資訊',
        url: '',
      ),
      TrendingService(
        icon: Assets.svg.iconSubsidy.svg(),
        title: '補助專區',
        url: subsidyUrl,
        forceWebViewTitle: '補助專區',
      ),
      // 在此列表後加入新熱門按鈕
      // add new trending service button here
    ];
  }
}

class TrendingService {
  final Widget icon;
  final String title;
  final String url;
  final String? forceWebViewTitle;

  const TrendingService({
    required this.icon,
    required this.title,
    required this.url,
    this.forceWebViewTitle,
  });
}
