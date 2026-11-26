// Rider list: who's live, how each position reached you, distance, battery.
import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useApp } from '../app/context.tsx';
import { distanceM, metresToMiles } from '../core/geo.ts';
import { ageLabel, freshness, viaLabel } from '../core/status.ts';
import { Avatar, Button, Header, initialsOf, s } from '../ui/kit.tsx';
import { colors, font } from '../ui/theme.ts';

export function RidersScreen() {
  const { session, myPos, sharing, setSharing, version } = useApp();
  if (!session) return null;
  void version;
  const riders = session.riders();
  const warnings = session.chainWarnings();

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <Header title="Riders" subtitle={session.group.name} />
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {riders.map(({ rider, position, isMe }) => {
          const p = position?.body.kind === 'position' ? position.body.data : null;
          const fresh = isMe ? 'live' : position ? freshness(position) : 'stale';
          const dist = !isMe && p && myPos ? `${metresToMiles(distanceM(myPos, p)).toFixed(1)} mi · ` : '';
          const battery = p?.battery != null ? `${p.battery}%` : '';
          return (
            <View key={rider.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderColor: colors.line }}>
              <Avatar initials={isMe ? 'ME' : initialsOf(rider.name)} color={isMe ? colors.orange : rider.color} stale={fresh === 'stale'} />
              <View style={{ flex: 1 }}>
                <Text style={[s.body, { fontFamily: font.bold }]}>{isMe ? 'You' : rider.name}{rider.role !== 'rider' ? `  ·  ${rider.role === 'leader' ? 'Leader' : 'Sweep'}` : ''}</Text>
                <Text style={s.quiet}>{rider.vehicle}{rider.vehicle ? ' · ' : ''}{dist}{battery}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                {isMe ? (
                  <Text style={{ fontFamily: font.bold, fontSize: 13, color: sharing ? colors.pine : colors.red }}>{sharing ? 'Sharing' : 'Not sharing'}</Text>
                ) : position ? (
                  <>
                    <Text style={{ fontFamily: font.bold, fontSize: 13, color: fresh === 'stale' ? colors.red : colors.pine }}>{ageLabel(position.ts)}</Text>
                    <Text style={s.quiet}>via {viaLabel(position.via, session.nameOf)}</Text>
                  </>
                ) : (
                  <Text style={s.quiet}>No position yet</Text>
                )}
              </View>
            </View>
          );
        })}

        {warnings.length ? (
          <View style={{ marginTop: 16, backgroundColor: colors.warnBg, borderRadius: 14, padding: 14 }}>
            {warnings.map(w => (
              <Text key={w.link} style={s.body}>{session.nameOf(w.link)} is the only radio link to {w.dependents.map(session.nameOf).join(', ')}.</Text>
            ))}
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
          <Button style={{ flex: 1 }} label="Drop regroup point" onPress={() => myPos && session.dropPin('regroup', myPos.lat, myPos.lon)} />
          <Button style={{ flex: 1 }} kind="secondary" label={sharing ? 'Pause sharing' : 'Resume sharing'} onPress={() => setSharing(!sharing)} />
        </View>
        <Button style={{ marginTop: 10 }} kind="secondary" label="Mark a hazard here" onPress={() => myPos && session.dropPin('hazard', myPos.lat, myPos.lon)} />
      </ScrollView>
    </View>
  );
}
