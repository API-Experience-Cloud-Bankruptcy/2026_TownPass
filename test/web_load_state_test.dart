import 'package:flutter_test/flutter_test.dart';
import 'package:town_pass/util/tp_web_load_state.dart';

void main() {
  testWidgets(
    'timeout offers recovery, retry clears error and successful load cancels timer',
    (tester) async {
      final state = TPWebLoadState();
      state.begin();
      await tester.pump(const Duration(seconds: 26));
      expect(state.error, isNotNull);
      expect(state.loading, isFalse);
      state.begin();
      expect(state.error, isNull);
      state.complete();
      await tester.pump(const Duration(seconds: 26));
      expect(state.error, isNull);
      state.dispose();
    },
  );

  test('subresource failure does not hide page, main-document failure survives load-stop', () {
    final state = TPWebLoadState();
    state.begin();
    state.fail('image failed', mainFrame: false);
    expect(state.error, isNull);
    expect(state.loading, isTrue);
    state.fail('document failed');
    state.complete();
    expect(state.error, 'document failed');
    state.dispose();
  });

  testWidgets('closing the page cancels timeout and ignores late callbacks', (
    tester,
  ) async {
    final state = TPWebLoadState();
    state.begin();
    state.dispose();
    await tester.pump(const Duration(seconds: 26));
    state.fail('late callback');
    state.complete();
    expect(tester.takeException(), isNull);
  });
}
