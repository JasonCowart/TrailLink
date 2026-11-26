// Chain-break warnings. With no relay stations, the vehicles are the relay chain.
// Each position packet lists who that rider hears directly over the mesh. From that we build a graph
// and find riders who are the ONLY link between you and someone else ("Maria is the only link to Jake").

export type Graph = Map<string, Set<string>>;

export function buildGraph(heard: Map<string, string[]>): Graph {
  const g: Graph = new Map();
  const edge = (a: string, b: string) => {
    if (!g.has(a)) g.set(a, new Set());
    if (!g.has(b)) g.set(b, new Set());
    g.get(a)!.add(b);
    g.get(b)!.add(a);
  };
  for (const [rider, list] of heard) {
    if (!g.has(rider)) g.set(rider, new Set());
    for (const other of list) if (other !== rider) edge(rider, other);
  }
  return g;
}

export function reachable(g: Graph, from: string, without?: string): Set<string> {
  const seen = new Set<string>([from]);
  const queue = [from];
  while (queue.length) {
    const a = queue.shift()!;
    for (const b of g.get(a) ?? []) {
      if (b === without || seen.has(b)) continue;
      seen.add(b);
      queue.push(b);
    }
  }
  return seen;
}

export interface ChainWarning { link: string; dependents: string[] }

/** For each rider whose loss would cut others off from `me`, list who would be cut off. */
export function chainWarnings(g: Graph, me: string): ChainWarning[] {
  const all = reachable(g, me);
  const out: ChainWarning[] = [];
  for (const rider of all) {
    if (rider === me) continue;
    const still = reachable(g, me, rider);
    const cut = [...all].filter(r => r !== rider && !still.has(r));
    if (cut.length) out.push({ link: rider, dependents: cut.sort() });
  }
  return out.sort((a, b) => b.dependents.length - a.dependents.length);
}
