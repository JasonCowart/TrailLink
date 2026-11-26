// Small shared UI pieces sized for gloves and sunlight.
import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { colors, font, touch } from './theme.ts';

export function Button({ label, onPress, kind = 'primary', style, disabled }: {
  label: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger' | 'ghostLight'; style?: ViewStyle; disabled?: boolean;
}) {
  const bg = { primary: colors.action, secondary: colors.paper, danger: colors.sos, ghostLight: 'transparent' }[kind];
  const fg = kind === 'secondary' ? colors.ink : '#fff';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.btn,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        kind === 'secondary' && { borderWidth: 1, borderColor: colors.line },
        kind === 'ghostLight' && { borderWidth: 2, borderColor: '#fff' },
        style,
      ]}
    >
      <Text style={[s.btnText, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>{props.label}</Text>
      <TextInput placeholderTextColor={colors.quiet} {...props} style={[s.input, props.style]} />
    </View>
  );
}

export function Header({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <View style={s.header}>
      <View style={{ flex: 1 }}>
        <Text style={s.hTitle} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={s.hSub} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function Chip({ label, on = true, light = false }: { label: string; on?: boolean; light?: boolean }) {
  return (
    <View style={[s.chip, light ? { backgroundColor: '#fff' } : null]}>
      <Text style={[s.chipText, { color: light ? colors.pine : '#fff', textDecorationLine: on ? 'none' : 'line-through' }]}>{label}</Text>
    </View>
  );
}

export function Avatar({ initials, color, size = 40, stale }: { initials: string; color: string; size?: number; stale?: boolean }) {
  return (
    <View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: stale ? colors.stale : color, alignItems: 'center', justifyContent: 'center' }, stale && { borderWidth: 2, borderStyle: 'dashed', borderColor: colors.sos }]}>
      <Text style={{ color: '#fff', fontFamily: font.bold, fontSize: size * 0.34 }}>{initials}</Text>
    </View>
  );
}

export const initialsOf = (name: string) => name.split(/\s+/).map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase() || '?';

export const s = StyleSheet.create({
  btn: { minHeight: touch, borderRadius: 14, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontFamily: font.bold, fontSize: 16 },
  label: { fontFamily: font.bold, fontSize: 14, color: colors.ink },
  input: { minHeight: touch, borderWidth: 1, borderColor: colors.line, borderRadius: 14, paddingHorizontal: 14, fontSize: 17, backgroundColor: colors.sand, color: colors.ink, fontFamily: font.body },
  header: { backgroundColor: colors.pine, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  hTitle: { color: '#fff', fontFamily: font.display, fontSize: 24 },
  hSub: { color: '#fff', opacity: 0.85, fontFamily: font.body, fontSize: 13 },
  chip: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.16)' },
  chipText: { fontFamily: font.bold, fontSize: 12 },
  h2: { fontFamily: font.display, fontSize: 21, color: colors.ink, marginTop: 8 },
  body: { fontFamily: font.body, fontSize: 16, color: colors.ink },
  quiet: { fontFamily: font.body, fontSize: 13, color: colors.quiet },
});
