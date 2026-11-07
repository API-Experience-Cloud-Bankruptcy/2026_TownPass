import 'dart:async';

import 'package:flutter/foundation.dart';

/// Tracks only the main document. A failed image must not hide a usable page.
class TPWebLoadState extends ChangeNotifier {
  final Duration timeout;
  Timer? _timer;
  bool _disposed = false;
  bool loading = false;
  String? error;

  TPWebLoadState({this.timeout = const Duration(seconds: 25)});

  void begin() {
    if (_disposed) return;
    _timer?.cancel();
    loading = true;
    error = null;
    _timer = Timer(timeout, () => fail('連線等候過久，請確認網路與服務是否正常，再試一次。'));
    notifyListeners();
  }

  void complete() {
    if (_disposed) return;
    _timer?.cancel();
    loading = false;
    // WebKit may emit load-stop after an error. Keep the retry screen visible.
    notifyListeners();
  }

  void fail(String message, {bool mainFrame = true}) {
    if (_disposed || !mainFrame) return;
    _timer?.cancel();
    loading = false;
    error = message;
    notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _timer?.cancel();
    super.dispose();
  }
}
