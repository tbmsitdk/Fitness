// Heuristic clustering of activities into "recurring routes" using start GPS
// coordinates and total distance as a fingerprint. No map-matching — just a
// practical approximation: same starting area + similar distance ⇒ same route.

export interface RouteCandidateLite {
  id: number;
  title: string;
  activity_type: string;
  date: string;
  distance_km: number;
  duration_seconds: number;
  avg_power: number | null;
  avg_hr: number | null;
  start_lat: number;
  start_lon: number;
}

export interface RouteCluster {
  key: string;
  label: string;
  activity_type: string;
  distance_km: number; // representative (median) distance
  count: number;
  efforts: RouteEffort[];
}

export interface RouteEffort {
  id: number;
  title: string;
  date: string;
  distance_km: number;
  duration_seconds: number;
  avg_speed_kmh: number;
  avg_power: number | null;
  avg_hr: number | null;
  rank: number;
  isBest: boolean;
}

const START_RADIUS_KM = 0.4;       // activities starting within ~400m are "the same place"
const DISTANCE_TOLERANCE_PCT = 0.12; // and within 12% total distance ⇒ likely the same route

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Greedy clustering: walk activities in order, attach each to the first existing
 * cluster whose representative (first member) starts nearby and has a similar
 * total distance & matching activity type; otherwise start a new cluster.
 * Returns clusters with 2+ efforts, sorted by most-repeated first.
 */
export function clusterRoutes(activities: RouteCandidateLite[], minEfforts = 3): RouteCluster[] {
  type WorkingCluster = { ref: RouteCandidateLite; members: RouteCandidateLite[] };
  const clusters: WorkingCluster[] = [];

  for (const a of activities) {
    let placed = false;
    for (const c of clusters) {
      if (c.ref.activity_type !== a.activity_type) continue;
      const dist = haversineKm(c.ref.start_lat, c.ref.start_lon, a.start_lat, a.start_lon);
      if (dist > START_RADIUS_KM) continue;
      const distDiffPct = Math.abs(a.distance_km - c.ref.distance_km) / c.ref.distance_km;
      if (distDiffPct > DISTANCE_TOLERANCE_PCT) continue;
      c.members.push(a);
      placed = true;
      break;
    }
    if (!placed) clusters.push({ ref: a, members: [a] });
  }

  return clusters
    .filter(c => c.members.length >= minEfforts)
    .map(c => {
      const sorted = [...c.members].sort((x, y) => x.duration_seconds - y.duration_seconds);
      const repDistance = Math.round(median(c.members.map(m => m.distance_km)) * 100) / 100;
      const efforts: RouteEffort[] = sorted.map((m, i) => ({
        id: m.id,
        title: m.title,
        date: m.date,
        distance_km: m.distance_km,
        duration_seconds: m.duration_seconds,
        avg_speed_kmh: m.duration_seconds > 0 ? Math.round((m.distance_km / (m.duration_seconds / 3600)) * 10) / 10 : 0,
        avg_power: m.avg_power,
        avg_hr: m.avg_hr,
        rank: i + 1,
        isBest: i === 0,
      }));
      return {
        key: `${c.ref.activity_type}-${c.ref.id}`,
        label: `${c.ref.activity_type === 'cycling' ? 'Ride' : c.ref.activity_type === 'running' ? 'Run' : c.ref.activity_type} · ~${repDistance} km`,
        activity_type: c.ref.activity_type,
        distance_km: repDistance,
        count: c.members.length,
        efforts,
      };
    })
    .sort((a, b) => b.count - a.count);
}
