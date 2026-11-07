import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:town_pass/page/city_service/model/trending_service_model.dart';
import 'package:town_pass/service/local_llm_service.dart';
import 'package:town_pass/util/web_message_handler/tp_web_message_handler.dart';

/// These expensive native capabilities are available only to the configured microservice.
class LlmMessageHandler extends TPWebMessageHandler {
  LlmMessageHandler(this.name, {LocalLlmService? service, String? allowedUrl})
    : _service = service ?? LocalLlmService.instance,
      _allowedUrl = allowedUrl ?? TrendingServiceModel.subsidyUrl;
  @override
  final String name;
  final LocalLlmService _service;
  final String _allowedUrl;

  static bool isAllowedOrigin(
    String configured,
    WebUri? source,
    bool mainFrame,
  ) {
    final expected = Uri.tryParse(configured);
    final actual = source == null ? null : Uri.tryParse(source.toString());
    return mainFrame &&
        expected != null &&
        actual != null &&
        ['http', 'https'].contains(expected.scheme) &&
        expected.host.isNotEmpty &&
        actual.scheme == expected.scheme &&
        actual.host == expected.host &&
        actual.port == expected.port;
  }

  @override
  Future<void> handle({
    required Object? message,
    required WebUri? sourceOrigin,
    required bool isMainFrame,
    required Function(WebMessage reply)? onReply,
  }) async {
    final id = message is Map && message['requestId'] is String
        ? message['requestId'] as String
        : '';
    void reply(Map<String, Object?> data) =>
        onReply?.call(replyWebMessage(data: {'requestId': id, ...data}));
    void error(String code, String text) => reply({
      'error': {'code': code, 'message': text},
    });
    if (!isAllowedOrigin(_allowedUrl, sourceOrigin, isMainFrame)) {
      error('FORBIDDEN', '此頁面無法使用裝置端模型');
      return;
    }
    if (id.isEmpty || id.length > 100) {
      error('INVALID_REQUEST', '請求格式不正確');
      return;
    }
    try {
      switch (name) {
        case 'llm_status':
          await _service.inspectCache();
          reply(_service.status);
        case 'llm_prepare':
          await _service.prepare();
          reply(_service.status);
        case 'llm_interpret':
          final request = validateInterpretationRequest(message);
          reply(await _service.interpret(request));
      }
    } on LlmInputTooLongException {
      error('INPUT_TOO_LONG', '這段內容較長，請分成兩段補充；原文仍會保留。');
    } on FormatException {
      error('INVALID_OUTPUT', '模型未能整理這段內容，請換個說法或直接選擇');
    } on StateError {
      if (_service.status['state'] != 'ready') {
        error('MODEL_UNAVAILABLE', '請先準備裝置端模型');
      } else {
        error('BUSY', '正在整理上一段內容，請稍候再試');
      }
    } catch (_) {
      error('MODEL_UNAVAILABLE', '裝置端模型無法使用，請檢查下載狀態後重試');
    }
  }
}
