/// Evidence-bound proposals only. No model output, eligibility decisions, native
/// runtime, or conversation history is consulted here. Callers must still ask the
/// person to confirm every selected proposal.
List<Map<String, Object?>> extractFactCandidates(String input) {
  if (input.trim().isEmpty ||
      input.length > 2000 ||
      _unsafeInput.hasMatch(input)) {
    return [];
  }
  if (_nonAssertion.hasMatch(input) || _uncertain.hasMatch(input)) return [];
  // Retractions can refer backwards across commas. Never keep an earlier value
  // merely because its uncertainty/negation was in a different split clause.
  if (_correction.hasMatch(input) || input.trimLeft().startsWith('先前說法')) {
    return _correctedAge(input);
  }
  if (_retraction.hasMatch(input)) return [];

  final candidates = <Map<String, Object?>>[];
  final identities = <String>{};
  var start = 0;
  for (final boundary in _boundaries.allMatches(input)) {
    _addClause(
      input.substring(start, boundary.start),
      boundary.group(0)!.contains(RegExp(r'[?？]')),
      candidates,
      identities,
      allowGraduated: !_continuingStudy.hasMatch(input),
    );
    start = boundary.end;
  }
  _addClause(
    input.substring(start),
    false,
    candidates,
    identities,
    allowGraduated: !_continuingStudy.hasMatch(input),
  );
  // Losing an arbitrary suffix could hide another person's contradictory fact.
  if (candidates.length > 8) return [];
  _resolveOnlySelf(input, candidates);
  final resolvedIdentities = <String>{};
  candidates.removeWhere(
    (fact) => !resolvedIdentities.add(
      '${fact['field']}\u0000${fact['value']}\u0000${fact['subject']}\u0000${fact['subjectLabel']}',
    ),
  );
  return candidates;
}

final _unsafeInput = RegExp(
  r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u200b-\u200f\u202a-\u202e\u2060-\u206f]',
);
final _nonAssertion = RegExp(
  r'''[「」『』“”‘’"'`<>]|假設|假如|如果|假裝|例如|舉例|比方|想像|忽略規則|輸出JSON|回傳JSON''',
  caseSensitive: false,
);
final _correction = RegExp(
  r'不對|更正|改成|其實|剛剛|我是說|實際(?:上)?(?:是|為)|正確(?:是|應為)|才對'
  r'|(?:不是|並非)[^，,。；;\n]{0,80}[，,]\s*(?:是|而是)'
  r'|(?:^|[，,])\s*不是\s*[，,]',
);
final _boundaries = RegExp(r'[，,。；;！？!?\n\r]+');
final _uncertain = RegExp(
  r'不確定|不知道|不清楚|可能|也許|好像|應該|聽說|據說|似乎|大概|大約|差不多|左右|上下|將近|不一定|是不是|對嗎|是嗎|或者|或是|還是(?!在學|學生|就學|在讀)|未確認|未滿|不到',
);
final _retraction = RegExp(
  r'(?:不是|並非|沒有)[^，,。；;\n]{0,12}(?:歲|年齡|年紀|這個|那個|該身分|這個身分|媽媽|爸爸|母親|父親)'
  r'|(?:戶籍|設籍|戶口)[^，,。；;\n]{0,8}(?:不在|不是)'
  r'|(?:不是|不在|並非)[^，,。；;\n]{0,8}(?:戶籍|戶口)'
  r'|(?:未|還沒|沒有|不是|尚未)[^，,。；;\n]{0,6}(?:核定|取得)'
  r'|(?:不具|沒有|未取得|未核定|尚未核定)[^，,。；;\n]{0,8}(?:資格|身分|低收入戶|一般戶)'
  r'|(?:^|[，,])\s*(?:但|但是|可是|不過)?(?:不對|不是|不是的|並非)\s*[。!！]?$'
  r'|(?:^|[，,])\s*(?:但|但是|可是|不過)?(?:不是|不對|並非)\s*[0-9０-９零〇一二兩三四五六七八九十百]+(?:歲)?\s*[。!！]?$',
);
final _lead = RegExp(r'^(?:另外|還有|而且|此外|至於)\s*');
final _actor = RegExp(
  r'^(我(?:的)?(?:媽媽|爸爸|母親|父親)|我本人|我自己|本人|我|這位申請人|申請人|申請者|媽媽|爸爸|母親|父親|她|他|對方|自己)\s*',
);
const _numeral = r'[0-9０-９零〇一二兩三四五六七八九十百]+';
final _age = RegExp(
  '^(?:的)?(?:年齡(?:是|為)?|年紀(?:是|為)?|今年|目前|現在)?\\s*'
  '(?:已滿|年滿)?\\s*($_numeral)\\s*歲(?:了)?\$',
);
const _city =
    r'臺北市?|台北市?|其他縣市|外縣市|新北市?|桃園(?:市|縣)?|臺中市?|台中市?|臺南市?|台南市?|高雄市?|基隆市?|新竹(?:市|縣)?|苗栗縣?|彰化縣?|南投縣?|雲林縣?|嘉義(?:市|縣)?|屏東縣?|宜蘭縣?|花蓮縣?|臺東縣?|台東縣?|澎湖縣?|金門縣?|連江縣?';
final _regionAfter = RegExp(
  '^(?:的)?(?:戶籍|戶口)(?:地|所在地)?(?:在|是|為|位於|設在)?\\s*($_city)\$',
);
final _registered = RegExp('^(?:目前|現在)?(?:已)?設籍(?:於|在)?\\s*($_city)\$');
final _regionBefore = RegExp('^(?:是|為)?\\s*($_city)(?:的)?(?:戶籍|戶口)\$');
final _household = RegExp(
  r'^(?:是|為|屬於|身分是|家戶身分是|已核定(?:為|是)?|已被核定(?:為|是)?|經(?:政府|社會局|區公所)?核定(?:為|是)?|是(?:政府)?(?:已)?核定的)'
  r'\s*(中低收入戶|低收入戶|一般戶)(?:身分|資格)?(?:了)?$',
);
final _studentTrue = RegExp(
  r'^(?:目前|現在)?(?:仍然|仍|還)?(?:是(?:在學)?學生|在學(?:中)?|就學中|正在就學|正在讀書|仍在就學|還在就學|還在讀書)$',
);
final _studentFalse = RegExp(
  r'^(?:目前|現在)?(?:不是學生|不是在學學生|已經不是學生|不再是學生|不在學|沒有在學|沒有就學|不再就學|已畢業不再就學|已經畢業不再就學)(?:了)?$',
);
final _graduated = RegExp(r'^(?:目前|現在)?已(?:經)?畢業(?:了)?$');
final _continuingStudy = RegExp(
  r'就讀|研究生|研究所|大學|(?:還|仍|繼續|重新|又|再)(?:是學生|在學|就學|讀書)',
);
final _otherPeople = RegExp(
  r'媽媽|爸爸|母親|父親|申請人|申請者|家人|父母|孩子|小孩|朋友|先生|太太|配偶|兒子|女兒|哥哥|姐姐|姊姊|弟弟|妹妹|阿公|阿嬤|祖父|祖母|房東|房客|老師|同學|同事|客戶|別人|有人|某人|對方|他|她|你|我們|大家|全家|幫|替|代辦'
  r'|(?:我|本人)(?:和|與|跟|及|、)',
);

void _resolveOnlySelf(String input, List<Map<String, Object?>> candidates) {
  if (_otherPeople.hasMatch(input)) return;
  final self = RegExp(r'^(?:另外|還有|而且|此外|至於)?\s*(我本人|我自己|本人|我)')
      .firstMatch(input.trimLeft());
  if (self == null) return;
  final hasSelfFact = candidates.any((fact) => fact['subject'] == 'self');
  final residence = RegExp(
    '^(?:我本人|我自己|本人|我)(?:目前|現在)?(?:(?:住(?:在)?|居住(?:在)?)(?:$_city)|在(?:$_city)(?:工作|上班|租屋))[，,。；;]',
  );
  if (!hasSelfFact && !residence.hasMatch(input.trimLeft())) return;
  for (final fact in candidates) {
    if (fact['subject'] == 'unclear' && fact['subjectLabel'] == '') {
      fact['subject'] = 'self';
      fact['subjectLabel'] = self.group(1)!;
    }
  }
}

List<Map<String, Object?>> _correctedAge(String input) {
  final plain = RegExp(
    '^(我|本人|媽媽|爸爸|母親|父親|申請人)\\s*(?:剛(?:剛)?(?:說|提到))?\\s*($_numeral)\\s*歲\\s*[，,]\\s*'
    '((?:更正(?:為|成)|改(?:為|成)|正確是)\\s*($_numeral)\\s*歲)[。!！]?\$',
  ).firstMatch(input.trim());
  if (plain != null) {
    final old = _integerAge(plain.group(2)!);
    final next = _integerAge(plain.group(4)!);
    if (old == null || old > 130 || next == null || next > 130) return [];
    final label = plain.group(1)!;
    return [
      {
        'field': 'age',
        'value': next,
        'subject': ['我', '本人'].contains(label)
            ? 'self'
            : label == '申請人'
            ? 'applicant'
            : 'other',
        'subjectLabel': label,
        'evidence': plain.group(3)!,
      },
    ];
  }
  final wrapped = RegExp(r'^先前說法[：:]([^\n]+)\n這次補充或修正[：:]([^\n]+)$')
      .firstMatch(input.trim());
  if (wrapped == null) return [];
  final previous = wrapped.group(1)!.trim();
  final current = wrapped.group(2)!.trim();
  if (current.length > 200 ||
      _correction.hasMatch(previous) ||
      _retraction.hasMatch(previous) ||
      RegExp(r'戶籍|設籍|戶口|學生|在學|就學|低收入戶|一般戶').hasMatch(previous)) {
    return [];
  }
  final mentions = RegExp(_actor.pattern.substring(1))
      .allMatches(previous)
      .map((match) => match.group(1)!)
      .toSet();
  // A correction cannot pick a person out of an unresolved multi-person history.
  if (mentions.length > 1 ||
      RegExp(r'家人|父母|孩子|小孩|朋友|先生|太太|配偶|兒子|女兒|房東|房客|老師|同學|同事|別人|有人|某人|幫|替')
          .hasMatch(previous)) {
    return [];
  }
  final oldFacts = extractFactCandidates(previous);
  if (oldFacts.length != 1 || oldFacts.single['field'] != 'age') return [];
  final correction = RegExp(
    '^(?:不是|不對)\\s*($_numeral)(?:\\s*歲)?\\s*[，,]\\s*(?:是|而是|更正為|改成)\\s*($_numeral)\\s*歲[。!！]?\$',
  ).firstMatch(current);
  if (correction == null) return [];
  final old = _integerAge(correction.group(1)!);
  final next = _integerAge(correction.group(2)!);
  if (old != oldFacts.single['value'] || next == null || next > 130) return [];
  return [
    {...oldFacts.single, 'value': next, 'evidence': current},
  ];
}

void _addClause(
  String original,
  bool question,
  List<Map<String, Object?>> candidates,
  Set<String> identities, {
  required bool allowGraduated,
}) {
  final evidence = original.trim();
  if (question ||
      evidence.isEmpty ||
      evidence.length > 200 ||
      _uncertain.hasMatch(evidence)) {
    return;
  }
  // The entire remaining clause must match one supported assertion. In
  // particular, another person's name elsewhere must never supply this subject.
  var clause = evidence.replaceFirst(_lead, '');
  final actor = _actor.firstMatch(clause);
  final rawLabel = actor?.group(1) ?? '';
  // 「我的媽媽」裡的「媽媽」仍是原文子字串，避免另一次直接稱
  // 「媽媽」時被前端拆成兩位；不把任意姓名或代名詞合併成同一人。
  final label = rawLabel.replaceFirst(RegExp(r'^我(?:的)?(?=媽媽|爸爸|母親|父親)'), '');
  var subject = 'unclear';
  if (['我', '本人', '我本人', '我自己'].contains(label)) {
    subject = 'self';
  } else if (RegExp(r'媽媽|爸爸|母親|父親').hasMatch(label)) {
    subject = 'other';
  } else if (['申請人', '這位申請人', '申請者'].contains(label)) {
    subject = 'applicant';
  }
  if (actor != null) clause = clause.substring(actor.end).trim();

  String? field;
  Object? value;
  final age = _age.firstMatch(clause);
  final city =
      _regionAfter.firstMatch(clause)?.group(1) ??
      _registered.firstMatch(clause)?.group(1) ??
      _regionBefore.firstMatch(clause)?.group(1);
  final household = _household.firstMatch(clause)?.group(1);
  if (age != null) {
    final number = _integerAge(age.group(1)!);
    if (number == null || number < 0 || number > 130) return;
    field = 'age';
    value = number;
  } else if (city != null) {
    field = 'region';
    value = RegExp(r'^(?:臺北|台北)市?$').hasMatch(city) ? '臺北市' : '其他縣市';
  } else if (household != null) {
    field = 'household_type';
    value = switch (household) {
      '低收入戶' => 'low_income',
      '中低收入戶' => 'mid_low_income',
      _ => 'general',
    };
  } else if (_studentTrue.hasMatch(clause)) {
    field = 'is_student';
    value = true;
  } else if (_studentFalse.hasMatch(clause) ||
      (allowGraduated && _graduated.hasMatch(clause))) {
    field = 'is_student';
    value = false;
  }
  if (field == null) return;
  // Identical repeated assertions need only one proposal. Conflicting values
  // stay separate so the confirmation flow can ask which value is correct.
  final identity = '$field\u0000$value\u0000$subject\u0000$label';
  if (!identities.add(identity)) return;
  candidates.add({
    'field': field,
    'value': value,
    'subject': subject,
    'subjectLabel': label,
    'evidence': evidence,
  });
}

int? _integerAge(String text) {
  final arabic = text.replaceAllMapped(
    RegExp(r'[０-９]'),
    (match) =>
        String.fromCharCode(match.group(0)!.codeUnitAt(0) - 0xff10 + 0x30),
  );
  if (RegExp(r'^\d{1,3}$').hasMatch(arabic)) return int.parse(arabic);
  const digits = {
    '零': 0,
    '〇': 0,
    '一': 1,
    '二': 2,
    '兩': 2,
    '三': 3,
    '四': 4,
    '五': 5,
    '六': 6,
    '七': 7,
    '八': 8,
    '九': 9,
  };
  if (digits.containsKey(text)) return digits[text];
  final tens = RegExp(r'^([一二兩三四五六七八九])?十([一二三四五六七八九])?$').firstMatch(text);
  if (tens != null) {
    return (digits[tens.group(1)] ?? 1) * 10 + (digits[tens.group(2)] ?? 0);
  }
  final hundreds = RegExp(
    r'^([一二兩三四五六七八九])百(?:零([一二三四五六七八九])|([一二兩三四五六七八九])十([一二三四五六七八九])?)?$',
  ).firstMatch(text);
  if (hundreds == null) return null;
  return digits[hundreds.group(1)]! * 100 +
      (digits[hundreds.group(2)] ?? 0) +
      (digits[hundreds.group(3)] ?? 0) * 10 +
      (digits[hundreds.group(4)] ?? 0);
}
