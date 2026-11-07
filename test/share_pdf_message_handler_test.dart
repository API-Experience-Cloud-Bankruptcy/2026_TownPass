import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:town_pass/util/web_message_handler/share_pdf_message_handler.dart';

void main() {
  final pdf = Uint8List.fromList(
    latin1.encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n'),
  );
  Map<String, Object> payload() => {
    'base64': base64Encode(pdf),
    'filename': '福利通行動單.pdf',
    'userInitiated': true,
  };

  Future<Map<String, dynamic>> handle(
    SharePdfMessageHandler handler,
    Object? data, {
    bool mainFrame = true,
  }) async {
    Map<String, dynamic>? result;
    await handler.handle(
      message: data,
      sourceOrigin: null,
      isMainFrame: mainFrame,
      onReply: (reply) => result = (jsonDecode(reply.data)['data'] as Map)
          .cast<String, dynamic>(),
    );
    return result!;
  }

  test(
    'passes original bytes and filename, reports presentation only',
    () async {
      final handler = SharePdfMessageHandler(
        share: (bytes, filename) async {
          expect(bytes, orderedEquals(pdf));
          expect(filename, '福利通行動單.pdf');
          return true;
        },
      );
      expect(await handle(handler, payload()), {'status': 'presented'});
    },
  );

  test('false and exceptions never claim successful delivery', () async {
    expect(
      await handle(
        SharePdfMessageHandler(share: (_, _) async => false),
        payload(),
      ),
      {'status': 'cancelled_or_unavailable'},
    );
    expect(
      await handle(
        SharePdfMessageHandler(
          share: (_, _) async => throw StateError('unavailable'),
        ),
        payload(),
      ),
      {'status': 'failed', 'reason': 'native_share_failed'},
    );
  });

  test('rejects invalid bytes, base64, paths, oversized files and subframes without plugin call', () async {
    var calls = 0;
    final handler = SharePdfMessageHandler(
      share: (_, _) async {
        calls++;
        return true;
      },
    );
    final invalid = [
      null,
      {...payload(), 'filename': '../secret.pdf'},
      {...payload(), 'filename': 'evil\n.pdf'},
      {...payload(), 'base64': '%%%='},
      {...payload(), 'base64': base64Encode(latin1.encode('text'))},
      {
        ...payload(),
        'base64': base64Encode(latin1.encode('%PDF-1.7\ntruncated')),
      },
      {
        ...payload(),
        'base64':
            'A' * (((SharePdfMessageHandler.maxPdfBytes + 2) ~/ 3) * 4 + 4),
      },
      {...payload(), 'userInitiated': false},
    ];
    for (final data in invalid) {
      expect((await handle(handler, data))['status'], 'failed');
    }
    expect(
      (await handle(handler, payload(), mainFrame: false))['status'],
      'failed',
    );
    expect(calls, 0);
  });

  test(
    'blocks simultaneous native share and releases lock afterwards',
    () async {
      final completer = Completer<bool>();
      final handler = SharePdfMessageHandler(share: (_, _) => completer.future);
      final first = handle(handler, payload());
      expect(await handle(handler, payload()), {
        'status': 'failed',
        'reason': 'busy',
      });
      completer.complete(true);
      expect(await first, {'status': 'presented'});
      expect(await handle(handler, payload()), {'status': 'presented'});
    },
  );
}
