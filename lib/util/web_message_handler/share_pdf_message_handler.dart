import 'dart:convert';
import 'dart:typed_data';
import 'dart:ui' show Rect;

import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:printing/printing.dart';
import 'package:town_pass/util/web_message_handler/tp_web_message_handler.dart';

typedef PdfShare = Future<bool> Function(Uint8List bytes, String filename);

/// Only requests the operating system's share UI. No recipient is selected here.
class SharePdfMessageHandler extends TPWebMessageHandler {
  SharePdfMessageHandler({PdfShare? share})
    : _share =
          share ??
          ((bytes, filename) => Printing.sharePdf(
            bytes: bytes,
            filename: filename,
            // iPad requires a popover anchor inside its source view.
            bounds: const Rect.fromLTWH(0, 0, 1, 1),
          ));

  static const maxPdfBytes = 10 * 1024 * 1024;
  final PdfShare _share;
  bool _busy = false;

  @override
  String get name => 'share_pdf';

  @override
  Future<void> handle({
    required Object? message,
    required WebUri? sourceOrigin,
    required bool isMainFrame,
    required Function(WebMessage reply)? onReply,
  }) async {
    void reply(String status, [String? reason]) => onReply?.call(
      replyWebMessage(data: {'status': status, 'reason': ?reason}),
    );

    if (!isMainFrame || message is! Map || message['userInitiated'] != true) {
      reply('failed', 'invalid_request');
      return;
    }
    if (_busy) {
      reply('failed', 'busy');
      return;
    }
    final filename = message['filename'];
    final encoded = message['base64'];
    if (filename is! String ||
        filename.isEmpty ||
        filename.length > 120 ||
        filename.startsWith('.') ||
        filename.trim() != filename ||
        !filename.toLowerCase().endsWith('.pdf') ||
        RegExp(r'[/\\\x00-\x1f\x7f<>:"|?*]').hasMatch(filename) ||
        encoded is! String ||
        encoded.isEmpty ||
        encoded.length > ((maxPdfBytes + 2) ~/ 3) * 4 ||
        encoded.length % 4 != 0 ||
        !RegExp(r'^[A-Za-z0-9+/]*={0,2}$').hasMatch(encoded)) {
      reply('failed', 'invalid_pdf');
      return;
    }
    Uint8List bytes;
    try {
      bytes = base64Decode(encoded);
      // Reject empty/truncated/non-PDF payloads before calling a native plugin.
      final header = latin1.decode(bytes.take(8).toList());
      final tail = latin1.decode(
        bytes.skip(bytes.length > 1024 ? bytes.length - 1024 : 0).toList(),
      );
      if (bytes.length > maxPdfBytes ||
          !RegExp(r'^%PDF-[12]\.[0-9]').hasMatch(header) ||
          !RegExp(r'%%EOF[\x00\x09\x0a\x0c\x0d\x20]*$').hasMatch(tail)) {
        reply('failed', 'invalid_pdf');
        return;
      }
    } on FormatException {
      reply('failed', 'invalid_pdf');
      return;
    }
    _busy = true;
    try {
      final presented = await _share(bytes, filename);
      // iOS/Android acknowledge the request, without tracking cancellation or delivery.
      reply(presented ? 'presented' : 'cancelled_or_unavailable');
    } catch (_) {
      reply('failed', 'native_share_failed');
    } finally {
      _busy = false;
    }
  }
}
