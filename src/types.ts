export type SpeciesCategory =
  | 'seal'
  | 'whale'
  | 'dolphin'
  | 'sea_turtle'
  | 'seabird'
  | 'other_marine';

export type SightingClassification = 'Healthy sighting' | 'Possible rescue case';
export type ConditionAssessment = 'healthy' | 'injured' | 'entangled' | 'stranded' | 'distressed';
export type RescueStatus = 'Reported' | 'Responding' | 'Resolved' | 'Not needed';

export interface MergedReport {
  id: string;
  contributorId: string;
  contributorName: string;
  photoUrl: string;
  timestamp: string;
  lat: number;
  lng: number;
  notes: string;
}

export interface Sighting {
  id: string;
  speciesCategory: SpeciesCategory;
  commonName: string;
  scientificName: string;
  classification: SightingClassification;
  conditionAssessment: ConditionAssessment;
  confidence: number;
  aiNotes: string;
  visibleMarkings: string;
  photoUrl: string;
  lat: number;
  lng: number;
  exactLat?: number; // Masked on public responses if isSensitiveSite is true
  exactLng?: number;
  isSensitiveSite: boolean;
  sensitiveReason?: string;
  locationLabel: string;
  region: string;
  timestamp: string;
  contributorId: string;
  contributorName: string;
  rescueStatus: RescueStatus;
  alertedOrgId?: string;
  alertedOrgName?: string;
  responderNotes?: string;
  updatedAt: string;
  reportCount: number;
  mergedReports: MergedReport[];
  individualId?: string;
  individualName?: string;
  individualMatchReason?: string;
}

export interface RescueOrg {
  id: string;
  name: string;
  region: string;
  handledSpecies: SpeciesCategory[];
  lat: number;
  lng: number;
  phone: string;
  dispatchEmail: string;
}

export interface ClusterAlert {
  id: string;
  region: string;
  centerLat: number;
  centerLng: number;
  radiusKm: number;
  caseCount: number;
  dominantCondition: string;
  sightingIds: string[];
  createdAt: string;
  severity: 'elevated' | 'critical';
  message: string;
}

export interface NotificationItem {
  id: string;
  contributorId: string;
  sightingId: string;
  speciesName: string;
  status: RescueStatus;
  orgName: string;
  message: string;
  createdAt: string;
  read: boolean;
}

export interface HazardZone {
  id: string;
  type: 'boat_traffic' | 'fishing_zone' | 'pollution_area';
  name: string;
  description: string;
  severity: 'moderate' | 'high';
  geometryType: 'polygon' | 'polyline';
  coordinates: { lat: number; lng: number }[];
}

export interface IndividualAnimal {
  id: string;
  name: string;
  speciesCategory: SpeciesCategory;
  commonName: string;
  identifyingFeatures: string;
  sightingIds: string[];
  firstSeen: string;
  lastSeen: string;
}

export interface LeaderboardEntry {
  contributorId: string;
  contributorName: string;
  sightingCount: number;
  rescueReports: number;
  speciesCount: number;
  badges: string[];
  score: number;
}

export interface AnalysisResult {
  speciesCategory: SpeciesCategory;
  commonName: string;
  scientificName: string;
  conditionAssessment: ConditionAssessment;
  classification: SightingClassification;
  confidence: number;
  aiNotes: string;
  visibleMarkings: string;
  isSensitiveHabitat: boolean;
  sensitiveReason: string;
}

export interface QueuedOfflineSighting {
  localId: string;
  photoDataUrl: string;
  lat: number;
  lng: number;
  timestamp: string;
  notes: string;
  contributorId: string;
  contributorName: string;
  createdAt: string;
}

export interface SpeciesSafetyRule {
  category: SpeciesCategory;
  distanceRule: string;
  legalNote: string;
  warningMessage: string;
}
