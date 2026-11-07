import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ApplyButtons, Bullets } from '@/components/item-card';
import { Btn, Card, Screen, T } from '@/components/ui-kit';
import { CATEGORY_LABEL, WELFARE_ITEMS } from '@/data';
import type { WelfareItem } from '@/data/welfare-schema';
import { useApp } from '@/lib/app-state';
import { matchItem } from '@/lib/match';
import { openLink } from '@/lib/townpass';

export default function ItemDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, answers, chosen, toggleChosen } = useApp();
  const item = WELFARE_ITEMS.find((i) => i.id === id);

  if (!item) {
    return (
      <Screen title="福利項目">
        <T size="title" heading={1}>
          找不到這個項目
        </T>
        <Btn label="看福利項目一覽表" onPress={() => router.replace('/list')} />
      </Screen>
    );
  }

  const answered = describeAnswered(answers.profile);
  const r = matchItem(item, answers.profile, { unknownIdentities: answers.unknownIdentities });
  const isChosen = chosen.includes(item.id);
  const statusText = { match: '依你的回答，很可能符合', maybe: '依你的回答，還差一些資訊', no: '依你的回答，可能不符合' }[r.status];

  return (
    <Screen title="福利項目">
      <View style={s.top}>
        <T size="small" muted>
          {item.categories.map((c) => CATEGORY_LABEL[c]).join('・')}
        </T>
        <T size="title" heading={1}>
          {item.name}
        </T>
        <T size="heading">{item.plain}</T>
        {item.amount ? (
          <T size="heading" weight="700" color={colors.accent}>
            {item.amount}
          </T>
        ) : null}
      </View>

      {answered ? (
        <Card>
          <T weight="700">{statusText}</T>
          {r.reasons.length > 0 ? <Bullets items={r.reasons} mark="✓" color={colors.accent} /> : null}
          {r.failed.length > 0 ? <Bullets items={r.failed} mark="✕" color={colors.muted} /> : null}
          {r.unknowns.length > 0 ? <Bullets items={r.unknowns} mark="?" color={colors.muted} /> : null}
        </Card>
      ) : null}

      <Card>
        <T weight="700" heading={2}>
          申請條件
        </T>
        <Bullets items={[...conditionLines(item), ...item.eligibility.notes]} mark="・" />
      </Card>

      <Card>
        <T weight="700" heading={2}>
          要帶什麼
        </T>
        <Bullets items={item.documents} mark="□" />
      </Card>

      <Card>
        <T weight="700" heading={2}>
          怎麼申請
        </T>
        {item.apply.counter ? <T>臨櫃：{item.apply.counter}</T> : null}
        <ApplyButtons item={item} />
      </Card>

      <Btn
        label={isChosen ? '已加入要辦清單' : '加入要辦清單'}
        role="checkbox"
        icon={isChosen ? '✓' : '+'}
        selected={isChosen}
        onPress={() => toggleChosen(item.id)}
      />

      <View style={s.meta}>
        <T size="small" muted>
          主辦：{item.agency}
        </T>
        <T size="small" muted>
          資料查核日期：{item.checkedAt}
        </T>
        <Btn label="看官方說明" variant="ghost" role="link" icon="↗" align="left" onPress={() => openLink(item.source)} />
      </View>
    </Screen>
  );
}

function describeAnswered(p: { birthYear?: number; residentMonths?: number; identities: string[] }) {
  return p.birthYear !== undefined || p.residentMonths !== undefined || p.identities.length > 0;
}

/** Neutral wording of every structured condition: match against a blank profile. */
function conditionLines(item: WelfareItem): string[] {
  return matchItem(item, { identities: [] }, { unknownIdentities: item.eligibility.identitiesAny ?? [] }).unknowns;
}

const s = StyleSheet.create({
  top: { gap: 6, paddingTop: 8 },
  meta: { gap: 2 },
});
