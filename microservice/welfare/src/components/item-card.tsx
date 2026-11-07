import { StyleSheet, View } from 'react-native';

import { Btn, Card, T } from '@/components/ui-kit';
import type { WelfareItem } from '@/data/welfare-schema';
import { useApp } from '@/lib/app-state';
import type { MatchResult } from '@/lib/match';
import { go } from '@/lib/nav';
import { dialNumber, phoneLabel } from '@/lib/phone';
import { call, openLink } from '@/lib/townpass';

export function Bullets({ items, mark, color }: { items: string[]; mark: string; color?: string }) {
  return (
    <View style={s.bullets} role="list">
      {items.map((t) => (
        <View key={t} style={s.bullet} role="listitem">
          <T weight="700" color={color} style={s.mark}>
            {mark}
          </T>
          <T style={s.flex1}>{t}</T>
        </View>
      ))}
    </View>
  );
}

export function ApplyButtons({ item }: { item: WelfareItem }) {
  const { apply } = item;
  return (
    <View style={s.apply}>
      {apply.online ? (
        <Btn label="線上申請" role="link" icon="↗" onPress={() => openLink(apply.online!)} style={s.applyBtn} />
      ) : null}
      {apply.phone ? (
        <Btn
          label={`打電話 ${phoneLabel(apply.phone)}`}
          role="link"
          icon="☎"
          onPress={() => call(dialNumber(apply.phone!))}
          style={s.applyBtn}
        />
      ) : null}
    </View>
  );
}

export function ItemCard({ result }: { result: MatchResult }) {
  const { colors, chosen, toggleChosen } = useApp();
  const { item } = result;
  const isChosen = chosen.includes(item.id);
  const confirm = [...result.unknowns, ...result.toConfirm];
  return (
    <Card>
      <View style={s.badgeRow}>
        <View
          style={[
            s.badge,
            result.status === 'match'
              ? { backgroundColor: colors.accent }
              : { borderColor: colors.accent, borderWidth: 1.5 },
          ]}>
          <T size="small" weight="700" color={result.status === 'match' ? colors.accentText : colors.accent}>
            {result.status === 'match' ? '很可能符合' : '再確認就知道'}
          </T>
        </View>
        <T size="small" muted style={s.flex1}>
          {item.agency}
        </T>
      </View>
      <T size="heading" weight="700" heading={3}>
        {item.plain}
      </T>
      <T size="small" muted>
        {item.name}
      </T>
      {item.amount ? (
        <T size="heading" weight="700" color={colors.accent}>
          {item.amount}
        </T>
      ) : null}

      {result.reasons.length > 0 ? (
        <View style={s.block}>
          <T weight="700">你可能符合的原因</T>
          <Bullets items={result.reasons} mark="✓" color={colors.accent} />
        </View>
      ) : null}
      {confirm.length > 0 ? (
        <View style={s.block}>
          <T weight="700">還需要確認</T>
          <Bullets items={confirm} mark="?" color={colors.muted} />
        </View>
      ) : null}
      {item.documents.length > 0 ? (
        <View style={s.block}>
          <T weight="700">要帶什麼</T>
          <Bullets items={item.documents} mark="□" />
        </View>
      ) : null}
      {item.apply.counter ? (
        <View style={s.block}>
          <T weight="700">去哪裡辦</T>
          <T>{item.apply.counter}</T>
        </View>
      ) : null}
      <ApplyButtons item={item} />
      <View style={s.actions}>
        <Btn
          label={isChosen ? '已加入要辦清單' : '加入要辦清單'}
          role="checkbox"
          icon={isChosen ? '✓' : '+'}
          selected={isChosen}
          onPress={() => toggleChosen(item.id)}
          style={s.flex1}
        />
        <Btn label="詳細說明" variant="ghost" role="link" onPress={() => go(`/item/${item.id}`)} />
      </View>
    </Card>
  );
}

const s = StyleSheet.create({
  flex1: { flex: 1 },
  bullets: { gap: 4 },
  bullet: { flexDirection: 'row', gap: 8 },
  mark: { width: 20, textAlign: 'center' },
  block: { gap: 4, marginTop: 4 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2 },
  apply: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  applyBtn: { flexGrow: 1, maxWidth: '100%' },
  actions: { flexDirection: 'row', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
});
