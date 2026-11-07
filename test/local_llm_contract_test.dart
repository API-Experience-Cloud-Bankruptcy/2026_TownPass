import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:town_pass/service/local_llm_service.dart';
import 'package:town_pass/util/web_message_handler/llm_message_handler.dart';

void main() {
  final request = <String, dynamic>{
    'requestId': 'test-1',
    'input': '我今年65歲，想幫媽媽找長照',
    'context': {
      'stage': 'questions',
      'choices': <Object>[],
      'situations': [
        {'id': 'care', 'label': '長照'},
      ],
      'question': {
        'id': 'age',
        'kind': 'number',
        'min': 0,
        'max': 130,
        'options': <Object>[],
      },
      'allowedFacts': [
        {'field': 'age', 'min': 0, 'max': 130},
        {
          'field': 'region',
          'options': [
            {'value': '臺北市'},
            {'value': '其他縣市'},
          ],
        },
      ],
    },
  };
  test('only configured main frame origin can use model', () {
    expect(
      LlmMessageHandler.isAllowedOrigin(
        'https://example.com/app/',
        WebUri('https://example.com'),
        true,
      ),
      true,
    );
    for (final origin in [
      'https://example.com.evil.test',
      'http://example.com',
      'https://example.com:8443',
      'null',
    ]) {
      expect(
        LlmMessageHandler.isAllowedOrigin(
          'https://example.com/app/',
          WebUri(origin),
          true,
        ),
        false,
      );
    }
    expect(
      LlmMessageHandler.isAllowedOrigin(
        'https://example.com',
        WebUri('https://example.com'),
        false,
      ),
      false,
    );
    expect(
      LlmMessageHandler.isAllowedOrigin(
        '',
        WebUri('https://example.com'),
        true,
      ),
      false,
    );
  });
  test('limits requests before native work', () {
    expect(validateInterpretationRequest(request)['input'], request['input']);
    expect(
      () => validateInterpretationRequest({...request, 'input': 'x' * 2001}),
      throwsFormatException,
    );
    expect(
      () => validateInterpretationRequest({...request, 'context': {}}),
      throwsFormatException,
    );
  });
  test('rejects hallucinated IDs, missing evidence and mixed schemas', () {
    for (final bad in [
      {'kind': 'answer', 'choiceId': 'invented', 'evidence': '我'},
      {'kind': 'answer', 'numberValue': 65, 'evidence': '不存在的原文'},
      {'kind': 'answer', 'numberValue': 131, 'evidence': '我'},
      {'kind': 'answer', 'numberValue': 65, 'choiceId': 'x', 'evidence': '我'},
      {'kind': 'clarify', 'facts': []},
      {
        'kind': 'situation',
        'situationIds': ['invented'],
        'facts': [],
        'details': [],
        'uncertainties': [],
      },
      {
        'kind': 'situation',
        'situationIds': [],
        'facts': [],
        'details': ['捏造家庭狀況'],
        'uncertainties': [],
      },
    ]) {
      expect(
        () => parseInterpretation(jsonEncode(bad), request),
        throwsFormatException,
      );
    }
  });
  test('valid model answer echoes native request ID', () {
    expect(
      parseInterpretation(
        '{"kind":"answer","numberValue":65,"evidence":"65歲"}',
        request,
      ),
      {
        'requestId': 'test-1',
        'kind': 'answer',
        'numberValue': 65,
        'evidence': '65歲',
      },
    );
  });
  test('retains multiple person facts as proposals without applying', () {
    final parsed = parseInterpretation(
      jsonEncode({
        'kind': 'situation',
        'situationIds': ['care'],
        'facts': [
          {
            'field': 'age',
            'value': 65,
            'subject': 'self',
            'subjectLabel': '我',
            'evidence': '我今年65歲',
          },
        ],
        'details': ['想幫媽媽找長照'],
        'uncertainties': ['媽媽年齡待確認'],
      }),
      request,
    );
    expect(parsed['kind'], 'situation');
  });
  test('requires explicit legal household status proof', () {
    final incomeRequest = {
      ...request,
      'input': '我收入變少，戶籍在桃園。',
      'context': {
        ...(request['context'] as Map),
        'allowedFacts': [
          {
            'field': 'household_type',
            'options': [
              {'value': 'low_income'},
              {'value': 'mid_low_income'},
              {'value': 'general'},
            ],
          },
        ],
      },
    };
    expect(
      () => parseInterpretation(
        jsonEncode({
          'kind': 'situation',
          'situationIds': [],
          'facts': [
            {
              'field': 'household_type',
              'value': 'low_income',
              'subject': 'self',
              'subjectLabel': '我',
              'evidence': '我收入變少',
            },
          ],
          'details': [],
          'uncertainties': [],
        }),
        incomeRequest,
      ),
      throwsFormatException,
    );
  });
  test('rejects decimal age and unsupported person label', () {
    expect(
      () => parseInterpretation(
        '{"kind":"answer","numberValue":65.5,"evidence":"65歲"}',
        request,
      ),
      throwsFormatException,
    );
    expect(
      () => parseInterpretation(
        jsonEncode({
          'kind': 'situation',
          'situationIds': ['care'],
          'facts': [
            {
              'field': 'age',
              'value': 65,
              'subject': 'self',
              'subjectLabel': '爸爸',
              'evidence': '我今年65歲',
            },
          ],
          'details': [],
          'uncertainties': [],
        }),
        request,
      ),
      throwsFormatException,
    );
  });
}
