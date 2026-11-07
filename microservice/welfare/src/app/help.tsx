import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Btn, Card, Screen, T } from '@/components/ui-kit';
import { useApp } from '@/lib/app-state';
import { chosenItems } from '@/lib/chosen';
import { describeProfile } from '@/lib/describe';
import { call } from '@/lib/townpass';

type Helper = 'family' | 'chief' | 'social' | 'hotline';

const HELPERS: { id: Helper; label: string; sub: string; greeting: string }[] = [
  { id: 'family', label: '家人或朋友', sub: '傳訊息給信任的人', greeting: '想請你幫我看一下可以申請哪些補助。' },
  { id: 'chief', label: '里長或里幹事', sub: '住家附近就能問', greeting: '里長您好，我是本里的居民，想請您幫忙確認可以申請的補助。' },
  { id: 'social', label: '社工', sub: '區公所或社福中心', greeting: '社工您好，想請您幫我確認可以申請的福利和要準備的資料。' },
  { id: 'hotline', label: '打 1999', sub: '臺北市民當家熱線', greeting: '您好，我想詢問可以申請的福利補助。' },
];

export default function Help() {
  const { colors, answers, chosen, categories } = useApp();
  const [helper, setHelper] = useState<Helper | null>(null);
  const [consent, setConsent] = useState(false);
  const [notice, setNotice] = useState('');
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare(Platform.OS === 'web' && typeof navigator !== 'undefined' && 'share' in navigator), []);
  const { items, picked } = useMemo(() => chosenItems(chosen, answers, categories), [chosen, answers, categories]);

  const h = HELPERS.find((x) => x.id === helper);
  const said = describeProfile(answers.profile);
  const summary = h
    ? [
        h.greeting,
        said.length ? `我的狀況：${said.join('、')}。` : '',
        items.length
          ? `${picked ? '我想申請' : '我可能符合'}：\n${items.map((i, n) => `${n + 1}. ${i.name}（${i.agency}）`).join('\n')}`
          : '我還不確定可以申請什麼，想請你幫我查。',
        '（用「臺北市福利補助自己查」整理，資料以各機關公告為準）',
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  async function copy() {
    try {
      await navigator.clipboard.writeText(summary);
      setNotice('已複製，可以貼到訊息裡傳出去');
    } catch {
      setNotice('沒辦法自動複製，請長按上面的文字自己複製');
    }
  }

  async function share() {
    try {
      await navigator.share({ title: '請幫我申請福利補助', text: summary });
      setNotice('');
    } catch {
      // The person cancelled the share sheet.
    }
  }


  return (
    <Screen title="請人幫我" hideHelp>
      <View style={s.top}>
        <T size="title" heading={1}>
          想請誰幫你？
        </T>
      </View>
      <View style={s.options} role="radiogroup">
        {HELPERS.map((x) => {
          const on = helper === x.id;
          return (
            <Pressable
              key={x.id}
              role="radio"
              aria-checked={on}
              aria-label={`${x.label}，${x.sub}`}
              onPress={() => {
                setHelper(x.id);
                setNotice('');
              }}
              style={[
                s.helper,
                { borderColor: on ? colors.accent : colors.border, backgroundColor: on ? colors.accentSoft : colors.surface },
              ]}>
              <T size="heading" weight="700" color={on ? colors.accent : colors.text}>
                {x.label}
              </T>
              <T size="small" muted>
                {x.sub}
              </T>
            </Pressable>
          );
        })}
      </View>

      {h ? (
        <>
          {helper === 'hotline' ? (
            <Btn label="撥打 1999" icon="☎" variant="primary" role="link" onPress={() => call('1999')} />
          ) : null}
          <Card>
            <T weight="700">{helper === 'hotline' ? '電話裡可以這樣說' : '要給對方看的內容'}</T>
            <T selectable style={[s.summary, { backgroundColor: colors.sunken }]}>
              {summary}
            </T>
            {helper !== 'hotline' ? (
              <>
                <Pressable
                  role="checkbox"
                  aria-checked={consent}
                  aria-label="我同意把上面的內容給我選的人看"
                  onPress={() => setConsent(!consent)}
                  style={s.consent}>
                  <View
                    style={[
                      s.box,
                      { borderColor: consent ? colors.accent : colors.text, backgroundColor: consent ? colors.accent : 'transparent' },
                    ]}>
                    {consent ? (
                      <T weight="700" color={colors.accentText}>
                        ✓
                      </T>
                    ) : null}
                  </View>
                  <T style={s.flex1}>我同意把上面的內容給我選的人看</T>
                </Pressable>
                <View style={s.row}>
                  {canShare ? (
                    <Btn label="分享" variant="primary" disabled={!consent} onPress={share} style={s.flex1} />
                  ) : null}
                  <Btn label="複製文字" variant={canShare ? 'secondary' : 'primary'} disabled={!consent} onPress={copy} style={s.flex1} />
                </View>
                {notice ? (
                  <T role="status" color={colors.accent} weight="600">
                    {notice}
                  </T>
                ) : null}
              </>
            ) : null}
          </Card>
          {items.length === 0 ? <Btn label="先查查看可以申請什麼" onPress={() => router.push('/')} /> : null}
        </>
      ) : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  top: { paddingTop: 8 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  helper: { flexGrow: 1, flexBasis: '45%', minHeight: 88, borderWidth: 2, borderRadius: 14, padding: 14, gap: 2 },
  summary: { borderRadius: 10, padding: 12 },
  consent: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 },
  box: { width: 30, height: 30, borderRadius: 8, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  flex1: { flex: 1, minWidth: 130 },
});
