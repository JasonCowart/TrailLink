// First launch: name and vehicle. Then start or join a ride.
import React, { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useApp } from '../app/context.tsx';
import { Button, Field, Header, s } from '../ui/kit.tsx';
import { colors } from '../ui/theme.ts';

export function ProfileSetup() {
  const { saveProfile } = useApp();
  const [name, setName] = useState('');
  const [vehicle, setVehicle] = useState('');
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.paper }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Header title="Welcome to TrailLink" subtitle="Ride together, even with no signal" />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <Field label="Your name (what the group sees)" value={name} onChangeText={setName} placeholder="e.g. Maria" autoCapitalize="words" />
        <Field label="Vehicle" value={vehicle} onChangeText={setVehicle} placeholder="e.g. Can-Am Maverick X3" />
        <Button label="Continue" disabled={!name.trim()} onPress={() => saveProfile(name.trim(), vehicle.trim())} />
        <Text style={s.quiet}>No account or email needed. Your position is only shared with riders in your group, and only during a ride.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function StartOrJoin() {
  const { createRide, joinRide, profile } = useApp();
  const [rideName, setRideName] = useState('');
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [perm, requestPerm] = useCameraPermissions();

  async function scan() {
    if (!perm?.granted) { const r = await requestPerm(); if (!r.granted) { setError('Camera permission is needed to scan a ride code.'); return; } }
    setError('');
    setScanning(true);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <Header title={`Hi, ${profile?.name ?? 'rider'}`} subtitle="Start a ride or join one" />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
        <Text style={s.h2}>Join a ride</Text>
        <Text style={s.quiet}>Scan the leader's QR code at the trailhead. Works with no signal.</Text>
        <Button label="Scan ride QR code" onPress={scan} />
        {error ? <Text style={[s.quiet, { color: colors.red }]}>{error}</Text> : null}
        <Text style={[s.h2, { marginTop: 20 }]}>Lead a ride</Text>
        <Field label="Ride name" value={rideName} onChangeText={setRideName} placeholder="e.g. Saturday Ridge Run" />
        <Button label="Start a new ride" kind="secondary" disabled={!rideName.trim()} onPress={() => createRide(rideName.trim())} />
      </ScrollView>
      <Modal visible={scanning} animationType="slide" onRequestClose={() => setScanning(false)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <CameraView
            style={{ flex: 1 }}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={async ({ data }) => {
              setScanning(false);
              if (!(await joinRide(data))) setError("That QR code isn't a TrailLink ride.");
            }}
          />
          <View style={{ padding: 20, paddingBottom: 40 }}>
            <Button label="Cancel" kind="ghostLight" onPress={() => setScanning(false)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}
