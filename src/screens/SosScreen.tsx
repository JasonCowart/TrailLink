// Shown after an SOS is sent. The app never claims 911 was contacted.
import React from 'react';
import { Linking, Platform, ScrollView, Text, View } from 'react-native';
import { useApp } from '../app/context.tsx';
import { Button } from '../ui/kit.tsx';
import { colors, font } from '../ui/theme.ts';

export function SosScreen({ onClose }: { onClose: () => void }) {
  const { session, myPos } = useApp();
  if (!session) return null;
  const links = session.router.linksUp();

  return (
    <View style={{ flex: 1, backgroundColor: colors.sosDeep }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 60, gap: 18 }}>
        <Text style={{ fontFamily: font.display, fontSize: 36, color: '#fff' }}>SOS sent to your group</Text>
        <Text style={{ fontFamily: font.body, fontSize: 16, color: '#fff' }}>
          {links.length ? `Sent over ${links.join(', ')}. It keeps retrying every link until each rider has it.` : 'No link is up yet. It will go out the moment any rider is in reach.'}
        </Text>
        {myPos ? (
          <Text selectable style={{ fontFamily: font.bold, fontSize: 16, color: '#fff' }}>
            Your position: {myPos.lat.toFixed(5)}, {myPos.lon.toFixed(5)} · ±{myPos.accuracy} m
          </Text>
        ) : null}
        <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 16, gap: 10 }}>
          <Text style={{ fontFamily: font.display, fontSize: 22, color: colors.ink }}>Your group can't call 911 for you</Text>
          <Text style={{ fontFamily: font.body, fontSize: 15, color: colors.ink }}>
            With no cell signal, use your phone's Emergency SOS via satellite: step into open sky, then call or text 911 and follow the prompts. If someone in the group has an inReach, use it too.
          </Text>
          <Button kind="danger" label="Call 911" onPress={() => { void Linking.openURL(Platform.OS === 'ios' ? 'telprompt:911' : 'tel:911'); }} />
        </View>
        <Button kind="ghostLight" label="Cancel SOS · I'm OK" onPress={() => { if (myPos) void session.cancelSos(myPos.lat, myPos.lon); onClose(); }} />
        <Button kind="ghostLight" label="Back to map (keep SOS active)" onPress={onClose} />
      </ScrollView>
    </View>
  );
}
