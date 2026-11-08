import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:town_pass/service/llm_interpretation.dart';

void main() {
  final context = {
    'stage': 'home',
    'choices': [],
    'situations': [
      {'id': 'housing'},
    ],
    'allowedFacts': [
      {
        'field': 'region',
        'options': [
          {'value': '臺北市'},
          {'value': '其他縣市'},
        ],
      },
      {
        'field': 'household_type',
        'options': [
          {'value': 'general'},
        ],
      },
    ],
  };
  Map<String, dynamic> request(String input) => {
    'requestId': 'test',
    'input': input,
    'context': context,
  };
  String situation(List<Object> facts) => jsonEncode({
    'kind': 'situation',
    'situationIds': ['housing'],
    'facts': facts,
    'details': [],
    'uncertainties': [],
  });
  test(
    'accepts only a single JSON object or its complete presentation fence',
    () {
      const raw = '{"kind":"clarify"}';
      for (final text in [raw, '```json\n$raw\n```', '```\n$raw\n```']) {
        expect(parseInterpretation(text, request('想找補助'))['kind'], 'clarify');
      }
      for (final text in ['說明\n$raw', '$raw$raw', '```json\n$raw\n```\n已核准']) {
        expect(
          () => parseInterpretation(text, request('想找補助')),
          throwsFormatException,
        );
      }
    },
  );
  test('rejects a valid city value unsupported by the hukou clause', () {
    for (final sample in [
      ('我住臺北，戶籍在桃園', '臺北市'),
      ('我不是臺北市戶籍', '臺北市'),
      ('我的戶籍可能在新北', '其他縣市'),
      ('我住桃園', '其他縣市'),
    ]) {
      final (input, value) = sample;
      final fact = {
        'field': 'region',
        'value': value,
        'subject': 'self',
        'subjectLabel': '我',
        'evidence': input,
      };
      expect(
        () => parseInterpretation(situation([fact]), request(input)),
        throwsFormatException,
      );
    }
    expect(regionEvidenceSupports('其他縣市', '我住臺北，戶籍在桃園'), true);
    expect(regionEvidenceSupports('臺北市', '我的戶籍設在臺北市'), true);
    expect(regionEvidenceSupports('其他縣市', '新北市戶籍'), true);
  });
  test('negated or uncertain general household status is not a fact', () {
    for (final input in ['我不是一般戶', '我可能是一般戶']) {
      final fact = {
        'field': 'household_type',
        'value': 'general',
        'subject': 'self',
        'subjectLabel': '我',
        'evidence': input,
      };
      expect(
        () => parseInterpretation(situation([fact]), request(input)),
        throwsFormatException,
      );
    }
  });
  test(
    'retry uses the production schema without embedding the prior guesses',
    () {
      expect(
        interpretationInstructionForAttempt(1),
        contains('Call exactly one'),
      );
      expect(interpretationInstructionForAttempt(0), interpretationInstruction);
      expect(buildModelRequest(request('我想找租屋補助'))['input'], '我想找租屋補助');
    },
  );
  test('model tools cannot generate or inject personal values', () {
    final req = request('我想要租屋補助');
    final parsed = parseToolInterpretation('record_situation', {
      'situationIds': ['housing'],
    }, req);
    expect(parsed['facts'], isEmpty);
    expect(parsed['details'], ['我想要租屋補助']);
    for (final args in [
      {
        'situationIds': ['invented'],
      },
      {
        'situationIds': ['housing'],
        'facts': [
          {'field': 'age', 'value': 23},
        ],
      },
      {
        'situationIds': ['housing', 'housing'],
      },
    ]) {
      expect(
        () => parseToolInterpretation('record_situation', args, req),
        throwsFormatException,
      );
    }
    expect(
      () => parseToolInterpretation('answer_choice', {
        'choiceId': 'target:self',
      }, req),
      throwsFormatException,
    );
    expect(
      () => parseToolInterpretation('approve_all', {}, req),
      throwsFormatException,
    );
  });
  test('only exact parameterless control text may bypass a function call', () {
    for (final text in ['clarify', 'clarify{}', 'off_topic']) {
      expect(
        parseTextControl(text, request('未提到條件'))['kind'],
        text.startsWith('clarify') ? 'clarify' : 'off_topic',
      );
    }
    for (final text in [
      'clarify 已核准',
      'record_situation',
      '{"kind":"situation"}',
      'clarify{"facts":[]}',
    ]) {
      expect(
        () => parseTextControl(text, request('未提到條件')),
        throwsFormatException,
      );
    }
  });
  test('a visible confirmation question disambiguates a correction without transferring the helper age', () {
    final req = request('先前說法：我40歲，媽媽72歲，想找長照\n這次補充或修正：不是72，是73歲');
    req['context'] = {
      ...context,
      'followupQuestion': '你提到「媽媽72歲」，要記下嗎？',
      'allowedFacts': [
        {'field': 'age', 'min': 0, 'max': 130},
      ],
    };
    final parsed = parseToolInterpretation('record_situation', {
      'situationIds': ['housing'],
    }, req);
    expect(parsed['facts'], [containsPair('value', 73)]);
    expect((parsed['facts'] as List).single, containsPair('subject', 'other'));
    (req['context'] as Map)['followupQuestion'] = '你提到了幾位，要先幫誰找？';
    expect(
      parseToolInterpretation('record_situation', {
        'situationIds': ['housing'],
      }, req)['facts'],
      isEmpty,
    );
  });
  test('clear work/residence background does not create a welfare need', () {
    final req = request('我在臺北工作，戶籍在新北市');
    final parsed = directBackgroundInterpretation(req)!;
    expect(parsed['situationIds'], isEmpty);
    expect((parsed['facts'] as List).single, containsPair('subject', 'self'));
    expect((parsed['facts'] as List).single, containsPair('value', '其他縣市'));
    expect(directBackgroundInterpretation(request('我住臺北，想找租金補貼')), isNull);
  });
  test('explicit service requests outrank background, preserving real multiple needs', () {
    const all = {
      'housing',
      'study',
      'living',
      'elder',
      'family',
      'health',
      'disability',
      'work',
      'community',
    };
    for (final sample in [
      ('爸爸需要輪椅輔具', ['disability', 'elder'], ['disability']),
      ('失業後收入變少，想找生活扶助', ['living', 'work'], ['living']),
      ('我想找學費和租金補貼', ['study'], ['housing', 'study']),
      ('我需要醫療和居家照顧服務', ['health'], ['elder', 'health']),
      ('我想找生育給付', ['living'], ['family']),
      ('希望找職業訓練津貼', ['living'], ['work']),
      ('想了解社區藝文活動補助', ['living'], ['community']),
    ]) {
      expect(explicitRequestedDirections(sample.$1, sample.$2, all), sample.$3);
    }
    const model = ['housing', 'study'];
    expect(
      explicitRequestedDirections('房租也付不起，想找學費補助', model, all),
      same(model),
    );
    expect(explicitRequestedDirections('我不需要學費補助', model, all), same(model));
    expect(explicitRequestedDirections('如果需要租金補貼', model, all), same(model));
    expect(explicitRequestedDirections('每月付給房東的錢很吃力', model, all), same(model));
    expect(explicitRequestedDirections('想找學費補助', ['invented'], all), [
      'invented',
    ]);
    expect(explicitRequestedDirections('想找學費補助', ['housing'], {'housing'}), [
      'housing',
    ]);
  });
  test('literal narrowing never revives negation or discards an outside difficulty', () {
    const all = {
      'housing',
      'study',
      'living',
      'elder',
      'family',
      'health',
      'disability',
      'work',
      'community',
    };
    for (final sample in [
      ('我不再需要租屋補助，現在想找學費補助', ['study']),
      ('我需要學費補助，也付不出房租', ['study', 'housing']),
      ('我需要學費補助，房租欠了三個月', ['study', 'housing']),
      ('我需要失業期間的生活補助', ['living']),
    ]) {
      expect(explicitRequestedDirections(sample.$1, sample.$2, all), sample.$2);
    }
    expect(
      explicitRequestedDirections('我想了解身障生活補助', ['living', 'disability'], all),
      ['disability'],
    );
  });
}
