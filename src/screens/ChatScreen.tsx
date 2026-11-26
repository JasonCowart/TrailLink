// Group chat with one-tap presets. Messages queue with no signal and go out on whatever link appears.
import React, { useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useApp } from '../app/context.tsx';
import { ageLabel, viaLabel } from '../core/status.ts';
import { Button, Header, s } from '../ui/kit.tsx';
import { colors, font } from '../ui/theme.ts';

const PRESETS = ['Regrouping', 'Stopped, all good', 'Need help', 'Fuel stop', 'Wrong turn, wait', 'On my way'];

export function ChatScreen() {
  const { session, version } = useApp();
  const [text, setText] = useState('');
  if (!session) return null;
  void version;
  const msgs = session.store.messages(session.group.id).slice().reverse();
  const send = (t: string, preset = false) => { if (t.trim()) void session.sendMessage(t.trim(), preset); };
  const linksUp = session.router.linksUp();

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.paper }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Header title="Group chat" subtitle={linksUp.length ? `Sending over: ${linksUp.join(', ')}` : 'No links up: messages will send when one appears'} />
      <FlatList
        inverted
        data={msgs}
        keyExtractor={m => m.id}
        contentContainerStyle={{ padding: 16 }}
        renderItem={({ item }) => item.body.kind === 'message' ? (
          <View style={{ paddingVertical: 8, borderBottomWidth: 1, borderColor: colors.line }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={[s.body, { fontFamily: font.bold }]}>{session.nameOf(item.sender)}</Text>
              <Text style={s.quiet}>
                {ageLabel(item.ts)} · {item.sender === session.me.id
                  ? (session.router.sentOn(item.id).length ? `sent via ${session.router.sentOn(item.id).join(', ')}` : 'waiting for a link')
                  : viaLabel(item.via, session.nameOf)}
              </Text>
            </View>
            <Text style={s.body}>{item.body.data.text}</Text>
          </View>
        ) : null}
        ListEmptyComponent={<Text style={[s.quiet, { textAlign: 'center', marginTop: 40 }]}>No messages yet. Presets below send with one tap.</Text>}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingVertical: 8 }} style={{ flexGrow: 0 }}>
        {PRESETS.map(p => (
          <Pressable key={p} accessibilityRole="button" onPress={() => send(p, true)} style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: 99, borderWidth: 1, borderColor: colors.line, justifyContent: 'center' }}>
            <Text style={{ fontFamily: font.bold, fontSize: 15, color: colors.ink }}>{p}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: 8, padding: 16, paddingTop: 4 }}>
        <TextInput value={text} onChangeText={setText} placeholder="Message the group" placeholderTextColor={colors.quiet} accessibilityLabel="Message"
          style={[s.input, { flex: 1 }]} onSubmitEditing={() => { send(text); setText(''); }} returnKeyType="send" />
        <Button label="Send" onPress={() => { send(text); setText(''); }} />
      </View>
    </KeyboardAvoidingView>
  );
}
