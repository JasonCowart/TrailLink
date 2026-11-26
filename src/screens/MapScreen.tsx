// The main screen: trail map, riders, chain-break warning, SOS.
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Camera, Map as MapLibreMap, Marker, type CameraRef } from '@maplibre/maplibre-react-native';
import { useApp } from '../app/context.tsx';
import { BASE_MAPS, type BaseMapId } from '../config.ts';
import { ageLabel, freshness, viaLabel } from '../core/status.ts';
import { Avatar, Chip, Header, initialsOf, s } from '../ui/kit.tsx';
import { colors, font } from '../ui/theme.ts';

export function MapScreen({ baseMap, onOpenMaps, onSos }: { baseMap: BaseMapId; onOpenMaps: () => void; onSos: () => void }) {
  const { session, myPos, online, version } = useApp();
  const camera = useRef<CameraRef>(null);
  const [followMe, setFollowMe] = useState(true);
  useEffect(() => {
    if (followMe && myPos) camera.current?.easeTo({ center: [myPos.lon, myPos.lat] });
  }, [myPos, followMe]);
  if (!session) return null;
  void version; // re-render when session data changes

  const riders = session.riders();
  const warnings = session.chainWarnings();
  const live = riders.filter(r => !r.isMe && r.position && freshness(r.position) === 'live').length;
  const others = riders.filter(r => !r.isMe).length;
  const stalest = riders.filter(r => !r.isMe && r.position && freshness(r.position) === 'stale').sort((a, b) => a.position!.ts - b.position!.ts)[0];
  const style = BASE_MAPS[baseMap].style || BASE_MAPS.topo.style;


  return (
    <View style={{ flex: 1, backgroundColor: colors.land }}>
      <Header
        title={session.group.name}
        subtitle={`${others + 1} riders`}
        right={<View style={{ flexDirection: 'row', gap: 6 }}><Chip label="Cell" on={online} /><Chip label={`${live} live`} light /></View>}
      />
      <View style={{ flex: 1 }}>
        <MapLibreMap style={{ flex: 1 }} mapStyle={style} onRegionWillChange={e => { if (e.nativeEvent.userInteraction) setFollowMe(false); }}>
          <Camera ref={camera} initialViewState={{ center: myPos ? [myPos.lon, myPos.lat] : [-104.99, 39.07], zoom: 13 }} />
          {riders.map(({ rider, position, isMe }) => {
            const p = isMe ? myPos : position?.body.kind === 'position' ? position.body.data : null;
            if (!p) return null;
            const fresh = isMe ? 'live' : freshness(position!);
            const label = isMe ? 'You' : `${rider.name} · ${ageLabel(position!.ts)}`;
            return (
              <Marker key={rider.id} id={rider.id} lngLat={[p.lon, p.lat]} anchor="top">
                <View style={{ alignItems: 'center' }} accessibilityLabel={`${label}, ${isMe ? '' : viaLabel(position!.via, session.nameOf)}`}>
                  <Avatar initials={isMe ? 'ME' : initialsOf(rider.name)} color={isMe ? colors.orange : rider.color} size={isMe ? 40 : 34} stale={fresh === 'stale'} />
                  <Text style={{ marginTop: 2, backgroundColor: '#fff', paddingHorizontal: 6, borderRadius: 6, fontFamily: font.bold, fontSize: 12, color: colors.ink }}>{label}</Text>
                </View>
              </Marker>
            );
          })}
          {session.store.pins(session.group.id).map(pin => pin.body.kind === 'pin' ? (
            <Marker key={pin.id} id={pin.id} lngLat={[pin.body.data.lon, pin.body.data.lat]} anchor="bottom">
              <View style={{ backgroundColor: pin.body.data.pinType === 'hazard' ? colors.sos : colors.action, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
                <Text style={{ color: '#fff', fontFamily: font.bold, fontSize: 12 }}>{pin.body.data.pinType === 'hazard' ? 'Hazard' : 'Regroup'}</Text>
              </View>
            </Marker>
          ) : null)}
        </MapLibreMap>

        {warnings[0] ? (
          <View style={{ position: 'absolute', top: 12, left: 12, right: 76, backgroundColor: colors.warnBg, borderColor: colors.warnLine, borderWidth: 1, borderRadius: 12, padding: 12 }}>
            <Text style={[s.body, { fontFamily: font.bold }]}>{session.nameOf(warnings[0].link)} is the only link to {warnings[0].dependents.map(session.nameOf).join(', ')}</Text>
            <Text style={s.body}>Wait for them before the canyon, or set a regroup point.</Text>
          </View>
        ) : null}

        <View style={{ position: 'absolute', right: 12, top: 12, gap: 8 }}>
          <MapButton label="Map layers" glyph="≡" onPress={onOpenMaps} />
          <MapButton label="Center on me" glyph="◎" onPress={() => setFollowMe(true)} />
        </View>

        <SosButton onFire={onSos} />
      </View>
      <View style={{ backgroundColor: colors.paper, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={[s.h2, { marginTop: 0 }]}>{live} of {others} riders live</Text>
          {stalest ? <Text style={s.quiet}>{stalest.rider.name} last heard {ageLabel(stalest.position!.ts)}</Text> : <Text style={s.quiet}>Positions update every 10 seconds while moving</Text>}
        </View>
        <Pressable accessibilityRole="button" onPress={() => myPos && session.dropPin('regroup', myPos.lat, myPos.lon)} style={{ backgroundColor: colors.action, borderRadius: 12, minHeight: 48, paddingHorizontal: 14, justifyContent: 'center' }}>
          <Text style={{ color: '#fff', fontFamily: font.bold, fontSize: 15 }}>Regroup here</Text>
        </Pressable>
      </View>
    </View>
  );
}

function MapButton({ label, glyph, onPress }: { label: string; glyph: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center', elevation: 3, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } }}>
      <Text style={{ fontSize: 22, color: colors.ink }}>{glyph}</Text>
    </Pressable>
  );
}

/** Press and hold for 3 seconds. A quick tap does nothing, to avoid pocket and bump presses. */
function SosButton({ onFire }: { onFire: () => void }) {
  const [progress, setProgress] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const start = () => {
    const t0 = Date.now();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    timer.current = setInterval(() => {
      const p = Math.min(1, (Date.now() - t0) / 3000);
      setProgress(p);
      if (p >= 1) { stop(); void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); onFire(); }
    }, 50);
  };
  const stop = () => { if (timer.current) clearInterval(timer.current); timer.current = null; setProgress(0); };
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="SOS. Press and hold for 3 seconds" onPressIn={start} onPressOut={stop}
      style={{ position: 'absolute', left: 14, bottom: 14, width: 80, height: 80, borderRadius: 40, borderWidth: 4, borderColor: '#fff', backgroundColor: colors.sos, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${progress * 100}%`, backgroundColor: 'rgba(255,255,255,0.35)', borderRadius: 40 }} />
      <Text style={{ color: '#fff', fontFamily: font.display, fontSize: 24 }}>SOS</Text>
      <Text style={{ color: '#fff', fontFamily: font.bold, fontSize: 11 }}>{progress > 0 ? 'keep holding' : 'hold 3s'}</Text>
    </Pressable>
  );
}
