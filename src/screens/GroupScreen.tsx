// Invite riders by QR (works offline), sharing controls, leave the ride.
import React, { useState } from 'react';
import { Modal, ScrollView, Switch, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useApp } from '../app/context.tsx';
import { encodeInvite, shortCode } from '../core/group.ts';
import { Button, s } from '../ui/kit.tsx';
import { colors, font } from '../ui/theme.ts';

export function GroupScreen() {
  const { session, sharing, setSharing, leaveRide } = useApp();
  const [confirmLeave, setConfirmLeave] = useState(false);
  if (!session) return null;
  const g = session.group;
  const endsIn = Math.max(0, Math.round((g.endsAt - Date.now()) / 3600_000));

  return (
    <View style={{ flex: 1, backgroundColor: colors.pine }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
        <Text style={{ fontFamily: font.display, fontSize: 34, color: '#fff' }}>{g.name}</Text>
        <Text style={{ fontFamily: font.body, fontSize: 15, color: '#fff', opacity: 0.85 }}>Riders scan this at the trailhead. No signal needed.</Text>
        <View style={{ alignSelf: 'center', backgroundColor: '#fff', padding: 18, borderRadius: 20 }} accessibilityLabel="Ride invite QR code">
          <QRCode value={encodeInvite(g)} size={230} ecl="M" />
        </View>
        <Text style={{ textAlign: 'center', color: '#fff', fontFamily: font.display, fontSize: 30, letterSpacing: 3 }}>{shortCode(g)}</Text>
        <Text style={{ textAlign: 'center', color: '#fff', opacity: 0.85, fontSize: 13 }}>Ride code, so riders can confirm they joined the right group</Text>

        <View style={{ backgroundColor: colors.paper, borderRadius: 18, padding: 16, gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48 }}>
            <Text style={[s.body, { flex: 1, fontFamily: font.bold }]}>Share my location</Text>
            <Switch value={sharing} onValueChange={setSharing} accessibilityLabel="Share my location" />
          </View>
          <Text style={s.quiet}>Sharing stops automatically in about {endsIn} hours, when the ride ends.</Text>
          <Button kind="secondary" label="Leave this ride" onPress={() => setConfirmLeave(true)} />
        </View>
      </ScrollView>

      <Modal transparent visible={confirmLeave} animationType="fade" onRequestClose={() => setConfirmLeave(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 20 }}>
          <View style={{ backgroundColor: colors.paper, borderRadius: 18, padding: 20, gap: 12 }}>
            <Text style={{ fontFamily: font.display, fontSize: 26, color: colors.ink }}>Leave {g.name}?</Text>
            <Text style={s.body}>The group will stop seeing your position. You can rejoin by scanning the QR code again.</Text>
            <Button kind="danger" label="Leave ride" onPress={() => { setConfirmLeave(false); void leaveRide(); }} />
            <Button kind="secondary" label="Stay" onPress={() => setConfirmLeave(false)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}
