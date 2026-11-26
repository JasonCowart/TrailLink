// Shared data types for TrailLink. Everything that moves between riders is an Envelope.

export type Role = 'leader' | 'sweep' | 'rider';

export interface Rider {
  id: string;
  name: string;
  vehicle: string;
  role: Role;
  color: string;
  hasRadio: boolean;
}

export interface Group {
  id: string;
  name: string;
  /** 32 raw key bytes, base64url. Never leaves the phone except inside the QR invite. */
  key: string;
  createdBy: string;
  /** Epoch ms when sharing stops automatically. */
  endsAt: number;
}

export type LinkName = 'cell' | 'mesh' | 'bluetooth' | 'satellite' | 'local';

export interface PositionBody {
  lat: number;
  lon: number;
  /** Metres, as reported by the GPS. */
  accuracy: number;
  speed?: number;
  heading?: number;
  battery?: number;
  /** Rider ids this sender currently hears directly over the mesh. Used for chain-break warnings. */
  heard?: string[];
}

export interface MessageBody { text: string; preset?: boolean }
export interface PinBody { pinType: 'regroup' | 'hazard' | 'note'; lat: number; lon: number; note?: string }
export interface SosBody { lat: number; lon: number; active: boolean }
export interface ProfileBody { rider: Rider }
export interface LeaveBody { reason?: string }

export type Body =
  | { kind: 'position'; data: PositionBody }
  | { kind: 'message'; data: MessageBody }
  | { kind: 'pin'; data: PinBody }
  | { kind: 'sos'; data: SosBody }
  | { kind: 'profile'; data: ProfileBody }
  | { kind: 'leave'; data: LeaveBody };

export interface Envelope {
  /** Globally unique packet id. Duplicates arriving over two links are dropped by id. */
  id: string;
  groupId: string;
  sender: string;
  /** Epoch ms when the sender created it. */
  ts: number;
  body: Body;
}

/** An envelope as stored, with how it reached this phone. */
export interface Received extends Envelope {
  via: LinkName | `carried:${string}`;
  receivedAt: number;
}

/** The encrypted form that actually travels over links. */
export interface Sealed {
  v: 1;
  g: string; // group id (clear, so relays can route)
  i: string; // packet id (clear, so relays and peers can dedupe without decrypting)
  t: number; // timestamp (clear, for 24h expiry)
  n: string; // nonce, base64url
  c: string; // ciphertext, base64url
}
