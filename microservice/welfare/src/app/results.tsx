import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ItemCard } from '@/components/item-card';
import { NearbyPlaces } from '@/components/nearby-places';
import { Btn, Card, Screen, Section, styles as kit, T } from '@/components/ui-kit';
import { CATEGORY_LABEL, itemsInCategories, WELFARE_ITEMS } from '@/data';
import { useApp } from '@/lib/app-state';
import { describeProfile } from '@/lib/describe';
import { matchAll } from '@/lib/match';
import { go } from '@/lib/nav';
import { resultsSpeech, resultsTitle } from '@/lib/results-text';
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
        // The checklist falls back to the likely matches when nothing is picked.
        chosen.length > 0 || groups.match.length > 0 ? (
          <Btn
            label={chosen.length > 0 ? `帶去臨櫃清單（${chosen.length} 項）` : '帶去臨櫃清單'}
            variant="primary"
            onPress={() => go('/checklist')}
          />
        ) : undefined
      }>
      <View style={s.top}>
        <T size="title" heading={1}>
          {resultsTitle(groups.match, groups.maybe)}
        </T>
        {groups.match.length === 0 && groups.maybe.length > 0 ? (
          <Btn label="繼續回答" variant="primary" onPress={() => go('/quiz?resume=1')} />
        ) : null}
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
              style={kit.rowBtn}
            />
          ) : null}
          <Btn label="修改答案" onPress={() => go('/quiz')} style={kit.rowBtn} />
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
        <Section title={`還需要確認（${groups.maybe.length}）`}>
          {groups.maybe.map((r) => (
            <ItemCard key={r.item.id} result={r} />
          ))}
        </Section>
      ) : null}

      {total === 0 ? (
        <Card>
          <T>可以看看全部的福利項目，或請人一起幫你查。</T>
          <Btn label="福利項目一覽表" onPress={() => go('/list')} />
        </Card>
      ) : null}

      <NearbyPlaces />
    </Screen>
  );
}

const s = StyleSheet.create({
  top: { gap: 10, paddingTop: 8 },
  row: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
});
