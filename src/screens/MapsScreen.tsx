// Base map choice and offline map downloads.
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { OfflineManager } from '@maplibre/maplibre-react-native';
import { useApp } from '../app/context.tsx';
import { BASE_MAPS, type BaseMapId } from '../config.ts';
import { Button, Header, s } from '../ui/kit.tsx';
import { colors, font } from '../ui/theme.ts';

interface PackRow { name: string; progress: number; done: boolean }

export function MapsScreen({ baseMap, setBaseMap, onBack }: { baseMap: BaseMapId; setBaseMap: (b: BaseMapId) => void; onBack: () => void }) {
  const { myPos } = useApp();
  const [packs, setPacks] = useState<PackRow[]>([]);
  const [error, setError] = useState('');

  async function refresh() {
    try {
      const list = await OfflineManager.getPacks();
      const rows = await Promise.all(list.map(async p => {
        const st = await p.status();
        return { name: String(p.metadata?.name ?? 'Offline area'), progress: Math.round(st.percentage ?? 0), done: (st.percentage ?? 0) >= 100 };
      }));
      setPacks(rows);
    } catch { /* no packs yet */ }
  }
  useEffect(() => { void refresh(); }, []);

  /** Download the area around the rider (about 25 miles each way) at trail-reading zooms. */
  async function downloadHere() {
    if (!myPos) { setError('Waiting for a GPS fix. Step outside and try again.'); return; }
    setError('');
    const d = 0.36; // degrees latitude ~ 25 miles
    const name = `Area around ${myPos.lat.toFixed(2)}, ${myPos.lon.toFixed(2)}`;
    try {
      await OfflineManager.createPack(
        {
          mapStyle: BASE_MAPS[baseMap].style || BASE_MAPS.topo.style,
          bounds: [myPos.lon - d, myPos.lat - d, myPos.lon + d, myPos.lat + d], // west, south, east, north
          minZoom: 8,
          maxZoom: 15,
          metadata: { name },
        },
        () => { void refresh(); },
        (_pack, err) => setError(String((err as { message?: string })?.message ?? 'Download failed')),
      );
      void refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <Header title="Maps" right={<Pressable accessibilityRole="button" onPress={onBack} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }}><Text style={{ color: '#fff', fontFamily: font.bold, fontSize: 16 }}>Done</Text></Pressable>} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Text style={s.h2}>Base map</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(Object.keys(BASE_MAPS) as BaseMapId[]).map(id => {
            const available = !!BASE_MAPS[id].style;
            const on = baseMap === id;
            return (
              <Pressable key={id} accessibilityRole="button" accessibilityState={{ selected: on, disabled: !available }} disabled={!available} onPress={() => setBaseMap(id)}
                style={{ flex: 1, minHeight: 56, borderRadius: 12, borderWidth: on ? 3 : 1, borderColor: on ? colors.action : colors.line, alignItems: 'center', justifyContent: 'center', opacity: available ? 1 : 0.45 }}>
                <Text style={{ fontFamily: font.bold, fontSize: 14, color: colors.ink }}>{BASE_MAPS[id].label}</Text>
                {!available ? <Text style={{ fontSize: 11, color: colors.quiet }}>soon</Text> : null}
              </Pressable>
            );
          })}
        </View>

        <Text style={s.h2}>Offline maps</Text>
        <Text style={s.quiet}>Download before you lose signal. Downloaded areas work in airplane mode.</Text>
        {packs.map(p => (
          <View key={p.name} style={{ backgroundColor: colors.sand, borderRadius: 12, padding: 12 }}>
            <Text style={[s.body, { fontFamily: font.bold }]}>{p.name}</Text>
            <Text style={{ fontFamily: font.bold, fontSize: 12, color: p.done ? colors.pine : colors.quiet }}>{p.done ? 'Ready offline' : `Downloading ${p.progress}%`}</Text>
            {!p.done ? <View style={{ height: 6, backgroundColor: colors.line, borderRadius: 3, marginTop: 6 }}><View style={{ width: `${p.progress}%`, height: 6, backgroundColor: colors.pine, borderRadius: 3 }} /></View> : null}
          </View>
        ))}
        <Button label="Download the area around me" onPress={downloadHere} />
        {error ? <Text style={[s.quiet, { color: colors.red }]}>{error}</Text> : null}
        <Text style={s.quiet}>Coming next: download by state, by drawing an area, and legal OHV trail layers (Forest Service MVUM, BLM, state).</Text>
      </ScrollView>
    </View>
  );
}
