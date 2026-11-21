import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import {
  AlertTriangle,
  CheckCircle2,
  Flame,
  Globe,
  Layers,
  Lock,
  Plus,
  Share2,
  ShieldAlert,
  Siren,
  WifiOff,
} from 'lucide-react';
import { ConservationMap } from './components/ConservationMap';
import { InsightsView } from './components/InsightsView';
import { LogbookView } from './components/LogbookView';
import { ReportSightingModal } from './components/ReportSightingModal';
import { RescueDeskView } from './components/RescueDeskView';
import { SafetyPopupModal } from './components/SafetyPopupModal';
import { ShareCardModal } from './components/ShareCardModal';
import { SPECIES_SAFETY_RULES, TRANSLATIONS, type Locale } from './i18n';
import type {
  ClusterAlert,
  HazardZone,
  IndividualAnimal,
  NotificationItem,
  QueuedOfflineSighting,
  RescueOrg,
  Sighting,
  SpeciesCategory,
  SpeciesSafetyRule,
} from './types';
import { getOfflineQueue, removeOfflineSighting } from './utils/offlineQueue';
import { OfflineIndicator, PWAInstallButton, useOnlineStatus } from './utils/pwa';

type ActiveView = 'map' | 'rescue' | 'insights' | 'logbook';

export default function App() {
  const [activeView, setActiveView] = useState<ActiveView>('map');
  const [locale, setLocale] = useState<Locale>('en');
  const t = TRANSLATIONS[locale];

  // Google Maps quota state (Tier 2 banner)
  const [quotaExceeded, setQuotaExceeded] = useState(false);

  // Core conservation data
  const [sightings, setSightings] = useState<Sighting[]>([]);
  const [hazards, setHazards] = useState<HazardZone[]>([]);
  const [clusterAlerts, setClusterAlerts] = useState<ClusterAlert[]>([]);
  const [individuals, setIndividuals] = useState<IndividualAnimal[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  // Map filter & layer states
  const [speciesFilter, setSpeciesFilter] = useState<'all' | SpeciesCategory>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'healthy' | 'rescue'>('all');
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [heatmapWindow, setHeatmapWindow] = useState<'all' | '90d' | '30d' | '7d'>('all');
  const [showHazards, setShowHazards] = useState(true);
  const [selectedSightingId, setSelectedSightingId] = useState<string | null>(null);
  const [focusCoords, setFocusCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [activeIndividualId, setActiveIndividualId] = useState<string | null>(null);

  // Contributor & notifications state
  const [contributorId] = useState<string>('user-elena');
  const [contributorName, setContributorName] = useState<string>('Dr. Elena Rostova');
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  // Rescue team in-memory auth (never persisted in localStorage)
  const [rescueToken, setRescueToken] = useState<string | null>(null);
  const [activeOrg, setActiveOrg] = useState<RescueOrg | null>(null);

  // Modals
  const [reportOpen, setReportOpen] = useState(false);
  const [safetyModalState, setSafetyModalState] = useState<{
    open: boolean;
    sighting: Sighting | null;
    rule: SpeciesSafetyRule | null;
    merged?: boolean;
    alertedOrgName?: string;
    dispatchDistanceKm?: number;
  }>({ open: false, sighting: null, rule: null });
  const [shareSighting, setShareSighting] = useState<Sighting | null>(null);

  // Offline PWA queue & optional offline test toggle
  const realOnline = useOnlineStatus();
  const [simulatedOffline, setSimulatedOffline] = useState(false);
  const [offlineQueue, setOfflineQueue] = useState<QueuedOfflineSighting[]>([]);
  const [syncingOffline, setSyncingOffline] = useState(false);

  useEffect(() => {
    const onQuotaExceeded = () => setQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuotaExceeded);
    return () => window.removeEventListener('gmp-quota-exceeded', onQuotaExceeded);
  }, []);

  const loadSightings = useCallback(async () => {
    try {
      const headers: Record<string, string> = {};
      if (rescueToken) headers.Authorization = `Bearer ${rescueToken}`;
      const res = await fetch('/api/sightings', { headers });
      const data = await res.json();
      setSightings(data.sightings || []);
      setHazards(data.hazards || []);
      setClusterAlerts(data.clusterAlerts || []);
      setIndividuals(data.individuals || []);
    } catch {
      // keep cached state if offline
    } finally {
      setLoadingData(false);
    }
  }, [rescueToken]);

  const loadNotifications = useCallback(async () => {
    try {
      const res = await fetch(`/api/notifications?contributorId=${encodeURIComponent(contributorId)}`);
      const data = await res.json();
      setNotifications(data.notifications || []);
    } catch {
      // ignore offline
    }
  }, [contributorId]);

  useEffect(() => {
    loadSightings();
    loadNotifications();
    getOfflineQueue().then(setOfflineQueue).catch(() => {});
  }, [loadSightings, loadNotifications]);

  const syncOfflineQueue = useCallback(async () => {
    if (syncingOffline || !realOnline || simulatedOffline) return;
    const items = await getOfflineQueue();
    if (items.length === 0) return;

    setSyncingOffline(true);
    try {
      for (const item of items) {
        const analyzeRes = await fetch('/api/analyze-sighting', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: item.photoDataUrl,
            mimeType: 'image/jpeg',
            notes: item.notes,
          }),
        });
        if (!analyzeRes.ok) continue;
        const analyzeData = await analyzeRes.json();

        const submitRes = await fetch('/api/sightings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: item.photoDataUrl,
            mimeType: 'image/jpeg',
            lat: item.lat,
            lng: item.lng,
            timestamp: item.timestamp,
            contributorId: item.contributorId,
            contributorName: item.contributorName,
            notes: item.notes,
            analysis: analyzeData.analysis,
          }),
        });
        if (submitRes.ok) {
          await removeOfflineSighting(item.localId);
        }
      }
      const remaining = await getOfflineQueue();
      setOfflineQueue(remaining);
      await loadSightings();
    } finally {
      setSyncingOffline(false);
    }
  }, [syncingOffline, realOnline, simulatedOffline, loadSightings]);

  useEffect(() => {
    if (realOnline && !simulatedOffline && offlineQueue.length > 0) {
      syncOfflineQueue();
    }
  }, [realOnline, simulatedOffline, offlineQueue.length, syncOfflineQueue]);

  const filteredSightings = useMemo(() => {
    return sightings.filter((s) => {
      if (speciesFilter !== 'all' && s.speciesCategory !== speciesFilter) return false;
      if (statusFilter === 'healthy' && s.classification !== 'Healthy sighting') return false;
      if (statusFilter === 'rescue' && s.classification !== 'Possible rescue case') return false;
      return true;
    });
  }, [sightings, speciesFilter, statusFilter]);

  const unreadNotifications = notifications.filter((n) => !n.read).length;

  const handleOpenSafety = (s: Sighting) => {
    setSafetyModalState({
      open: true,
      sighting: s,
      rule: SPECIES_SAFETY_RULES[s.speciesCategory] || SPECIES_SAFETY_RULES.other_marine,
    });
  };

  const handleMarkNotificationsRead = async () => {
    await fetch('/api/notifications/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contributorId }),
    });
    loadNotifications();
  };

  const mapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

  return (
    <APIProvider apiKey={mapsApiKey} libraries={['marker']} language={locale}>
      <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
        {quotaExceeded && (
          <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
            <span>
              Google Maps Platform quota reached. If you are the app owner, visit{' '}
              <a
                href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-semibold text-amber-950 hover:text-amber-800"
              >
                maps developer site
              </a>{' '}
              for instructions to update your account.
            </span>
          </div>
        )}

        <OfflineIndicator simulatedOffline={simulatedOffline} label={t.offlineBanner} />

        {/* Strict 3-Zone Top Bar Contract */}
        <header className="bg-white border-b border-slate-200 sticky top-0 z-40">
          <div className="max-w-[1440px] mx-auto px-6 py-3.5 flex items-center justify-between gap-8">
            {/* Zone 1: Brand wordmark only */}
            <a
              href="#map"
              onClick={(e) => {
                e.preventDefault();
                setActiveView('map');
              }}
              className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
            >
              {t.brand}
            </a>

            {/* Zone 2: 4 clean single-line navigation links */}
            <nav className="flex items-center gap-6 text-sm font-medium overflow-x-auto">
              <button
                type="button"
                onClick={() => setActiveView('map')}
                className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                  activeView === 'map'
                    ? 'border-cyan-700 text-slate-900'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                {t.navMap}
              </button>
              <button
                type="button"
                onClick={() => setActiveView('rescue')}
                className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                  activeView === 'rescue'
                    ? 'border-cyan-700 text-slate-900'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                {t.navRescue}
              </button>
              <button
                type="button"
                onClick={() => setActiveView('insights')}
                className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                  activeView === 'insights'
                    ? 'border-cyan-700 text-slate-900'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                {t.navInsights}
              </button>
              <button
                type="button"
                onClick={() => setActiveView('logbook')}
                className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                  activeView === 'logbook'
                    ? 'border-cyan-700 text-slate-900'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                {t.navLogbook}
                {unreadNotifications > 0 && (
                  <span className="ml-1.5 font-mono text-xs text-cyan-700 tabular-nums">
                    ({unreadNotifications})
                  </span>
                )}
              </button>
            </nav>

            {/* Zone 3: 1 Primary Action */}
            <div className="shrink-0">
              <button
                type="button"
                onClick={() => setReportOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-700 px-4 py-2 text-xs font-medium text-white hover:bg-cyan-800 transition-colors whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                {t.reportSighting}
              </button>
            </div>
          </div>
        </header>

        {/* Workspace Toolbar */}
        <div className="bg-white border-b border-slate-200">
          <div className="max-w-[1440px] mx-auto px-6 py-2.5 flex flex-wrap items-center justify-between gap-4">
            {/* Species Filter Controls */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {(
                [
                  ['all', t.allSpecies],
                  ['seal', t.seal],
                  ['whale', t.whale],
                  ['dolphin', t.dolphin],
                  ['sea_turtle', t.sea_turtle],
                  ['seabird', t.seabird],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setSpeciesFilter(key);
                    if (activeView !== 'map') setActiveView('map');
                  }}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    speciesFilter === key
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Map Layers, Offline Toggle, PWA Install & Multi-Language Selector */}
            <div className="flex items-center gap-2.5 flex-wrap">
              {activeView === 'map' && (
                <>
                  <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-md">
                    {(['all', 'healthy', 'rescue'] as const).map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => setStatusFilter(st)}
                        className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                          statusFilter === st
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {st === 'all' ? 'All Status' : st === 'healthy' ? 'Healthy' : 'Rescue'}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowHeatmap((v) => !v)}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      showHeatmap
                        ? 'border-red-600 bg-red-50 text-red-800'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <Flame className="w-3.5 h-3.5" />
                    {t.heatmapLayer}
                  </button>

                  {showHeatmap && (
                    <select
                      aria-label="Heatmap time window"
                      value={heatmapWindow}
                      onChange={(e) =>
                        setHeatmapWindow(e.target.value as 'all' | '90d' | '30d' | '7d')
                      }
                      className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700"
                    >
                      <option value="all">All Time</option>
                      <option value="90d">Last 90d</option>
                      <option value="30d">Last 30d</option>
                      <option value="7d">Last 7d</option>
                    </select>
                  )}

                  <button
                    type="button"
                    onClick={() => setShowHazards((v) => !v)}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      showHazards
                        ? 'border-cyan-700 bg-cyan-50 text-cyan-900'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    {t.hazardLayer}
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => setSimulatedOffline((v) => !v)}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  simulatedOffline
                    ? 'border-amber-600 bg-amber-50 text-amber-900'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
                title="Test offline capture queue without disconnecting browser network"
              >
                <WifiOff className="w-3.5 h-3.5" />
                {t.simulateOffline}
                {offlineQueue.length > 0 && (
                  <span className="font-mono text-amber-800">({offlineQueue.length})</span>
                )}
              </button>

              <PWAInstallButton />

              <div className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1">
                <Globe className="w-3.5 h-3.5 text-slate-500" />
                <select
                  aria-label="Interface language"
                  value={locale}
                  onChange={(e) => setLocale(e.target.value as Locale)}
                  className="text-xs font-medium text-slate-700 bg-transparent focus:outline-none"
                >
                  <option value="en">EN</option>
                  <option value="es">ES</option>
                  <option value="fr">FR</option>
                  <option value="pt">PT</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content Viewport */}
        <main className="flex-1 max-w-[1440px] w-full mx-auto px-6 py-6 space-y-6">
          {activeView === 'map' && (
            <>
              {/* Cluster Early Warning Strip */}
              {clusterAlerts.length > 0 && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 text-xs md:text-sm text-red-950">
                    <Siren className="w-4 h-4 text-red-600 shrink-0" />
                    <span>
                      <strong>{t.clusterAlertTitle}:</strong> {clusterAlerts[0].message}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setFocusCoords({
                        lat: clusterAlerts[0].centerLat,
                        lng: clusterAlerts[0].centerLng,
                      });
                    }}
                    className="text-xs font-semibold text-red-800 underline hover:text-red-950 whitespace-nowrap shrink-0"
                  >
                    Center on Hotspot
                  </button>
                </div>
              )}

              {/* Map + Sightings Feed 2-Column Split */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
                <div className="lg:col-span-8">
                  <ConservationMap
                    sightings={filteredSightings}
                    hazards={hazards}
                    clusterAlerts={clusterAlerts}
                    individuals={individuals}
                    selectedSightingId={selectedSightingId}
                    onSelectSighting={(s) => setSelectedSightingId(s ? s.id : null)}
                    showHeatmap={showHeatmap}
                    heatmapWindow={heatmapWindow}
                    showHazards={showHazards}
                    activeIndividualId={activeIndividualId}
                    onSelectIndividual={setActiveIndividualId}
                    onOpenSafety={handleOpenSafety}
                    locale={locale}
                    focusCoords={focusCoords}
                  />
                </div>

                {/* Right Feed Panel */}
                <aside className="lg:col-span-4 rounded-xl border border-slate-200 bg-white flex flex-col max-h-[580px]">
                  <div className="px-4 py-3.5 border-b border-slate-200 flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-slate-900">
                      Recent Sightings ({filteredSightings.length})
                    </h2>
                    <span className="text-xs font-mono text-slate-500 tabular-nums">
                      {filteredSightings.filter((s) => s.classification === 'Possible rescue case').length} rescue
                    </span>
                  </div>

                  <div className="flex-1 overflow-y-auto divide-y divide-slate-200">
                    {loadingData ? (
                      <div className="p-6 text-center text-xs text-slate-500">
                        Loading marine sightings...
                      </div>
                    ) : filteredSightings.length === 0 ? (
                      <div className="p-8 text-center text-xs text-slate-500">
                        No sightings match the active filter.
                      </div>
                    ) : (
                      filteredSightings.map((s) => {
                        const isRescue = s.classification === 'Possible rescue case';
                        const isActive = s.id === selectedSightingId;
                        return (
                          <div
                            key={s.id}
                            className={`p-3.5 transition-colors cursor-pointer ${
                              isActive ? 'bg-cyan-50/70' : 'hover:bg-slate-50'
                            }`}
                            onClick={() => {
                              setSelectedSightingId(s.id);
                              setFocusCoords({ lat: s.lat, lng: s.lng });
                            }}
                          >
                            <div className="flex gap-3">
                              <img
                                src={s.photoUrl}
                                alt={s.commonName}
                                referrerPolicy="no-referrer"
                                className="w-20 h-16 rounded-md object-cover bg-slate-200 shrink-0"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-sm font-semibold text-slate-900 truncate">
                                    {s.commonName}
                                  </span>
                                  <span className="font-mono text-xs text-slate-500 tabular-nums shrink-0">
                                    {s.confidence}%
                                  </span>
                                </div>
                                <div className="mt-0.5 flex items-center gap-1.5 text-xs font-medium">
                                  {isRescue ? (
                                    <>
                                      <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                                      <span className="text-red-700">{t.possibleRescue}</span>
                                    </>
                                  ) : (
                                    <>
                                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                      <span className="text-emerald-700">{t.healthySighting}</span>
                                    </>
                                  )}
                                </div>
                                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500 truncate">
                                  {s.isSensitiveSite && <Lock className="w-3 h-3 text-amber-600 shrink-0" />}
                                  <span className="truncate">{s.locationLabel}</span>
                                  <span>·</span>
                                  <span className="font-mono tabular-nums shrink-0">
                                    {new Date(s.timestamp).toLocaleDateString()}
                                  </span>
                                </div>
                              </div>
                            </div>

                            <div className="mt-2.5 flex items-center justify-between gap-2 text-[11px] text-slate-600">
                              <span className="truncate">
                                {s.individualId
                                  ? `Photo-ID: ${s.individualId} (${s.individualName})`
                                  : isRescue
                                    ? `Status: ${s.rescueStatus}`
                                    : s.region}
                              </span>
                              <div
                                className="flex items-center gap-2 shrink-0"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  onClick={() => handleOpenSafety(s)}
                                  className="inline-flex items-center gap-1 text-slate-700 hover:text-slate-900 font-medium"
                                >
                                  <ShieldAlert className="w-3 h-3" />
                                  Safety
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setShareSighting(s)}
                                  className="inline-flex items-center gap-1 text-cyan-800 hover:text-cyan-950 font-medium"
                                >
                                  <Share2 className="w-3 h-3" />
                                  Share
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </aside>
              </div>
            </>
          )}

          {activeView === 'rescue' && (
            <RescueDeskView
              rescueToken={rescueToken}
              activeOrg={activeOrg}
              onAuthenticated={(token, org) => {
                setRescueToken(token);
                setActiveOrg(org);
              }}
              onLogout={() => {
                setRescueToken(null);
                setActiveOrg(null);
              }}
              onCaseUpdated={() => {
                loadSightings();
                loadNotifications();
              }}
              locale={locale}
            />
          )}

          {activeView === 'insights' && (
            <InsightsView
              sightings={sightings}
              onTrackIndividualOnMap={(indId) => {
                setActiveIndividualId(indId);
                const first = sightings.find((s) => s.individualId === indId);
                if (first) {
                  setFocusCoords({ lat: first.lat, lng: first.lng });
                  setSelectedSightingId(first.id);
                }
                setActiveView('map');
              }}
              locale={locale}
            />
          )}

          {activeView === 'logbook' && (
            <LogbookView
              contributorId={contributorId}
              contributorName={contributorName}
              sightings={sightings}
              notifications={notifications}
              offlineQueue={offlineQueue}
              onSyncOffline={syncOfflineQueue}
              syncingOffline={syncingOffline}
              onMarkNotificationsRead={handleMarkNotificationsRead}
              onShareSighting={(s) => setShareSighting(s)}
              onOpenSafety={handleOpenSafety}
              locale={locale}
            />
          )}
        </main>

        <footer className="border-t border-slate-200 bg-white mt-auto">
          <div className="max-w-[1440px] mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
            <div>
              PelagicWatch Marine Conservation Network · Keep safe viewing distance: stay back and do not touch wildlife.
            </div>
            <div>
              Sensitive nesting & pupping coordinates masked on public maps · Anonymized CSV/GeoJSON open research data
            </div>
          </div>
        </footer>

        {/* Modals */}
        <ReportSightingModal
          open={reportOpen}
          onClose={() => setReportOpen(false)}
          contributorId={contributorId}
          contributorName={contributorName}
          onContributorChange={setContributorName}
          simulatedOffline={simulatedOffline}
          onSightingSubmitted={({
            sighting,
            safetyRule,
            merged,
            alertedOrgName,
            dispatchDistanceKm,
            clusterAlerts: newClusters,
          }) => {
            loadSightings();
            if (newClusters) setClusterAlerts(newClusters);
            setSelectedSightingId(sighting.id);
            setFocusCoords({ lat: sighting.lat, lng: sighting.lng });
            setSafetyModalState({
              open: true,
              sighting,
              rule: safetyRule,
              merged,
              alertedOrgName,
              dispatchDistanceKm,
            });
          }}
          onQueuedOffline={(item) => {
            setOfflineQueue((prev) => [...prev, item]);
            setActiveView('logbook');
          }}
          locale={locale}
        />

        {safetyModalState.sighting && safetyModalState.rule && (
          <SafetyPopupModal
            open={safetyModalState.open}
            onClose={() => setSafetyModalState((s) => ({ ...s, open: false }))}
            sighting={safetyModalState.sighting}
            safetyRule={safetyModalState.rule}
            merged={safetyModalState.merged}
            alertedOrgName={safetyModalState.alertedOrgName}
            dispatchDistanceKm={safetyModalState.dispatchDistanceKm}
            locale={locale}
          />
        )}

        <ShareCardModal
          sighting={shareSighting}
          onClose={() => setShareSighting(null)}
          locale={locale}
        />
      </div>
    </APIProvider>
  );
}
