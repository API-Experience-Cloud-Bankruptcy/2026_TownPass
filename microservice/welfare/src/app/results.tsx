import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ItemCard } from '@/components/item-card';
import { NearbyPlaces } from '@/components/nearby-places';
import { Btn, Card, Screen, Section, T } from '@/components/ui-kit';
import { CATEGORY_LABEL, itemsInCategories, WELFARE_ITEMS } from '@/data';
import { useApp } from '@/lib/app-state';
import { describeProfile, resultsSpeech } from '@/lib/describe';
import { matchAll } from '@/lib/match';
import { canSpeak, speak, stopSpeaking } from '@/lib/speech';

export default function Results() {
  const { answers, categories, chosen } = useApp();
  const groups = useMemo(
    () =>
      matchAll(itemsInCategories(WELFARE_ITEMS, categories), answers.profile, {
        unknownIdentities: answers.unknownIdentities,
      }),
    [answers, categories],
  );
  const [speaking, setSpeaking] = useState(false);
  const [speechReady, setSpeechReady] = useState(false);
  useEffect(() => {
    setSpeechReady(canSpeak());
    return stopSpeaking;
  }, []);

  const said = describeProfile(answers.profile);
  const total = groups.match.length + groups.maybe.length;

  function toggleSpeak() {
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    speak(resultsSpeech(groups.match, groups.maybe), () => setSpeaking(false));
  }

  return (
    <Screen
      title="查詢結果"
      footerAction={
        chosen.length > 0 ? (
          <Btn
            label={`帶去臨櫃清單（${chosen.length} 項）`}
            variant="primary"
            onPress={() => router.push('/checklist')}
          />
        ) : undefined
      }>
      <View style={s.top}>
        <T size="title" heading={1}>
          {total > 0 ? `找到 ${total} 項你可能可以申請的福利` : '目前沒有找到符合的福利'}
        </T>
        {categories.length > 0 ? (
          <T muted>查的類別：{categories.map((c) => CATEGORY_LABEL[c]).join('、')}</T>
        ) : null}
        <View style={s.row}>
          {speechReady && total > 0 ? (
            <Btn
              label={speaking ? '停止朗讀' : '念給我聽'}
              icon={speaking ? '■' : '♪'}
              selected={speaking}
              onPress={toggleSpeak}
              style={s.flex1}
            />
          ) : null}
          <Btn label="修改答案" onPress={() => router.push('/quiz')} style={s.flex1} />
        </View>
      </View>

      {said.length > 0 ? (
        <Card>
          <T weight="700">你告訴我們的</T>
          <T>{said.join('、')}</T>
        </Card>
      ) : null}

      {groups.match.length > 0 ? (
        <Section title={`你很可能符合（${groups.match.length}）`}>
          {groups.match.map((r) => (
            <ItemCard key={r.item.id} result={r} />
          ))}
        </Section>
      ) : null}

      {groups.maybe.length > 0 ? (
        <Section title={`再確認一件事就知道（${groups.maybe.length}）`}>
          {groups.maybe.map((r) => (
            <ItemCard key={r.item.id} result={r} />
          ))}
        </Section>
      ) : null}

      <NearbyPlaces />

      {total === 0 ? (
        <Card>
          <T>可以看看全部的福利項目，或請人一起幫你查。</T>
          <Btn label="福利項目一覽表" onPress={() => router.push('/list')} />
        </Card>
      ) : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  top: { gap: 10, paddingTop: 8 },
  row: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  flex1: { flex: 1, minWidth: 140 },
});
