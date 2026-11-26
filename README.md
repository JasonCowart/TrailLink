# TrailLink

Group ride app for UTV and ATV riders: see your group on the map, chat, and send SOS, even with no cell signal.
Native app for iPhone, iPad and Android (React Native + Expo), plus a small relay server.

## What's here

| Folder | What it is | Status |
| --- | --- | --- |
| `src/core/` | The engine: encrypted packets, store-and-forward, the router that sends over every link, chain-break warnings, alerts | Written and tested (12 tests pass) |
| `server/relay.ts` | Relay server: holds encrypted packets for 24 h so riders who were offline catch up. Can't read them | Written and tested |
| `src/screens/`, `src/App.tsx` | The app's screens: welcome, start/join by QR, map, riders, chat, group, maps, SOS | Written. First compile happens in GitHub Actions |
| `src/core/links/simulated.ts` | A simulated mesh radio, so radio features can be built before hardware testing | Working |
| `.github/workflows/ci.yml` | Runs the tests, installs packages, type-checks, and (on request) builds the app in Expo's cloud | Ready |

## How the sharing works

Every position, message, pin and SOS is a small packet with a unique ID, encrypted with the group's key
(the key is inside the QR code, so the server never has it). The phone sends each packet over every link
that's up: cell now, and Bluetooth and Meshtastic radios later. It keeps everything for 24 hours and passes it on
to any rider it meets. Duplicates are dropped by ID. If a rider is cut off, the map shows how old their last
position is and how it arrived (for example "6 min ago · carried by Maria").

## Run the tests

Needs Node 22 or newer, and no installs:

```
npm test
```

## Build the app (owner steps)

1. **GitHub:** this code lives in a GitHub repo. Every push runs the tests automatically (the Actions tab).
2. **Expo account (free):** sign up at expo.dev. In account settings create an *access token* and add it to the
   GitHub repo as a secret named `EXPO_TOKEN` (Settings › Secrets and variables › Actions).
3. **Android test app:** in GitHub, open Actions › CI › Run workflow. Expo builds an APK and emails a download link.
   Install it on any Android phone.
4. **iPhone / iPad test app:** needs an Apple Developer Program membership. Then the same build runs with
   `--platform ios` and goes to TestFlight.

## Not done yet (Phase 1 remaining)

- Phone-to-phone Bluetooth swaps. The logic is written and tested (`gossip.ts`), but phones also have to *advertise*
  over Bluetooth, which needs a small custom native module. Next up.
- Our own offline trail maps (topo + Forest Service MVUM + BLM + OSM), built as downloadable packs.
  Until then the app uses OpenFreeMap street-style maps for development (`src/config.ts`).
- Satellite base map: needs a licensed imagery provider.
- Deploying the relay server (any small Node host, a few dollars a month). Set its address in `app.json` › `extra.relayUrl`.
- Meshtastic radio link (Phase 2): plugs into the same router as `SimLink` does.
