import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs';
import path from 'path';
import {
  buildAnonymizedExport,
  checkSensitiveSite,
  computeClusterAlerts,
  computeLeaderboard,
  detectRegion,
  findDuplicateSighting,
  findNearestRescueOrg,
  getUploadFilePath,
  HAZARD_ZONES,
  hashPasscode,
  isPasscodeConfigured,
  loadStore,
  obfuscateCoordinates,
  RESCUE_ORGS,
  sanitizeSightingForPublic,
  saveStore,
  saveUploadedImage,
  signRescueToken,
  verifyPasscode,
  verifyRescueToken,
} from './server/db.ts';
import { SPECIES_SAFETY_RULES } from './src/i18n.ts';
import type {
  AnalysisResult,
  IndividualAnimal,
  RescueStatus,
  Sighting,
  SpeciesCategory,
} from './src/types.ts';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '12mb' }));

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const VALID_SPECIES: SpeciesCategory[] = [
  'seal',
  'whale',
  'dolphin',
  'sea_turtle',
  'seabird',
  'other_marine',
];

function normalizeSpeciesCategory(val: string): SpeciesCategory {
  if ((VALID_SPECIES as string[]).includes(val)) {
    return val as SpeciesCategory;
  }
  return 'other_marine';
}

// --- API Routes ---

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'PelagicWatch API' });
});

app.get('/api/uploads/:fileName', (req, res) => {
  const filePath = getUploadFilePath(req.params.fileName);
  if (!filePath) {
    res.status(404).json({ error: 'Image not found' });
    return;
  }
  res.sendFile(filePath);
});

app.post('/api/analyze-sighting', async (req, res) => {
  try {
    const { imageBase64, mimeType, notes } = req.body as {
      imageBase64?: string;
      mimeType?: string;
      notes?: string;
    };

    if (!imageBase64 || typeof imageBase64 !== 'string') {
      res.status(400).json({ error: 'Missing imageBase64 payload.' });
      return;
    }

    const cleanMime =
      mimeType && /^image\/(jpeg|jpg|png|webp)$/i.test(mimeType)
        ? mimeType.toLowerCase() === 'image/jpg'
          ? 'image/jpeg'
          : mimeType.toLowerCase()
        : 'image/jpeg';

    const base64Body = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    if (base64Body.length < 32 || base64Body.length > 10 * 1024 * 1024) {
      res.status(400).json({ error: 'Image payload size is invalid or exceeds 10MB.' });
      return;
    }

    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error:
          'GEMINI_API_KEY is not configured on the server. Please add it in Settings > Secrets.',
      });
      return;
    }

    const userNotes = typeof notes === 'string' ? notes.slice(0, 500) : '';

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: cleanMime,
              data: base64Body,
            },
          },
          {
            text: `Analyze this marine wildlife photograph for a conservation and rescue dispatch platform.
Observer field notes: "${userNotes || 'None provided'}".
Identify:
1. speciesCategory: one of "seal", "whale", "dolphin", "sea_turtle", "seabird", "other_marine".
2. commonName and scientificName.
3. conditionAssessment: one of "healthy", "injured", "entangled", "stranded", "distressed". Look carefully for fishing line, netting, plastic bands, boat propeller scars, bleeding wounds, oil fouling, abnormal beach stranding, or lethargy.
4. classification: "Possible rescue case" if any injury, entanglement, stranding, or distress is visible (or suspected from notes); otherwise "Healthy sighting".
5. confidence: integer 0-100 representing identification and triage certainty.
6. aiNotes: 1-2 concise clinical sentences describing observed posture, markings, and any trauma/entanglement signs.
7. visibleMarkings: specific visual identifiers (dorsal fin notches, fluke pigmentation, carapace scute patterns, scars, tags) for individual animal re-identification.
8. isSensitiveHabitat: true if the photo appears to show a seal/sea lion pupping rookery, sea turtle nesting beach/hatchlings, or seabird nesting colony.
9. sensitiveReason: short reason if isSensitiveHabitat is true, otherwise empty string.`,
          },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            speciesCategory: {
              type: Type.STRING,
              description: 'seal | whale | dolphin | sea_turtle | seabird | other_marine',
            },
            commonName: { type: Type.STRING },
            scientificName: { type: Type.STRING },
            conditionAssessment: {
              type: Type.STRING,
              description: 'healthy | injured | entangled | stranded | distressed',
            },
            classification: {
              type: Type.STRING,
              description: 'Healthy sighting | Possible rescue case',
            },
            confidence: { type: Type.INTEGER },
            aiNotes: { type: Type.STRING },
            visibleMarkings: { type: Type.STRING },
            isSensitiveHabitat: { type: Type.BOOLEAN },
            sensitiveReason: { type: Type.STRING },
          },
          required: [
            'speciesCategory',
            'commonName',
            'scientificName',
            'conditionAssessment',
            'classification',
            'confidence',
            'aiNotes',
            'visibleMarkings',
            'isSensitiveHabitat',
            'sensitiveReason',
          ],
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim()) as Partial<AnalysisResult>;
    const speciesCategory = normalizeSpeciesCategory(String(parsed.speciesCategory || 'other_marine'));
    const condition =
      parsed.conditionAssessment &&
      ['healthy', 'injured', 'entangled', 'stranded', 'distressed'].includes(parsed.conditionAssessment)
        ? parsed.conditionAssessment
        : 'healthy';
    const classification =
      parsed.classification === 'Possible rescue case' || condition !== 'healthy'
        ? 'Possible rescue case'
        : 'Healthy sighting';

    const analysis: AnalysisResult = {
      speciesCategory,
      commonName: String(parsed.commonName || 'Marine Wildlife').slice(0, 80),
      scientificName: String(parsed.scientificName || 'Species indet.').slice(0, 80),
      conditionAssessment: condition,
      classification,
      confidence: Math.min(100, Math.max(10, Number(parsed.confidence) || 80)),
      aiNotes: String(parsed.aiNotes || 'Visual assessment completed.').slice(0, 400),
      visibleMarkings: String(parsed.visibleMarkings || 'No distinct markings recorded.').slice(0, 300),
      isSensitiveHabitat: Boolean(parsed.isSensitiveHabitat),
      sensitiveReason: String(parsed.sensitiveReason || '').slice(0, 160),
    };

    res.json({
      analysis,
      safetyRule: SPECIES_SAFETY_RULES[speciesCategory],
    });
  } catch (err) {
    console.error('Gemini analyze-sighting error:', err);
    const message = err instanceof Error ? err.message : 'AI analysis failed';
    res.status(502).json({ error: `AI triage error: ${message}` });
  }
});

app.get('/api/sightings', (req, res) => {
  const store = loadStore();
  const token = verifyRescueToken(req.headers.authorization);
  const includeExact = Boolean(token);
  const sightings = store.sightings
    .slice()
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .map((s) => sanitizeSightingForPublic(s, includeExact));

  const clusterAlerts = computeClusterAlerts(store.sightings);
  res.json({
    sightings,
    clusterAlerts,
    hazards: HAZARD_ZONES,
    individuals: store.individuals,
    rescueOrgs: RESCUE_ORGS,
  });
});

async function attemptIndividualMatch(
  newSighting: {
    speciesCategory: SpeciesCategory;
    commonName: string;
    visibleMarkings: string;
    imageBase64?: string;
  },
  existingIndividuals: IndividualAnimal[]
): Promise<{ individualId?: string; individualName?: string; reason?: string }> {
  const candidates = existingIndividuals.filter(
    (ind) => ind.speciesCategory === newSighting.speciesCategory
  );
  if (candidates.length === 0 || !newSighting.visibleMarkings) {
    return {};
  }

  const ai = getGeminiClient();
  if (!ai) return {};

  try {
    const candidateSummary = candidates
      .map(
        (c) =>
          `ID: ${c.id} | Name: ${c.name} | Species: ${c.commonName} | Features: ${c.identifyingFeatures}`
      )
      .join('\n');

    const promptText = `You are a marine wildlife photo-ID catalog matcher.
New sighting (${newSighting.commonName}) visible markings: "${newSighting.visibleMarkings}".
Cataloged individuals of the same species:
${candidateSummary}

Determine if the new sighting clearly matches one of the cataloged individuals based on distinctive permanent markings (notches, scars, pigment patterns). Only return matched: true if features strongly align. Return JSON.`;

    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
    if (newSighting.imageBase64) {
      parts.push({
        inlineData: {
          mimeType: 'image/jpeg',
          data: newSighting.imageBase64.replace(/^data:image\/\w+;base64,/, ''),
        },
      });
    }
    parts.push({ text: promptText });

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: { parts },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            matched: { type: Type.BOOLEAN },
            individualId: { type: Type.STRING },
            reason: { type: Type.STRING },
          },
          required: ['matched', 'individualId', 'reason'],
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim()) as {
      matched?: boolean;
      individualId?: string;
      reason?: string;
    };

    if (parsed.matched && parsed.individualId) {
      const found = candidates.find((c) => c.id === parsed.individualId);
      if (found) {
        return {
          individualId: found.id,
          individualName: found.name,
          reason: String(parsed.reason || 'Matched distinguishing field markings.').slice(0, 240),
        };
      }
    }
  } catch (err) {
    console.warn('Individual match skipped due to AI error:', err);
  }
  return {};
}

app.post('/api/sightings', async (req, res) => {
  try {
    const body = req.body as {
      imageBase64?: string;
      mimeType?: string;
      lat?: number;
      lng?: number;
      timestamp?: string;
      locationLabel?: string;
      contributorId?: string;
      contributorName?: string;
      notes?: string;
      analysis?: AnalysisResult;
    };

    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      res.status(400).json({ error: 'Valid GPS coordinates (lat, lng) are required.' });
      return;
    }

    if (!body.analysis || !body.analysis.commonName) {
      res.status(400).json({ error: 'AI analysis result is required before submission.' });
      return;
    }

    const store = loadStore();
    const speciesCategory = normalizeSpeciesCategory(body.analysis.speciesCategory);
    const timestamp =
      body.timestamp && !Number.isNaN(Date.parse(body.timestamp))
        ? new Date(body.timestamp).toISOString()
        : new Date().toISOString();

    const contributorId =
      typeof body.contributorId === 'string' && body.contributorId.trim().length > 0
        ? body.contributorId.trim().slice(0, 64)
        : 'anon-spotter';
    const contributorName =
      typeof body.contributorName === 'string' && body.contributorName.trim().length > 0
        ? body.contributorName.trim().slice(0, 60)
        : 'Coastal Spotter';

    let photoUrl = '/src/assets/images/sighting_harbor_seal_1795293498628.jpg';
    if (body.imageBase64 && typeof body.imageBase64 === 'string' && body.imageBase64.length > 50) {
      photoUrl = saveUploadedImage(body.imageBase64, body.mimeType || 'image/jpeg');
    }

    // 1. Duplicate Report Detection & Merging (within 1.5km & 6h for same species)
    const duplicate = findDuplicateSighting(store.sightings, speciesCategory, lat, lng, timestamp);
    if (duplicate) {
      const mergedReportId = `rep-${Date.now()}`;
      duplicate.mergedReports.push({
        id: mergedReportId,
        contributorId,
        contributorName,
        photoUrl,
        timestamp,
        lat,
        lng,
        notes: typeof body.notes === 'string' ? body.notes.slice(0, 300) : body.analysis.aiNotes,
      });
      duplicate.reportCount = 1 + duplicate.mergedReports.length;
      duplicate.updatedAt = new Date().toISOString();

      // Escalate if new duplicate sees injury/entanglement
      if (
        body.analysis.classification === 'Possible rescue case' &&
        duplicate.classification !== 'Possible rescue case'
      ) {
        duplicate.classification = 'Possible rescue case';
        duplicate.conditionAssessment = body.analysis.conditionAssessment;
        duplicate.rescueStatus = 'Reported';
        const { org } = findNearestRescueOrg(speciesCategory, lat, lng);
        duplicate.alertedOrgId = org.id;
        duplicate.alertedOrgName = org.name;
      }

      saveStore(store);
      const clusterAlerts = computeClusterAlerts(store.sightings);
      res.status(200).json({
        merged: true,
        mergedIntoId: duplicate.id,
        sighting: sanitizeSightingForPublic(duplicate, false),
        clusterAlerts,
        safetyRule: SPECIES_SAFETY_RULES[speciesCategory],
      });
      return;
    }

    // 2. Sensitive Site Location Masking
    const sensitivity = checkSensitiveSite(
      lat,
      lng,
      body.analysis.isSensitiveHabitat,
      body.analysis.sensitiveReason
    );

    const sightingId = `sight-${Date.now().toString(36)}`;
    const publicCoords = sensitivity.isSensitive
      ? obfuscateCoordinates(lat, lng, sightingId)
      : { lat: Number(lat.toFixed(4)), lng: Number(lng.toFixed(4)) };

    // 3. Nearest Rescue Organization Alerting
    const isRescue = body.analysis.classification === 'Possible rescue case';
    let alertedOrgId: string | undefined;
    let alertedOrgName: string | undefined;
    let rescueDispatchDistanceKm: number | undefined;
    if (isRescue) {
      const nearest = findNearestRescueOrg(speciesCategory, lat, lng);
      alertedOrgId = nearest.org.id;
      alertedOrgName = nearest.org.name;
      rescueDispatchDistanceKm = nearest.distanceKm;
    }

    // 4. Individual Animal Matching (Photo-ID)
    const match = await attemptIndividualMatch(
      {
        speciesCategory,
        commonName: body.analysis.commonName,
        visibleMarkings: body.analysis.visibleMarkings,
        imageBase64: body.imageBase64,
      },
      store.individuals
    );

    let individualId = match.individualId;
    let individualName = match.individualName;
    let individualMatchReason = match.reason;

    if (individualId) {
      const existingInd = store.individuals.find((i) => i.id === individualId);
      if (existingInd) {
        existingInd.sightingIds.push(sightingId);
        existingInd.lastSeen = timestamp;
      }
    } else if (
      body.analysis.visibleMarkings &&
      body.analysis.visibleMarkings.length > 18 &&
      !body.analysis.visibleMarkings.toLowerCase().includes('no distinct')
    ) {
      // Auto-catalog new distinguishable individual for future tracking
      const prefixMap: Record<SpeciesCategory, string> = {
        whale: 'MN',
        dolphin: 'TT',
        seal: 'PV',
        sea_turtle: 'CM',
        seabird: 'PO',
        other_marine: 'MR',
      };
      const newIndId = `IND-${prefixMap[speciesCategory]}-${String(store.individuals.length + 101)}`;
      const newIndName = `${body.analysis.commonName.split(' ').pop() || 'Marine'} #${store.individuals.length + 101}`;
      store.individuals.push({
        id: newIndId,
        name: newIndName,
        speciesCategory,
        commonName: body.analysis.commonName,
        identifyingFeatures: body.analysis.visibleMarkings,
        sightingIds: [sightingId],
        firstSeen: timestamp,
        lastSeen: timestamp,
      });
      individualId = newIndId;
      individualName = newIndName;
      individualMatchReason = 'New individual profile registered in photo-ID catalog.';
    }

    const region = detectRegion(lat, lng);
    const defaultLabel = sensitivity.isSensitive
      ? `${region} Protected Buffer (Masked)`
      : typeof body.locationLabel === 'string' && body.locationLabel.trim().length > 0
        ? body.locationLabel.trim().slice(0, 80)
        : `${region} Coastal Sector`;

    const newSighting: Sighting = {
      id: sightingId,
      speciesCategory,
      commonName: body.analysis.commonName,
      scientificName: body.analysis.scientificName,
      classification: body.analysis.classification,
      conditionAssessment: body.analysis.conditionAssessment,
      confidence: body.analysis.confidence,
      aiNotes: body.analysis.aiNotes,
      visibleMarkings: body.analysis.visibleMarkings,
      photoUrl,
      lat: publicCoords.lat,
      lng: publicCoords.lng,
      exactLat: Number(lat.toFixed(5)),
      exactLng: Number(lng.toFixed(5)),
      isSensitiveSite: sensitivity.isSensitive,
      sensitiveReason: sensitivity.reason,
      locationLabel: defaultLabel,
      region,
      timestamp,
      contributorId,
      contributorName,
      rescueStatus: isRescue ? 'Reported' : 'Not needed',
      alertedOrgId,
      alertedOrgName,
      updatedAt: new Date().toISOString(),
      reportCount: 1,
      mergedReports: [],
      individualId,
      individualName,
      individualMatchReason,
    };

    store.sightings.unshift(newSighting);
    saveStore(store);

    const clusterAlerts = computeClusterAlerts(store.sightings);

    res.status(201).json({
      merged: false,
      sighting: sanitizeSightingForPublic(newSighting, false),
      alertedOrgName,
      rescueDispatchDistanceKm,
      clusterAlerts,
      safetyRule: SPECIES_SAFETY_RULES[speciesCategory],
    });
  } catch (err) {
    console.error('Create sighting error:', err);
    res.status(500).json({ error: 'Failed to save sighting.' });
  }
});

// --- Rescue Team Authentication & Case Management ---

app.get('/api/rescue/auth-status', (_req, res) => {
  const store = loadStore();
  res.json({
    setupRequired: !isPasscodeConfigured(store),
    orgs: RESCUE_ORGS,
  });
});

app.post('/api/rescue/setup-passcode', (req, res) => {
  const store = loadStore();
  if (isPasscodeConfigured(store)) {
    res.status(409).json({ error: 'Rescue portal passcode is already configured.' });
    return;
  }
  const { passcode, orgId } = req.body as { passcode?: string; orgId?: string };
  if (!passcode || typeof passcode !== 'string' || passcode.trim().length < 4) {
    res.status(400).json({ error: 'Passcode must be at least 4 characters.' });
    return;
  }
  const org = RESCUE_ORGS.find((o) => o.id === orgId) || RESCUE_ORGS[0];
  const { hash, salt } = hashPasscode(passcode.trim());
  store.rescuePasscodeHash = hash;
  store.rescuePasscodeSalt = salt;
  saveStore(store);

  const token = signRescueToken(org);
  res.json({ token, org });
});

app.post('/api/rescue/login', (req, res) => {
  const store = loadStore();
  if (!isPasscodeConfigured(store)) {
    res.status(400).json({ error: 'Rescue portal passcode not yet initialized.' });
    return;
  }
  const { passcode, orgId } = req.body as { passcode?: string; orgId?: string };
  if (!passcode || typeof passcode !== 'string') {
    res.status(400).json({ error: 'Passcode is required.' });
    return;
  }
  if (!verifyPasscode(passcode.trim(), store)) {
    res.status(401).json({ error: 'Invalid rescue portal passcode.' });
    return;
  }
  const org = RESCUE_ORGS.find((o) => o.id === orgId) || RESCUE_ORGS[0];
  const token = signRescueToken(org);
  res.json({ token, org });
});

app.get('/api/rescue/cases', (req, res) => {
  const payload = verifyRescueToken(req.headers.authorization);
  if (!payload) {
    res.status(401).json({ error: 'Rescue organization authentication required.' });
    return;
  }
  const store = loadStore();
  const cases = store.sightings
    .filter((s) => s.classification === 'Possible rescue case')
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .map((s) => sanitizeSightingForPublic(s, true));

  const clusterAlerts = computeClusterAlerts(store.sightings);
  res.json({
    org: RESCUE_ORGS.find((o) => o.id === payload.orgId) || RESCUE_ORGS[0],
    cases,
    clusterAlerts,
  });
});

app.patch('/api/rescue/cases/:id', (req, res) => {
  const payload = verifyRescueToken(req.headers.authorization);
  if (!payload) {
    res.status(401).json({ error: 'Rescue organization authentication required.' });
    return;
  }

  const { status, responderNotes } = req.body as {
    status?: RescueStatus;
    responderNotes?: string;
  };

  if (status !== 'Responding' && status !== 'Resolved') {
    res.status(400).json({ error: 'Status must be "Responding" or "Resolved".' });
    return;
  }

  const store = loadStore();
  const sighting = store.sightings.find((s) => s.id === req.params.id);
  if (!sighting) {
    res.status(404).json({ error: 'Rescue case not found.' });
    return;
  }

  sighting.rescueStatus = status;
  if (typeof responderNotes === 'string' && responderNotes.trim().length > 0) {
    sighting.responderNotes = responderNotes.trim().slice(0, 400);
  }
  sighting.alertedOrgId = payload.orgId;
  sighting.alertedOrgName = payload.orgName;
  sighting.updatedAt = new Date().toISOString();

  // Notify original uploader and any merged contributors
  const recipients = new Set<string>([sighting.contributorId]);
  sighting.mergedReports.forEach((m) => recipients.add(m.contributorId));

  recipients.forEach((contributorId) => {
    store.notifications.unshift({
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      contributorId,
      sightingId: sighting.id,
      speciesName: sighting.commonName,
      status,
      orgName: payload.orgName,
      message: `${payload.orgName} updated your ${sighting.commonName} report to "${status}"${
        sighting.responderNotes ? `: ${sighting.responderNotes}` : '.'
      }`,
      createdAt: new Date().toISOString(),
      read: false,
    });
  });

  saveStore(store);
  res.json({
    sighting: sanitizeSightingForPublic(sighting, true),
    notifiedCount: recipients.size,
  });
});

// --- Notifications, Stats, Leaderboard, Export ---

app.get('/api/notifications', (req, res) => {
  const contributorId = String(req.query.contributorId || '').trim();
  if (!contributorId) {
    res.json({ notifications: [] });
    return;
  }
  const store = loadStore();
  const list = store.notifications.filter((n) => n.contributorId === contributorId);
  res.json({ notifications: list });
});

app.post('/api/notifications/read', (req, res) => {
  const { contributorId } = req.body as { contributorId?: string };
  if (!contributorId) {
    res.status(400).json({ error: 'contributorId required' });
    return;
  }
  const store = loadStore();
  store.notifications.forEach((n) => {
    if (n.contributorId === contributorId) n.read = true;
  });
  saveStore(store);
  res.json({ ok: true });
});

app.get('/api/stats', (_req, res) => {
  const store = loadStore();
  const sightings = store.sightings;

  const bySpecies: Record<string, { healthy: number; rescue: number; total: number }> = {};
  const byRegion: Record<string, { healthy: number; rescue: number; total: number }> = {};
  const byMonth: Record<string, { month: string; healthy: number; rescue: number; total: number }> = {};

  for (const s of sightings) {
    const isRescue = s.classification === 'Possible rescue case';
    if (!bySpecies[s.speciesCategory]) {
      bySpecies[s.speciesCategory] = { healthy: 0, rescue: 0, total: 0 };
    }
    bySpecies[s.speciesCategory].total += 1;
    if (isRescue) bySpecies[s.speciesCategory].rescue += 1;
    else bySpecies[s.speciesCategory].healthy += 1;

    if (!byRegion[s.region]) {
      byRegion[s.region] = { healthy: 0, rescue: 0, total: 0 };
    }
    byRegion[s.region].total += 1;
    if (isRescue) byRegion[s.region].rescue += 1;
    else byRegion[s.region].healthy += 1;

    const d = new Date(s.timestamp);
    const monthKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!byMonth[monthKey]) {
      byMonth[monthKey] = { month: monthKey, healthy: 0, rescue: 0, total: 0 };
    }
    byMonth[monthKey].total += 1;
    if (isRescue) byMonth[monthKey].rescue += 1;
    else byMonth[monthKey].healthy += 1;
  }

  const monthlySeries = Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month));
  const leaderboard = computeLeaderboard(sightings);
  const clusterAlerts = computeClusterAlerts(sightings);

  res.json({
    totals: {
      totalSightings: sightings.length,
      totalReportsWithMerges: sightings.reduce((acc, s) => acc + s.reportCount, 0),
      rescueCases: sightings.filter((s) => s.classification === 'Possible rescue case').length,
      resolvedCases: sightings.filter((s) => s.rescueStatus === 'Resolved').length,
      catalogedIndividuals: store.individuals.length,
      activeClusters: clusterAlerts.length,
    },
    bySpecies,
    byRegion,
    monthlySeries,
    leaderboard,
    individuals: store.individuals,
  });
});

app.get('/api/export', (req, res) => {
  const format = req.query.format === 'geojson' ? 'geojson' : 'csv';
  const store = loadStore();
  const payload = buildAnonymizedExport(store.sightings, format);
  if (format === 'geojson') {
    res.setHeader('Content-Type', 'application/geo+json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="pelagicwatch_anonymized_sightings.geojson"');
  } else {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="pelagicwatch_anonymized_sightings.csv"');
  }
  res.send(payload);
});

// --- Server Startup (Vite Dev Middleware or Static Production) ---

async function startServer() {
  const isProd =
    process.env.NODE_ENV === 'production' || process.env.npm_lifecycle_event === 'start';

  if (isProd && fs.existsSync(path.resolve('dist/index.html'))) {
    const distPath = path.resolve('dist');
    app.use(express.static(distPath));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`PelagicWatch server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
