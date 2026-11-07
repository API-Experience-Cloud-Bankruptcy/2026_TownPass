import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Btn, Dots, Screen, T } from '@/components/ui-kit';
import { QUESTIONS } from '@/data';
import type { Identity, Profile } from '@/data/welfare-schema';
import { useApp, type Answers } from '@/lib/app-state';
import { go } from '@/lib/nav';
import { firstUnanswered, markAnswered, prefill } from '@/lib/prefill';
import { questionsFor, type Question } from '@/lib/questions-types';
import { getUserInfo, profileFromAccount, type KnownProfile } from '@/lib/townpass';

const ROC_OFFSET = 1911;

/** Ignore taps this long after the question changes, so a double tap does not answer the next one. */
const SETTLE_MS = 400;

export default function Quiz() {
  const { loaded } = useApp();
  const { resume } = useLocalSearchParams<{ resume?: string }>();
  // Start only after the saved session is restored, so a refresh resumes with the earlier answers.
  return loaded ? <QuizSteps resume={resume === '1'} /> : <Screen title="回答問題">{null}</Screen>;
}

/** Resume at the first question not yet answered; start over when all are answered. */
function firstOpen(questions: Question[], answered: string[] = []): number {
  const i = questions.findIndex((q) => !answered.includes(q.id));
  return i < 0 ? 0 : i;
}

function QuizSteps({ resume }: { resume: boolean }) {
  const { categories, answers, setAnswers, colors } = useApp();
  const questions = useMemo(() => questionsFor(QUESTIONS, categories), [categories]);
  // 「繼續回答」 also reopens skipped questions; 修改答案 resumes after the last one reached.
  const [index, setIndex] = useState(() =>
    resume ? Math.max(firstUnanswered(questions, answers), 0) : firstOpen(questions, answers.answered),
  );
  const [draft, setDraft] = useState<Answers>(answers);
  const [settling, setSettling] = useState(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [known, setKnown] = useState<KnownProfile | null>(null);
  // Bumped to remount the shown question so its local state picks up late Town Pass data.
  const [refresh, setRefresh] = useState(0);
  const q = questions[index];
  const shown = useRef({ questions, q, touched: false });
  if (shown.current.q.id !== q.id) shown.current = { questions, q, touched: false };

  useEffect(() => {
    let live = true;
    getUserInfo().then((account) => {
      if (!live || !account) return;
      const k = profileFromAccount(account);
      const { questions: qs, q: current, touched } = shown.current;
      setKnown(k);
      setDraft((d) => prefill(d, k, qs, touched ? [current.id] : []));
      if (!touched) setRefresh((n) => n + 1);
    });
    return () => {
      live = false;
    };
  }, []);

  function settle() {
    setSettling(true);
    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => setSettling(false), SETTLE_MS);
  }

  useEffect(settle, [index]);
  useEffect(() => () => clearTimeout(settleTimer.current), []);

  function next(updated: Answers) {
    updated = markAnswered(updated, q.id);
    setDraft(updated);
    // Saved every step so going back or refreshing mid-way keeps what was answered.
    setAnswers(updated);
    if (index + 1 < questions.length) setIndex(index + 1);
    else go('/results');
  }

  function skip() {
    next(clearAnswer(q, draft));
  }

  return (
    <Screen title="回答問題">
      <View style={s.top}>
        <Dots total={questions.length} current={index} />
        <T size="small" muted>
          第 {index + 1} 題，共 {questions.length} 題
        </T>
      </View>
      <T size="title" heading={1}>
        {q.title}
      </T>
      {known && fromTownPass(q, draft, known) ? (
        <T size="small" weight="600" color={colors.accent}>
          已帶入台北通資料
        </T>
      ) : null}
      <View style={[s.body, { pointerEvents: settling ? 'none' : 'auto' }]}>
        <QuestionBody
          key={`${q.id}:${refresh}`}
          q={q}
          draft={draft}
          onDone={next}
          onTouch={() => {
            shown.current.touched = true;
            settle();
          }}
        />
        <View style={s.navRow}>
          {index > 0 ? (
            <Btn label="上一題" onPress={() => setIndex(index - 1)} style={s.flex1} />
          ) : null}
          <Btn label="不知道／跳過" variant="ghost" onPress={skip} style={s.flex1} />
        </View>
      </View>
    </Screen>
  );
}

/** The current answer to `q` still equals what Town Pass supplied. */
function fromTownPass(q: Question, a: Answers, k: KnownProfile): boolean {
  const p = a.profile;
  switch (q.kind) {
    case 'birthYear':
      return k.birthYear !== undefined && p.birthYear === k.birthYear;
    case 'single':
      return q.field === 'residentMonths' && k.residentMonths !== undefined && p.residentMonths === k.residentMonths;
    case 'identities':
      return q.options.some((o) => k.identities.includes(o.identity) && p.identities.includes(o.identity));
    case 'identityYesNo':
      return k.identities.includes(q.identity) && p.identities.includes(q.identity);
    default:
      return false;
  }
}

function clearAnswer(q: Question, a: Answers): Answers {
  const profile: Profile = { ...a.profile };
  let unknownIdentities = a.unknownIdentities;
  switch (q.kind) {
    case 'birthYear':
      delete profile.birthYear;
      break;
    case 'single':
      delete profile[q.field];
      break;
    case 'children':
      delete profile.childrenUnder;
      break;
    case 'identities': {
      const ids = q.options.map((o) => o.identity);
      profile.identities = profile.identities.filter((i) => !ids.includes(i));
      unknownIdentities = [...new Set([...unknownIdentities, ...ids])];
      break;
    }
    case 'identityYesNo':
      profile.identities = profile.identities.filter((i) => i !== q.identity);
      unknownIdentities = [...new Set([...unknownIdentities, q.identity])];
      break;
  }
  return { ...a, profile, unknownIdentities };
}

interface BodyProps {
  q: Question;
  draft: Answers;
  onDone: (a: Answers) => void;
  /** The person changed this question's local state without finishing it. */
  onTouch: () => void;
}

function QuestionBody({ q, draft, onDone, onTouch }: BodyProps) {
  const p = draft.profile;
  switch (q.kind) {
    case 'birthYear':
      return (
        <BirthYear
          value={p.birthYear}
          onTouch={onTouch}
          onPick={(y) => onDone({ ...draft, profile: { ...p, birthYear: y } })}
        />
      );
    case 'single':
      return (
        <View style={s.options} role="radiogroup">
          {q.options.map((o) => {
            const selected = Object.entries(o.patch).every(([k, v]) => p[k as keyof Profile] === v);
            return (
              <Btn
                key={o.label}
                label={o.label}
                role="radio"
                selected={selected && p[q.field] !== undefined}
                align="left"
                onPress={() => onDone({ ...draft, profile: { ...p, ...o.patch } })}
              />
            );
          })}
        </View>
      );
    case 'identityYesNo': {
      const has = p.identities.includes(q.identity);
      const answer = (yes: boolean) =>
        onDone({
          ...draft,
          profile: {
            ...p,
            identities: yes ? [...new Set([...p.identities, q.identity])] : p.identities.filter((i) => i !== q.identity),
          },
          unknownIdentities: draft.unknownIdentities.filter((i) => i !== q.identity),
        });
      return (
        <View style={s.options} role="radiogroup">
          <Btn label="有" role="radio" align="left" selected={has} onPress={() => answer(true)} />
          <Btn label="沒有" role="radio" align="left" onPress={() => answer(false)} />
        </View>
      );
    }
    case 'identities':
      return <MultiIdentity q={q} draft={draft} onDone={onDone} onTouch={onTouch} />;
    case 'children':
      return <Children q={q} draft={draft} onDone={onDone} onTouch={onTouch} />;
  }
}

function MultiIdentity({ q, draft, onDone, onTouch }: BodyProps & { q: Extract<Question, { kind: 'identities' }> }) {
  const ids = q.options.map((o) => o.identity);
  const [picked, setPicked] = useState<Identity[]>(draft.profile.identities.filter((i) => ids.includes(i)));
  const finish = (list: Identity[]) =>
    onDone({
      ...draft,
      profile: { ...draft.profile, identities: [...draft.profile.identities.filter((i) => !ids.includes(i)), ...list] },
      unknownIdentities: draft.unknownIdentities.filter((i) => !ids.includes(i)),
    });
  return (
    <View style={s.options}>
      {q.options.map((o) => {
        const on = picked.includes(o.identity);
        return (
          <Btn
            key={o.identity}
            label={o.label}
            role="checkbox"
            icon={on ? '✓' : '○'}
            selected={on}
            align="left"
            onPress={() => {
              onTouch();
              setPicked(on ? picked.filter((i) => i !== o.identity) : [...picked, o.identity]);
            }}
          />
        );
      })}
      <Btn label="以上都沒有" align="left" icon="—" onPress={() => finish([])} />
      <Btn label={picked.length ? `下一步（已選 ${picked.length} 個）` : '下一步'} variant="primary" disabled={!picked.length} onPress={() => finish(picked)} />
    </View>
  );
}

function Children({ q, draft, onDone, onTouch }: BodyProps & { q: Extract<Question, { kind: 'children' }> }) {
  const [picked, setPicked] = useState<number[]>(draft.profile.childrenUnder ?? []);
  const finish = (list: number[]) => onDone({ ...draft, profile: { ...draft.profile, childrenUnder: list } });
  return (
    <View style={s.options}>
      {q.options.map((o) => {
        const on = picked.includes(o.age);
        return (
          <Btn
            key={o.label}
            label={o.label}
            role="checkbox"
            icon={on ? '✓' : '○'}
            selected={on}
            align="left"
            onPress={() => {
              onTouch();
              setPicked(on ? picked.filter((a) => a !== o.age) : [...picked, o.age]);
            }}
          />
        );
      })}
      <Btn label="沒有孩子或都已成年" align="left" icon="—" onPress={() => finish([])} />
      <Btn label="下一步" variant="primary" disabled={!picked.length} onPress={() => finish(picked)} />
    </View>
  );
}

function BirthYear({ value, onPick, onTouch }: { value?: number; onPick: (y: number) => void; onTouch: () => void }) {
  const thisYear = new Date().getFullYear();
  const [decade, setDecadeState] = useState<number | null>(value ? Math.floor(value / 10) * 10 : null);
  const setDecade = (d: number | null) => {
    onTouch();
    setDecadeState(d);
  };
  const decades: number[] = [];
  for (let d = 1920; d <= thisYear; d += 10) decades.push(d);

  if (decade === null) {
    return (
      <View style={s.options}>
        <T muted>先選年代</T>
        <View style={s.grid}>
          {decades.map((d) => (
            <View key={d} style={s.half}>
              <Btn
                label={`${d} 年代`}
                hint={`民國 ${Math.max(d - ROC_OFFSET, 0)} 年前後`}
                onPress={() => setDecade(d)}
              />
            </View>
          ))}
        </View>
      </View>
    );
  }

  const years = Array.from({ length: 10 }, (_, i) => decade + i).filter((y) => y <= thisYear);
  return (
    <View style={s.options}>
      <View style={s.yearHead}>
        <T muted style={s.flex1}>
          {decade} 年代，選出生那一年
        </T>
        <Btn label="換年代" variant="ghost" onPress={() => setDecade(null)} />
      </View>
      <View style={s.grid}>
        {years.map((y) => {
          const roc = y - ROC_OFFSET;
          return (
            <View key={y} style={s.half}>
              <Btn
                label={`${y}${roc > 0 ? `・民國 ${roc}` : ''}`}
                hint={`${thisYear - y} 歲`}
                role="radio"
                selected={value === y}
                onPress={() => onPick(y)}
              />
            </View>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  top: { gap: 6, paddingTop: 8 },
  body: { gap: 16 },
  options: { gap: 10 },
  navRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  flex1: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5 },
  half: { width: '50%', padding: 5 },
  yearHead: { flexDirection: 'row', alignItems: 'center' },
});
