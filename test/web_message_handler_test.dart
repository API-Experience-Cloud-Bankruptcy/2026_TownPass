import 'dart:convert';

import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:town_pass/util/web_message_handler/tp_web_message_handler.dart';

Future<List<Map<String, dynamic>>> _handle(
  TPWebMessageHandler handler,
  Object? message,
) async {
  final replies = <Map<String, dynamic>>[];
  await handler.handle(
    message: message,
    sourceOrigin: null,
    isMainFrame: true,
    onReply: (WebMessage reply) => replies.add(jsonDecode(reply.data as String) as Map<String, dynamic>),
  );
  return replies;
}

void main() {
  final cases = <String, List<Object?>>{
    'phone_call': [null, '', 1999, true, <String, dynamic>{}, '[1999'],
    'launch_map': [null, 42, ['https://maps.google.com'], 'http://[::1'],
    'open_link': [null, 42, false, <String, dynamic>{'url': 'https://example.com'}],
  };
  final handlers = <String, TPWebMessageHandler>{
    'phone_call': PhoneCallMessageHandler(),
    'launch_map': LaunchMapWebMessageHandler(),
    'open_link': OpenLinkMessageHandler(),
  };

  for (final entry in cases.entries) {
    group(entry.key, () {
      for (final message in entry.value) {
        test('replies false once for invalid data ${jsonEncode(message)}', () async {
          final replies = await _handle(handlers[entry.key]!, message);
          expect(replies, [
            {'name': entry.key, 'data': false},
          ]);
        });
      }
    });
  }
}
