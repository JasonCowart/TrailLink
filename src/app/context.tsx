// App state shared by all screens: profile, current ride, my position.
import React, { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import * as Network from 'expo-network';
import type { Group, PositionBody, Rider } from '../core/types.ts';
import { newId } from '../core/b64.ts';
import { createGroup, decodeInvite } from '../core/group.ts';
import { riderColors } from '../ui/theme.ts';
import { prefs } from './db.ts';
import { RideSession } from './session.ts';
import { requestPermissions, startTracking } from './location.ts';

interface AppState {
  ready: boolean;
  profile: Rider | null;
  saveProfile(name: string, vehicle: string): Promise<void>;
  session: RideSession | null;
  createRide(name: string): Promise<void>;
  joinRide(inviteText: string): Promise<boolean>;
  leaveRide(): Promise<void>;
  myPos: PositionBody | null;
  sharing: boolean;
  setSharing(v: boolean): void;
  online: boolean;
  version: number; // bumps whenever session data changes, so screens re-render
}

const Ctx = createContext<AppState | null>(null);
export const useApp = () => { const c = useContext(Ctx); if (!c) throw new Error('AppProvider missing'); return c; };

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<Rider | null>(null);
  const [session, setSession] = useState<RideSession | null>(null);
  const [myPos, setMyPos] = useState<PositionBody | null>(null);
  const [sharing, setSharingState] = useState(true);
  const [online, setOnline] = useState(false);

  // Load saved profile and ride on launch.
  useEffect(() => {
    (async () => {
      const p = await prefs.getProfile();
      setProfile(p);
      setSharingState(await prefs.getSharing());
      const g = await prefs.getGroup();
      if (p && g && Date.now() < g.endsAt) await open(p, g);
      setReady(true);
    })();
  }, []);

  // Network state drives the cell link.
  useEffect(() => {
    const check = async () => { const s = await Network.getNetworkStateAsync(); setOnline(!!s.isInternetReachable); };
    void check();
    const t = setInterval(check, 10_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { session?.setOnline(online); }, [online, session]);
  useEffect(() => { if (session) session.sharing = sharing; }, [sharing, session]);

  // GPS for the whole ride.
  useEffect(() => {
    if (!session) return;
    let stop: (() => void) | undefined;
    (async () => {
      const perm = await requestPermissions();
      if (perm === 'denied') return;
      stop = await startTracking(setMyPos, p => { void session.sharePosition(p); }, perm === 'always');
    })();
    return () => stop?.();
  }, [session]);

  async function open(p: Rider, g: Group) {
    const s = new RideSession(p, g);
    await s.start();
    setSession(s);
  }

  const version = useSyncExternalStore(
    fn => (session ? session.subscribe(fn) : () => {}),
    () => (session ? session.store.size + session.router.pendingCount() * 100000 + Math.floor(Date.now() / 5000) : 0),
  );

  const value = useMemo<AppState>(() => ({
    ready, profile, session, myPos, sharing, online, version,
    async saveProfile(name, vehicle) {
      const r: Rider = profile
        ? { ...profile, name, vehicle }
        : { id: newId(9), name, vehicle, role: 'rider', color: riderColors[Math.floor(Math.random() * riderColors.length)], hasRadio: false };
      await prefs.setProfile(r);
      setProfile(r);
    },
    async createRide(name) {
      if (!profile) return;
      const me = { ...profile, role: 'leader' as const };
      const g = createGroup(name, me.id);
      await prefs.setGroup(g);
      await open(me, g);
    },
    async joinRide(text) {
      const g = decodeInvite(text.trim());
      if (!g || !profile) return false;
      await prefs.setGroup(g);
      await open({ ...profile, role: 'rider' }, g);
      return true;
    },
    async leaveRide() {
      await session?.leave();
      await prefs.setGroup(null);
      setSession(null);
    },
    setSharing(v) { setSharingState(v); void prefs.setSharing(v); },
  }), [ready, profile, session, myPos, sharing, online, version]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
