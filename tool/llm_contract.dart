// Local diagnostic JSONL protocol; uses the production prompt and validation.
import 'dart:convert';
import 'dart:io';

import 'package:town_pass/service/llm_interpretation.dart';

Future<void> main() async {
  await for (final line
      in stdin.transform(utf8.decoder).transform(const LineSplitter())) {
    try {
      final command = jsonDecode(line) as Map<String, dynamic>;
      final request = validateInterpretationRequest(command['request']);
      final raw = command['raw'];
      final toolResponse = command['toolResponse'];
      if (command['controlText'] is String) {
        stdout.writeln(
          jsonEncode({
            'ok': true,
            'parsed': parseTextControl(
              command['controlText'] as String,
              request,
            ),
          }),
        );
      } else if (toolResponse is Map) {
        stdout.writeln(
          jsonEncode({
            'ok': true,
            'parsed': parseToolInterpretation(
              toolResponse['name'] as String,
              Map<String, dynamic>.from(toolResponse['args'] as Map),
              request,
            ),
          }),
        );
      } else if (raw is String) {
        stdout.writeln(
          jsonEncode({'ok': true, 'parsed': parseInterpretation(raw, request)}),
        );
      } else {
        stdout.writeln(
          jsonEncode({
            'ok': true,
            'direct': directBackgroundInterpretation(request),
            'tools': interpretationTools(request),
            'instruction': interpretationInstructionForAttempt(
              command['attempt'] as int? ?? 0,
            ),
            'payload': buildModelRequest(
              request,
              minimal: command['minimal'] == true,
            ),
          }),
        );
      }
    } catch (error) {
      stdout.writeln(jsonEncode({'ok': false, 'error': error.toString()}));
    }
  }
}
