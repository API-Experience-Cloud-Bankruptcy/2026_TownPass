import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Btn, Card, Screen, Section, styles as kit, T } from '@/components/ui-kit';
import { useApp } from '@/lib/app-state';
import { chosenItems, mergedDocuments } from '@/lib/chosen';
import { go } from '@/lib/nav';

export default function Checklist() {
  const { colors, chosen, answers, categories } = useApp();
  const { items, picked } = useMemo(() => chosenItems(chosen, answers, categories), [chosen, answers, categories]);
  const docs = useMemo(() => mergedDocuments(items), [items]);
  const [ready, setReady] = useState<string[]>([]);
  const [canPrint, setCanPrint] = useState(false);
  useEffect(() => setCanPrint(Platform.OS === 'web' && typeof window !== 'undefined' && 'print' in window), []);

  const counters = [...new Set(items.map((i) => i.apply.counter).filter((c): c is string => !!c))];

  if (items.length === 0) {
    return (
      <Screen title="帶去臨櫃">
        <T size="title" heading={1}>
          還沒有要辦的項目
        </T>
        <Btn label="先查查看可以申請什麼" variant="primary" onPress={() => go('/')} />
      </Screen>
    );
  }

  return (
    <Screen title="帶去臨櫃">
      <View style={s.top}>
        <T size="display" heading={1}>
          帶去臨櫃的清單
        </T>
        <T muted>{picked ? `你選了 ${items.length} 項` : `依你的回答，先列出很可能符合的 ${items.length} 項`}</T>
        <View nativeID="no-print" style={s.row}>
          {canPrint ? <Btn label="列印清單" icon="⎙" onPress={() => window.print()} style={kit.rowBtn} /> : null}
          <Btn label="請人陪我去" onPress={() => go('/help')} style={kit.rowBtn} />
        </View>
      </View>

      {docs.length === 0 ? (
        <Card>
          <T size="heading">沒有列出要帶的文件，出發前請先打電話確認</T>
        </Card>
      ) : (
      <Section title={`要帶的東西（${ready.length}/${docs.length}）`}>
        <Card style={s.noPad}>
          {docs.map((d, idx) => {
            const on = ready.includes(d.doc);
            return (
              <Pressable
                key={d.doc}
                role="checkbox"
                aria-checked={on}
                aria-label={d.doc}
                onPress={() => setReady(on ? ready.filter((x) => x !== d.doc) : [...ready, d.doc])}
                style={[s.docRow, idx > 0 && { borderTopWidth: 1, borderColor: colors.border }]}>
                <View
                  style={[
                    s.box,
                    { borderColor: on ? colors.accent : colors.text, backgroundColor: on ? colors.accent : 'transparent' },
                  ]}>
                  {on ? (
                    <T weight="700" color={colors.accentText}>
                      ✓
                    </T>
                  ) : null}
                </View>
                <View style={s.flex1}>
                  <T size="heading" weight="700">
                    {d.doc}
                  </T>
                  <T size="small" muted>
                    {d.for.length > 1 ? `${d.for.length} 項都要用` : d.for[0]}
                  </T>
                </View>
              </Pressable>
            );
          })}
        </Card>
      </Section>
      )}

      {counters.length > 0 ? (
        <Section title="要去哪裡">
          <Card>
            {counters.map((c) => (
              <T key={c} size="heading">
                ・{c}
              </T>
            ))}
          </Card>
        </Section>
      ) : null}

      <Section title="要申請的項目">
        <Card>
          {items.map((i) => (
            <View key={i.id} style={s.itemRow}>
              <T size="heading" weight="700">
                {i.name}
              </T>
              <T muted>
                {i.agency}
                {i.apply.phone ? `・電話 ${i.apply.phone}` : ''}
              </T>
            </View>
          ))}
        </Card>
      </Section>
    </Screen>
  );
}

const s = StyleSheet.create({
  top: { gap: 10, paddingTop: 8 },
  row: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  flex1: { flex: 1, minWidth: 150 },
  noPad: { padding: 0, gap: 0 },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 14, minHeight: 64 },
  box: { width: 32, height: 32, borderRadius: 8, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center' },
  itemRow: { gap: 2, paddingVertical: 4 },
});
