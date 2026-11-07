import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:get/get.dart';
import 'package:town_pass/page/city_service/model/trending_service_model.dart';
import 'package:town_pass/page/city_service/widget/trending_service_widget.dart';
import 'package:town_pass/util/tp_route.dart';
import 'package:town_pass/util/tp_web_view.dart';

void main() {
  tearDown(Get.reset);

  test('trending list has the subsidy entry using SUBSIDY_URL', () {
    final items = TrendingServiceModel.serviceList.where((item) => item.title == '補助專區').toList();

    expect(items, hasLength(1));
    expect(items.single.url, TrendingServiceModel.subsidyUrl);
    expect(items.single.forceWebViewTitle, '補助專區');
  });

  testWidgets('tapping the subsidy entry opens the web view route', (tester) async {
    WebViewArgument? opened;

    await tester.pumpWidget(
      GetMaterialApp(
        initialRoute: '/',
        getPages: [
          GetPage(
            name: '/',
            page: () => const Scaffold(
              body: SingleChildScrollView(child: TrendingServiceWidget()),
            ),
          ),
          GetPage(
            name: TPRoute.webView,
            page: () {
              opened = Get.arguments as WebViewArgument;
              return const Scaffold(body: Text('web view'));
            },
          ),
        ],
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('熱門'), findsOneWidget);
    expect(find.text('補助專區'), findsOneWidget);

    await tester.tap(find.text('補助專區'));
    await tester.pumpAndSettle();

    if (TrendingServiceModel.subsidyUrl.isEmpty) {
      // Without --dart-define=SUBSIDY_URL the entry is inert by design.
      expect(opened, isNull);
      expect(find.text('web view'), findsNothing);
    } else {
      expect(find.text('web view'), findsOneWidget);
      expect(opened?.url, Uri.parse(TrendingServiceModel.subsidyUrl).toString());
      expect(opened?.forceTitle, '補助專區');
    }
  });
}
