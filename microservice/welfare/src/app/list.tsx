import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Card, Screen, Section, T } from '@/components/ui-kit';
import { CATEGORIES, WELFARE_ITEMS } from '@/data';
import { useApp } from '@/lib/app-state';

export default function List() {
  const { colors, scale } = useApp();
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const q = query.trim();
    const hit = WELFARE_ITEMS.filter(
      (i) => !q || [i.name, i.plain, i.agency, i.amount ?? '', ...i.eligibility.notes].some((t) => t.includes(q)),
    );
    return CATEGORIES.map((c) => ({ ...c, items: hit.filter((i) => i.categories.includes(c.id)) })).filter(
      (g) => g.items.length > 0,
    );
  }, [query]);

  return (
    <Screen title="福利項目一覽表">
      <View style={s.top}>
        <T size="title" heading={1}>
          福利項目一覽表
        </T>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="搜尋，例如：房租、長照、上網"
          placeholderTextColor={colors.muted}
          aria-label="搜尋福利項目"
          role="searchbox"
          style={[
            s.search,
            { fontSize: Math.round(18 * scale), color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
          ]}
        />
      </View>
      {groups.length === 0 ? <T muted>找不到「{query}」相關的項目</T> : null}
      {groups.map((g) => (
        <Section key={g.id} title={`${g.label}（${g.items.length}）`}>
          <Card style={s.listCard}>
            {g.items.map((i, idx) => (
              <Pressable
                key={i.id}
                role="link"
                aria-label={`${i.name}：${i.plain}`}
                onPress={() => router.push(`/item/${i.id}`)}
                style={({ pressed }) => [
                  s.rowItem,
                  idx > 0 && { borderTopWidth: 1, borderColor: colors.border },
                  pressed && { backgroundColor: colors.sunken },
                ]}>
                <View style={s.flex1}>
                  <T weight="700">{i.name}</T>
                  <T size="small" muted>
                    {i.plain}
                  </T>
                </View>
                <T size="heading" color={colors.accent}>
                  ›
                </T>
              </Pressable>
            ))}
          </Card>
        </Section>
      ))}
    </Screen>
  );
}

const s = StyleSheet.create({
  top: { gap: 10, paddingTop: 8 },
  search: { minHeight: 52, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14 },
  listCard: { padding: 0, gap: 0, overflow: 'hidden' },
  rowItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 64 },
  flex1: { flex: 1 },
});
