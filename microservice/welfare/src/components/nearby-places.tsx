import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Btn, Card, T } from '@/components/ui-kit';
import { useApp } from '@/lib/app-state';
import { directionsUrl, distanceLabel, nearestPlaces, PLACE_KIND_LABEL, TAIPEI_DISTRICTS } from '@/lib/nearby';
import { dialNumber, phoneLabel } from '@/lib/phone';
import { SAMPLE_PLACES } from '@/lib/places-sample';
import { call, getLocation, launchMap } from '@/lib/townpass';

const PLACES = SAMPLE_PLACES;

export function NearbyPlaces() {
  const { colors, origin, setOrigin } = useApp();
  const [locating, setLocating] = useState(false);
  const [locateFailed, setLocateFailed] = useState(false);
  const [picking, setPicking] = useState(false);

  async function locate() {
    setLocating(true);
    setLocateFailed(false);
    const pos = await getLocation();
    setLocating(false);
    if (pos) {
      setOrigin({ ...pos, label: '目前位置' });
      setPicking(false);
    } else {
      setLocateFailed(true);
      setPicking(true);
    }
  }

  const choosing = !origin || picking;

  return (
    <Card>
      <T weight="700" heading={2}>
        附近據點
      </T>

      {choosing ? (
        <View style={s.block}>
          <Btn
            label={locating ? '定位中…' : '用我的位置'}
            icon="◎"
            disabled={locating}
            onPress={locate}
          />
          {locateFailed ? (
            <T role="status" weight="600">
              無法取得位置，請選行政區
            </T>
          ) : null}
          {picking ? (
            <View style={s.grid} role="radiogroup" aria-label="行政區">
              {TAIPEI_DISTRICTS.map((d) => (
                <Btn
                  key={d.label}
                  label={d.label}
                  role="radio"
                  selected={origin?.label === d.label}
                  onPress={() => {
                    setOrigin(d);
                    setPicking(false);
                    setLocateFailed(false);
                  }}
                  style={s.district}
                />
              ))}
            </View>
          ) : (
            <Btn label="選行政區" onPress={() => setPicking(true)} />
          )}
          {origin && picking ? <Btn label="取消" variant="ghost" onPress={() => setPicking(false)} /> : null}
        </View>
      ) : (
        <>
          <View style={s.originRow}>
            <T muted style={s.flex1}>
              依{origin.label}排序
            </T>
            <Btn label="更換" variant="ghost" onPress={() => setPicking(true)} />
          </View>
          {nearestPlaces(PLACES, origin).map((p, i) => (
            <View
              key={p.id}
              style={[s.place, i > 0 && { borderTopWidth: 1, borderColor: colors.border }]}
              role="group"
              aria-label={p.name}>
              <View style={s.nameRow}>
                <T size="heading" weight="700" style={s.flex1}>
                  {p.name}
                </T>
                <T weight="700" color={colors.accent}>
                  {distanceLabel(p.meters)}
                </T>
              </View>
              {p.name.includes(PLACE_KIND_LABEL[p.kind]) ? null : (
                <T size="small" muted>
                  {PLACE_KIND_LABEL[p.kind]}
                </T>
              )}
              <T selectable>{p.address}</T>
              <View style={s.actions}>
                {p.phone ? (
                  <Btn
                    label={`打電話 ${phoneLabel(p.phone)}`}
                    role="link"
                    icon="☎"
                    onPress={() => call(dialNumber(p.phone!))}
                    style={s.action}
                  />
                ) : null}
                <Btn label="導航" role="link" icon="↗" onPress={() => launchMap(directionsUrl(p))} style={s.action} />
              </View>
            </View>
          ))}
        </>
      )}
    </Card>
  );
}

const s = StyleSheet.create({
  flex1: { flex: 1 },
  block: { gap: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  district: { flexGrow: 1, flexBasis: '30%', minWidth: 96, paddingHorizontal: 8 },
  originRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  place: { gap: 2, paddingTop: 12 },
  nameRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  action: { flexGrow: 1, flexBasis: 180 },
});
