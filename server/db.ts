import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type {
  ClusterAlert,
  HazardZone,
  IndividualAnimal,
  LeaderboardEntry,
  NotificationItem,
  RescueOrg,
  Sighting,
  SpeciesCategory,
} from '../src/types.ts';
import {
  HAZARD_ZONES,
  RESCUE_ORGS,
  SEED_INDIVIDUALS,
  SEED_NOTIFICATIONS,
  SEED_SIGHTINGS,
  SENSITIVE_ZONES,
} from './seed.ts';

export interface ConservationStore {
  sightings: Sighting[];
  individuals: IndividualAnimal[];
  notifications: NotificationItem[];
  rescuePasscodeHash: string | null;
  rescuePasscodeSalt: string | null;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'conservation-store.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

const SESSION_SECRET =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16
    ? process.env.SESSION_SECRET
    : crypto.randomBytes(32).toString('hex');

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

export function loadStore(): ConservationStore {
  ensureDirs();
  if (!fs.existsSync(STORE_PATH)) {
    const initial: ConservationStore = {
      sightings: SEED_SIGHTINGS,
      individuals: SEED_INDIVIDUALS,
      notifications: SEED_NOTIFICATIONS,
      rescuePasscodeHash: null,
      rescuePasscodeSalt: null,
    };
    saveStore(initial);
    return initial;
  }
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as ConservationStore;
    return {
      sightings: Array.isArray(parsed.sightings) ? parsed.sightings : SEED_SIGHTINGS,
      individuals: Array.isArray(parsed.individuals) ? parsed.individuals : SEED_INDIVIDUALS,
      notifications: Array.isArray(parsed.notifications) ? parsed.notifications : SEED_NOTIFICATIONS,
      rescuePasscodeHash: parsed.rescuePasscodeHash ?? null,
      rescuePasscodeSalt: parsed.rescuePasscodeSalt ?? null,
    };
  } catch {
    const fallback: ConservationStore = {
      sightings: SEED_SIGHTINGS,
      individuals: SEED_INDIVIDUALS,
      notifications: SEED_NOTIFICATIONS,
      rescuePasscodeHash: null,
      rescuePasscodeSalt: null,
    };
    return fallback;
  }
}

export function saveStore(store: ConservationStore) {
  ensureDirs();
  const tmpPath = `${STORE_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmpPath, STORE_PATH);
}

export function saveUploadedImage(base64Data: string, mimeType: string): string {
  ensureDirs();
  const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
  const fileName = `sighting_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
  const resolved = path.resolve(UPLOAD_DIR, fileName);
  if (!resolved.startsWith(UPLOAD_DIR + path.sep)) {
    throw new Error('Invalid upload path');
  }
  const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
  fs.writeFileSync(resolved, Buffer.from(cleanBase64, 'base64'));
  return `/api/uploads/${fileName}`;
}

export function getUploadFilePath(fileName: string): string | null {
  if (!/^[a-zA-Z0-9_.-]+$/.test(fileName)) return null;
  const resolved = path.resolve(UPLOAD_DIR, fileName);
  if (!resolved.startsWith(UPLOAD_DIR + path.sep)) return null;
  return fs.existsSync(resolved) ? resolved : null;
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function detectRegion(lat: number, lng: number): string {
  if (lat >= 37.3 && lng < -122.0) return 'San Francisco Coast';
  if (lat >= 36.4 && lat < 37.3 && lng < -121.6) return 'Monterey Bay';
  if (lat >= 35.5 && lat < 36.4) return 'Big Sur';
  if (lat >= 33.9 && lat < 35.5) return 'Channel Islands';
  if (lat >= 32.5 && lat < 33.9) return 'Southern California';
  if (lat < 32.5) return 'Baja Corridor';
  return 'Pacific Coast';
}

export function checkSensitiveSite(
  lat: number,
  lng: number,
  aiFlaggedSensitive: boolean,
  aiReason: string
): { isSensitive: boolean; reason?: string } {
  for (const zone of SENSITIVE_ZONES) {
    if (haversineKm(lat, lng, zone.lat, zone.lng) <= zone.radiusKm) {
      return { isSensitive: true, reason: zone.reason };
    }
  }
  if (aiFlaggedSensitive) {
    return {
      isSensitive: true,
      reason: aiReason || 'Sensitive nesting, pupping, or resting habitat',
    };
  }
  return { isSensitive: false };
}

export function obfuscateCoordinates(lat: number, lng: number, seedStr: string): { lat: number; lng: number } {
  // Deterministic 1.4-2.1km shift so public pin remains in general buffer circle without exposing exact nest/rookery
  const hash = crypto.createHash('sha256').update(seedStr).digest();
  const angle = (hash[0] / 255) * 2 * Math.PI;
  const distKm = 1.4 + (hash[1] / 255) * 0.7;
  const dLat = (distKm / 111.0) * Math.cos(angle);
  const dLng = (distKm / (111.0 * Math.cos((lat * Math.PI) / 180))) * Math.sin(angle);
  return {
    lat: Number((lat + dLat).toFixed(4)),
    lng: Number((lng + dLng).toFixed(4)),
  };
}

export function sanitizeSightingForPublic(sighting: Sighting, includeExact: boolean): Sighting {
  if (includeExact || !sighting.isSensitiveSite) {
    return {
      ...sighting,
      lat: sighting.isSensitiveSite && includeExact && sighting.exactLat !== undefined ? sighting.exactLat : sighting.lat,
      lng: sighting.isSensitiveSite && includeExact && sighting.exactLng !== undefined ? sighting.exactLng : sighting.lng,
    };
  }
  const { exactLat: _eLat, exactLng: _eLng, ...rest } = sighting;
  return rest;
}

export function findNearestRescueOrg(
  speciesCategory: SpeciesCategory,
  lat: number,
  lng: number
): { org: RescueOrg; distanceKm: number } {
  const candidates = RESCUE_ORGS.filter((o) => o.handledSpecies.includes(speciesCategory));
  const pool = candidates.length > 0 ? candidates : RESCUE_ORGS;
  let best = pool[0];
  let bestDist = haversineKm(lat, lng, best.lat, best.lng);
  for (const org of pool.slice(1)) {
    const d = haversineKm(lat, lng, org.lat, org.lng);
    if (d < bestDist) {
      best = org;
      bestDist = d;
    }
  }
  return { org: best, distanceKm: Math.round(bestDist * 10) / 10 };
}

export function findDuplicateSighting(
  sightings: Sighting[],
  speciesCategory: SpeciesCategory,
  lat: number,
  lng: number,
  timestampIso: string
): Sighting | undefined {
  const targetTime = new Date(timestampIso).getTime();
  const sixHoursMs = 6 * 3600 * 1000;
  for (const s of sightings) {
    if (s.rescueStatus === 'Resolved') continue;
    if (s.speciesCategory !== speciesCategory) continue;
    const sTime = new Date(s.timestamp).getTime();
    if (Math.abs(targetTime - sTime) > sixHoursMs) continue;
    const sLat = s.exactLat ?? s.lat;
    const sLng = s.exactLng ?? s.lng;
    if (haversineKm(lat, lng, sLat, sLng) <= 1.5) {
      return s;
    }
  }
  return undefined;
}

export function computeClusterAlerts(sightings: Sighting[]): ClusterAlert[] {
  const now = Date.now();
  const windowMs = 14 * 86400000;
  const rescueCases = sightings.filter(
    (s) =>
      s.classification === 'Possible rescue case' &&
      now - new Date(s.timestamp).getTime() <= windowMs
  );

  const visited = new Set<string>();
  const alerts: ClusterAlert[] = [];

  for (const seed of rescueCases) {
    if (visited.has(seed.id)) continue;
    const seedLat = seed.exactLat ?? seed.lat;
    const seedLng = seed.exactLng ?? seed.lng;
    const cluster = rescueCases.filter((other) => {
      const oLat = other.exactLat ?? other.lat;
      const oLng = other.exactLng ?? other.lng;
      return haversineKm(seedLat, seedLng, oLat, oLng) <= 15;
    });

    if (cluster.length >= 3) {
      cluster.forEach((c) => visited.add(c.id));
      const avgLat = cluster.reduce((acc, c) => acc + (c.exactLat ?? c.lat), 0) / cluster.length;
      const avgLng = cluster.reduce((acc, c) => acc + (c.exactLng ?? c.lng), 0) / cluster.length;
      let maxDist = 0;
      const conditionCounts: Record<string, number> = {};
      for (const c of cluster) {
        const d = haversineKm(avgLat, avgLng, c.exactLat ?? c.lat, c.exactLng ?? c.lng);
        if (d > maxDist) maxDist = d;
        conditionCounts[c.conditionAssessment] = (conditionCounts[c.conditionAssessment] || 0) + 1;
      }
      const dominantCondition = Object.entries(conditionCounts).sort((a, b) => b[1] - a[1])[0][0];
      const latestTime = cluster
        .map((c) => c.timestamp)
        .sort()
        .reverse()[0];

      alerts.push({
        id: `cluster-${cluster[0].id}`,
        region: seed.region,
        centerLat: Number(avgLat.toFixed(4)),
        centerLng: Number(avgLng.toFixed(4)),
        radiusKm: Math.max(3, Math.round(maxDist * 10) / 10),
        caseCount: cluster.length,
        dominantCondition,
        sightingIds: cluster.map((c) => c.id),
        createdAt: latestTime,
        severity: cluster.length >= 4 ? 'critical' : 'elevated',
        message: `${cluster.length} ${dominantCondition}/injury cases clustered within ${Math.max(3, Math.round(maxDist * 10) / 10)} km in ${seed.region}`,
      });
    }
  }
  return alerts;
}

export function computeLeaderboard(sightings: Sighting[]): LeaderboardEntry[] {
  const byUser: Record<
    string,
    {
      contributorId: string;
      contributorName: string;
      sightingCount: number;
      rescueReports: number;
      species: Set<SpeciesCategory>;
      hasIndividualMatch: boolean;
    }
  > = {};

  const recordContribution = (
    id: string,
    name: string,
    species: SpeciesCategory,
    isRescue: boolean,
    hasIndividual: boolean
  ) => {
    if (!byUser[id]) {
      byUser[id] = {
        contributorId: id,
        contributorName: name,
        sightingCount: 0,
        rescueReports: 0,
        species: new Set<SpeciesCategory>(),
        hasIndividualMatch: false,
      };
    }
    byUser[id].sightingCount += 1;
    if (isRescue) byUser[id].rescueReports += 1;
    byUser[id].species.add(species);
    if (hasIndividual) byUser[id].hasIndividualMatch = true;
  };

  for (const s of sightings) {
    recordContribution(
      s.contributorId,
      s.contributorName,
      s.speciesCategory,
      s.classification === 'Possible rescue case',
      Boolean(s.individualId)
    );
    for (const m of s.mergedReports) {
      recordContribution(
        m.contributorId,
        m.contributorName,
        s.speciesCategory,
        s.classification === 'Possible rescue case',
        Boolean(s.individualId)
      );
    }
  }

  return Object.values(byUser)
    .map((u) => {
      const badges: string[] = [];
      if (u.sightingCount >= 1) badges.push('First Spotter');
      if (u.rescueReports >= 1) badges.push('Rescue Guardian');
      if (u.species.size >= 3) badges.push('Multi-Species Tracker');
      if (u.sightingCount >= 3) badges.push('Field Veteran');
      if (u.hasIndividualMatch) badges.push('Photo-ID Pioneer');
      const score = u.sightingCount * 25 + u.rescueReports * 40 + u.species.size * 15 + badges.length * 10;
      return {
        contributorId: u.contributorId,
        contributorName: u.contributorName,
        sightingCount: u.sightingCount,
        rescueReports: u.rescueReports,
        speciesCount: u.species.size,
        badges,
        score,
      };
    })
    .sort((a, b) => b.score - a.score);
}

export function buildAnonymizedExport(sightings: Sighting[], format: 'csv' | 'geojson') {
  const anonymized = sightings.map((s) => {
    // Fuzz sensitive coordinates to 0.05 deg grid (~5.5 km) and strip contributor PII
    const exportLat = s.isSensitiveSite ? Math.round(s.lat * 20) / 20 : Number(s.lat.toFixed(4));
    const exportLng = s.isSensitiveSite ? Math.round(s.lng * 20) / 20 : Number(s.lng.toFixed(4));
    return {
      sighting_id: s.id,
      species_category: s.speciesCategory,
      common_name: s.commonName,
      scientific_name: s.scientificName,
      classification: s.classification,
      condition: s.conditionAssessment,
      confidence_pct: s.confidence,
      region: s.region,
      timestamp_utc: s.timestamp,
      lat: exportLat,
      lng: exportLng,
      coordinates_fuzzed_0_05_deg: s.isSensitiveSite,
      rescue_status: s.rescueStatus,
      report_count: s.reportCount,
      individual_catalog_id: s.individualId || null,
    };
  });

  if (format === 'geojson') {
    return JSON.stringify(
      {
        type: 'FeatureCollection',
        metadata: {
          dataset: 'PelagicWatch Anonymized Marine Wildlife Sightings',
          generatedAt: new Date().toISOString(),
          privacyNote:
            'Contributor identifiers stripped; sensitive rookery/nesting sites quantized to 0.05 degree grid cells.',
        },
        features: anonymized.map((row) => ({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [row.lng, row.lat],
          },
          properties: row,
        })),
      },
      null,
      2
    );
  }

  const headers = Object.keys(anonymized[0] || {});
  const csvEscape = (v: unknown) => {
    const str = v === null || v === undefined ? '' : String(v);
    if (/[",\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const lines = [
    headers.join(','),
    ...anonymized.map((row) => headers.map((h) => csvEscape((row as Record<string, unknown>)[h])).join(',')),
  ];
  return lines.join('\n');
}

// --- Rescue Team Authentication Helpers ---

export function hashPasscode(passcode: string, saltHex?: string): { hash: string; salt: string } {
  const salt = saltHex || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(passcode, salt, 64).toString('hex');
  return { hash: derived, salt };
}

export function verifyPasscode(passcode: string, store: ConservationStore): boolean {
  const envPasscode = (process.env.RESCUE_PORTAL_PASSCODE || '').trim();
  if (envPasscode.length > 0) {
    const a = Buffer.from(passcode);
    const b = Buffer.from(envPasscode);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  if (!store.rescuePasscodeHash || !store.rescuePasscodeSalt) {
    return false;
  }
  const derived = crypto.scryptSync(passcode, store.rescuePasscodeSalt, 64);
  const expected = Buffer.from(store.rescuePasscodeHash, 'hex');
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

export function isPasscodeConfigured(store: ConservationStore): boolean {
  const envPasscode = (process.env.RESCUE_PORTAL_PASSCODE || '').trim();
  return envPasscode.length > 0 || Boolean(store.rescuePasscodeHash && store.rescuePasscodeSalt);
}

export interface RescueTokenPayload {
  orgId: string;
  orgName: string;
  exp: number;
}

export function signRescueToken(org: RescueOrg): string {
  const payload: RescueTokenPayload = {
    orgId: org.id,
    orgName: org.name,
    exp: Date.now() + 12 * 3600 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyRescueToken(authHeader: string | undefined): RescueTokenPayload | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as RescueTokenPayload;
    if (!payload.orgId || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export { HAZARD_ZONES, RESCUE_ORGS };
