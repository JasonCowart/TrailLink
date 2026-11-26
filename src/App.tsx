// App shell: onboarding, then four tabs (Map, Riders, Chat, Group) plus Maps and SOS overlays.
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useKeepAwake } from 'expo-keep-awake';
import { useFonts, Barlow_500Medium, Barlow_700Bold } from '@expo-google-fonts/barlow';
import { BarlowCondensed_700Bold } from '@expo-google-fonts/barlow-condensed';
import { AppProvider, useApp } from './app/context.tsx';
import { prefs } from './app/db.ts';
import { BASE_MAPS, type BaseMapId } from './config.ts';
import { ProfileSetup, StartOrJoin } from './screens/Welcome.tsx';
import { MapScreen } from './screens/MapScreen.tsx';
import { RidersScreen } from './screens/RidersScreen.tsx';
import { ChatScreen } from './screens/ChatScreen.tsx';
import { GroupScreen } from './screens/GroupScreen.tsx';
import { MapsScreen } from './screens/MapsScreen.tsx';
import { SosScreen } from './screens/SosScreen.tsx';
import { colors, font } from './ui/theme.ts';

type Tab = 'map' | 'riders' | 'chat' | 'group';

export default function App() {
  const [fontsLoaded] = useFonts({ Barlow_500Medium, Barlow_700Bold, BarlowCondensed_700Bold });
  return (
    <SafeAreaProvider>
      <AppProvider>
        <StatusBar style="light" />
        {fontsLoaded ? <Root /> : <Loading />}
      </AppProvider>
    </SafeAreaProvider>
  );
}

function Loading() {
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.pine }}><ActivityIndicator color="#fff" /></View>;
}

function Root() {
  const { ready, profile, session, myPos, version } = useApp();
  const [tab, setTab] = useState<Tab>('map');
  const [overlay, setOverlay] = useState<'maps' | 'sos' | null>(null);
  const [baseMap, setBaseMapState] = useState<BaseMapId>('topo');
  const [alert, setAlert] = useState<string | null>(null);
  useKeepAwake(); // a dash-mounted screen should stay on during a ride

  useEffect(() => { void prefs.getBaseMap().then(b => { if (b && b in BASE_MAPS) setBaseMapState(b as BaseMapId); }); }, []);
  const setBaseMap = (b: BaseMapId) => { setBaseMapState(b); void prefs.setBaseMap(b); };

  // Alerts: another rider's SOS, or a rider not heard from for a while.
  useEffect(() => {
    if (!session) return;
    const sos = session.store.activeSos(session.group.id).filter(r => r.sender !== session.me.id);
    if (sos.length) { setAlert(`SOS from ${sos.map(r => session.nameOf(r.sender)).join(', ')}. Check the map.`); return; }
    const sep = session.separationAlerts();
    if (sep.length) setAlert(`${sep.map(a => session.nameOf(a.rider)).join(', ')} not heard from for ${sep[0].minutesSilent} min.`);
  }, [version, session]);

  if (!ready) return <Loading />;
  if (!profile) return <SafeAreaView style={{ flex: 1, backgroundColor: colors.pine }} edges={['top']}><ProfileSetup /></SafeAreaView>;
  if (!session) return <SafeAreaView style={{ flex: 1, backgroundColor: colors.pine }} edges={['top']}><StartOrJoin /></SafeAreaView>;

  if (overlay === 'sos') return <SosScreen onClose={() => setOverlay(null)} />;
  if (overlay === 'maps') return <SafeAreaView style={{ flex: 1, backgroundColor: colors.pine }} edges={['top']}><MapsScreen baseMap={baseMap} setBaseMap={setBaseMap} onBack={() => setOverlay(null)} /></SafeAreaView>;

  const fireSos = () => { if (myPos) void session.sos(myPos.lat, myPos.lon); setOverlay('sos'); };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.pine }} edges={['top']}>
      <View style={{ flex: 1 }}>
        {tab === 'map' && <MapScreen baseMap={baseMap} onOpenMaps={() => setOverlay('maps')} onSos={fireSos} />}
        {tab === 'riders' && <RidersScreen />}
        {tab === 'chat' && <ChatScreen />}
        {tab === 'group' && <GroupScreen />}
        {alert ? (
          <Pressable accessibilityRole="alert" onPress={() => { setAlert(null); setTab('map'); }}
            style={{ position: 'absolute', top: 70, left: 12, right: 12, backgroundColor: colors.ink, borderRadius: 14, padding: 14 }}>
            <Text style={{ color: '#fff', fontFamily: font.bold, fontSize: 16 }}>{alert}</Text>
            <Text style={{ color: '#fff', opacity: 0.8, fontSize: 13 }}>Tap to dismiss</Text>
          </Pressable>
        ) : null}
      </View>
      <SafeAreaView edges={['bottom']} style={{ backgroundColor: colors.paper, borderTopWidth: 1, borderColor: colors.line }}>
        <View style={{ flexDirection: 'row' }} accessibilityRole="tablist">
          {(['map', 'riders', 'chat', 'group'] as Tab[]).map(t => (
            <Pressable key={t} accessibilityRole="tab" accessibilityState={{ selected: tab === t }} onPress={() => setTab(t)}
              style={{ flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', borderTopWidth: 3, borderColor: tab === t ? colors.action : 'transparent' }}>
              <Text style={{ fontFamily: font.bold, fontSize: 14, color: tab === t ? colors.pine : colors.quiet }}>{t[0].toUpperCase() + t.slice(1)}</Text>
            </Pressable>
          ))}
        </View>
      </SafeAreaView>
    </SafeAreaView>
  );
}
