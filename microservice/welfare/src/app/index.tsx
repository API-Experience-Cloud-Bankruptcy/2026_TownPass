import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';

import { Btn, Card, Screen, T } from '@/components/ui-kit';
import { CATEGORIES, CATEGORY_LABEL } from '@/data';
import type { Category } from '@/data/welfare-schema';
import { useApp } from '@/lib/app-state';
import { demoAnswers, isDemo } from '@/lib/demo';
import { interpretSituation, type Interpretation } from '@/lib/intake';
import { canListen, listen } from '@/lib/speech';

export default function Home() {
  const { colors, scale, setCategories, answers, setAnswers, chosen, setChosen } = useApp();
  const { demo: demoParam } = useLocalSearchParams<{ demo?: string }>();
  const { width } = useWindowDimensions();
  const columns = width >= 600 ? 3 : 2;

  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [micReady, setMicReady] = useState(false);
  const [result, setResult] = useState<Interpretation | null>(null);
  const [demo, setDemo] = useState(false);
  const stopRef = useRef<() => void>(() => {});

  useEffect(() => setMicReady(canListen()), []);
  // Set after mount so the static HTML (rendered without a query) matches the first client render.
  useEffect(() => setDemo(isDemo(demoParam)), [demoParam]);

  function loadDemo() {
    setCategories([]);
    setAnswers(demoAnswers());
    setChosen([]);
    router.push('/results');
  }

  function start(categories: Category[]) {
    setCategories(categories);
    router.push('/quiz');
  }

  function toggleMic() {
    if (listening) {
      stopRef.current();
      return;
    }
    setListening(true);
    stopRef.current = listen(
      (t) => setText(t),
      () => setListening(false),
    );
  }

  async function understand() {
    if (!text.trim()) return;
    setResult(await interpretSituation(text));
  }

  function startFromText() {
    if (!result) return;
    const p = result.profile;
    setAnswers({
      ...answers,
      profile: {
        ...answers.profile,
        ...p,
        identities: [...new Set([...answers.profile.identities, ...p.identities])],
      },
    });
    start(result.categories);
  }

  return (
    <Screen title="福利補助自己查" back={false}>
      <View style={s.hero}>
        <T size="display" heading={1}>
          臺北市福利補助自己查
        </T>
      </View>

      {demo ? <Btn label="示範情境：獨居的陳阿嬤" icon="▶" align="left" onPress={loadDemo} /> : null}

      <Card>
        <T size="heading" heading={2}>
          說說你的狀況
        </T>
        <TextInput
          value={text}
          onChangeText={(t) => {
            setText(t);
            setResult(null);
          }}
          multiline
          placeholder="例如：我 78 歲，一個人住，房租付不太出來"
          placeholderTextColor={colors.muted}
          aria-label="說說你的狀況"
          style={[
            s.input,
            {
              fontSize: Math.round(18 * scale),
              color: colors.text,
              borderColor: colors.border,
              backgroundColor: colors.bg,
            },
          ]}
        />
        <View style={s.row}>
          {micReady ? (
            <Btn
              label={listening ? '停止說話' : '用說的'}
              icon={listening ? '■' : '●'}
              selected={listening}
              onPress={toggleMic}
              style={s.flex1}
            />
          ) : null}
          <Btn label="幫我找" variant="primary" onPress={understand} disabled={!text.trim()} style={s.flex1} />
        </View>
        {result ? (
          result.heard.length === 0 && result.categories.length === 0 ? (
            <T muted role="status">
              沒有聽懂，請改從下面的類別選一個。
            </T>
          ) : (
            <View style={s.heard} role="status">
              <T weight="600">我聽到的是</T>
              <View style={s.chips}>
                {result.heard.map((h) => (
                  <View key={h} style={[s.chip, { backgroundColor: colors.accentSoft }]}>
                    <T size="small" color={colors.accent} weight="600">
                      {h}
                    </T>
                  </View>
                ))}
              </View>
              {result.categories.length > 0 ? (
                <T muted size="small">
                  會幫你查：{result.categories.map((c) => CATEGORY_LABEL[c]).join('、')}
                </T>
              ) : null}
              <Btn label="對，開始回答問題" variant="primary" onPress={startFromText} />
            </View>
          )
        ) : null}
      </Card>

      <T size="heading" heading={2} style={s.groupTitle}>
        或選一個類別
      </T>
      <View style={s.grid}>
        {CATEGORIES.map((c) => (
          <Pressable
            key={c.id}
            role="button"
            aria-label={`${c.label}：${c.question}`}
            onPress={() => start([c.id])}
            style={({ pressed }) => [
              s.tile,
              {
                width: `${100 / columns}%` as unknown as number,
                opacity: pressed ? 0.8 : 1,
              },
            ]}>
            <View style={[s.tileInner, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={[s.glyph, { backgroundColor: colors.accentSoft }]}>
                <T size="heading" weight="700" color={colors.accent}>
                  {c.glyph}
                </T>
              </View>
              <T size="heading" weight="700">
                {c.label}
              </T>
              <T size="small" muted>
                {c.question}
              </T>
            </View>
          </Pressable>
        ))}
      </View>

      <Btn
        label="查查看你有哪些福利資格"
        icon="›"
        align="left"
        onPress={() => start([])}
        hint="回答全部問題，看所有類別"
      />
      <Btn label="福利項目一覽表" icon="≡" align="left" onPress={() => router.push('/list')} />
      {chosen.length > 0 ? (
        <Btn
          label={`帶去臨櫃清單（${chosen.length} 項）`}
          icon="✓"
          align="left"
          onPress={() => router.push('/checklist')}
        />
      ) : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  hero: { gap: 6, paddingTop: 8 },
  input: { minHeight: 96, borderWidth: 1.5, borderRadius: 12, padding: 12, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 10 },
  flex1: { flex: 1 },
  heard: { gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 },
  groupTitle: { marginTop: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 },
  tile: { padding: 6 },
  tileInner: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 4, minHeight: 132 },
  glyph: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
});
