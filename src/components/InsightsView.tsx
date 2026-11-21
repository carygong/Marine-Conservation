import React, { useEffect, useState } from 'react';
import { Award, Download, Fingerprint, Navigation, TrendingUp } from 'lucide-react';
import type { IndividualAnimal, LeaderboardEntry, Sighting } from '../types';
import { TRANSLATIONS, type Locale } from '../i18n';

interface StatsPayload {
  totals: {
    totalSightings: number;
    totalReportsWithMerges: number;
    rescueCases: number;
    resolvedCases: number;
    catalogedIndividuals: number;
    activeClusters: number;
  };
  bySpecies: Record<string, { healthy: number; rescue: number; total: number }>;
  byRegion: Record<string, { healthy: number; rescue: number; total: number }>;
  monthlySeries: Array<{ month: string; healthy: number; rescue: number; total: number }>;
  leaderboard: LeaderboardEntry[];
  individuals: IndividualAnimal[];
}

interface InsightsViewProps {
  sightings: Sighting[];
  onTrackIndividualOnMap: (individualId: string) => void;
  locale: Locale;
}

export const InsightsView: React.FC<InsightsViewProps> = ({
  sightings,
  onTrackIndividualOnMap,
  locale,
}) => {
  const t = TRANSLATIONS[locale];
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch('/api/stats')
      .then((r) => r.json())
      .then((data) => setStats(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [sightings.length]);

  if (loading || !stats) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
        Aggregating conservation telemetry...
      </div>
    );
  }

  const speciesEntries = Object.entries(stats.bySpecies);
  const maxSpeciesTotal = Math.max(1, ...speciesEntries.map(([, v]) => v.total));
  const regionEntries = Object.entries(stats.byRegion);
  const maxRegionTotal = Math.max(1, ...regionEntries.map(([, v]) => v.total));
  const maxMonthTotal = Math.max(1, ...stats.monthlySeries.map((m) => m.total));

  const speciesLabels: Record<string, string> = {
    seal: t.seal,
    whale: t.whale,
    dolphin: t.dolphin,
    sea_turtle: t.sea_turtle,
    seabird: t.seabird,
    other_marine: t.other_marine,
  };

  return (
    <div className="space-y-6">
      {/* Top Export & Summary Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-6 py-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Conservation Telemetry & Community Insights
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Anonymized researcher exports strip contributor identities and quantize sensitive rookery coordinates to 0.05° grid cells.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <a
            href="/api/export?format=csv"
            download
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5 text-cyan-700" />
            {t.exportCsv}
          </a>
          <a
            href="/api/export?format=geojson"
            download
            className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-700 px-3.5 py-2 text-xs font-medium text-white hover:bg-cyan-800 whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            {t.exportGeoJson}
          </a>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">Total Verified Sightings</div>
          <div className="mt-1 text-2xl font-mono font-semibold text-slate-900 tabular-nums">
            {stats.totals.totalSightings}
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {stats.totals.totalReportsWithMerges} total observer reports
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">Rescue Triage Cases</div>
          <div className="mt-1 text-2xl font-mono font-semibold text-red-700 tabular-nums">
            {stats.totals.rescueCases}
          </div>
          <div className="mt-1 text-xs text-emerald-700 tabular-nums">
            {stats.totals.resolvedCases} resolved by rescue teams
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">Photo-ID Individuals</div>
          <div className="mt-1 text-2xl font-mono font-semibold text-cyan-800 tabular-nums">
            {stats.totals.catalogedIndividuals}
          </div>
          <div className="mt-1 text-xs text-slate-500">Tracked across time & regions</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">Active Cluster Warnings</div>
          <div className="mt-1 text-2xl font-mono font-semibold text-amber-700 tabular-nums">
            {stats.totals.activeClusters}
          </div>
          <div className="mt-1 text-xs text-slate-500">15 km / 14-day spatial threshold</div>
        </div>
      </div>

      {/* Species & Region Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-900">{t.speciesStats}</h3>
          <div className="space-y-3">
            {speciesEntries.map(([sp, counts]) => (
              <div key={sp} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700">{speciesLabels[sp] || sp}</span>
                  <span className="font-mono text-slate-600 tabular-nums">
                    {counts.healthy} healthy · {counts.rescue} rescue ({counts.total})
                  </span>
                </div>
                <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden flex">
                  <div
                    className="bg-emerald-600 h-full"
                    style={{ width: `${(counts.healthy / maxSpeciesTotal) * 100}%` }}
                  />
                  <div
                    className="bg-red-600 h-full"
                    style={{ width: `${(counts.rescue / maxSpeciesTotal) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-900">{t.regionStats}</h3>
          <div className="space-y-3">
            {regionEntries.map(([reg, counts]) => (
              <div key={reg} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700">{reg}</span>
                  <span className="font-mono text-slate-600 tabular-nums">
                    {counts.healthy} healthy · {counts.rescue} rescue ({counts.total})
                  </span>
                </div>
                <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden flex">
                  <div
                    className="bg-cyan-700 h-full"
                    style={{ width: `${(counts.healthy / maxRegionTotal) * 100}%` }}
                  />
                  <div
                    className="bg-red-600 h-full"
                    style={{ width: `${(counts.rescue / maxRegionTotal) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Monthly Sighting & Injury Trend */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-cyan-700" />
            <h3 className="text-sm font-semibold text-slate-900">{t.monthlyStats}</h3>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-600 inline-block" /> Healthy
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-red-600 inline-block" /> Rescue Case
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 pt-2">
          {stats.monthlySeries.map((m) => (
            <div key={m.month} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs font-mono text-slate-500">{m.month}</div>
              <div className="mt-2 h-20 flex items-end gap-1.5">
                <div
                  className="flex-1 bg-emerald-600 rounded-t"
                  style={{ height: `${Math.max(8, (m.healthy / maxMonthTotal) * 100)}%` }}
                  title={`${m.healthy} healthy`}
                />
                <div
                  className="flex-1 bg-red-600 rounded-t"
                  style={{ height: `${m.rescue > 0 ? Math.max(10, (m.rescue / maxMonthTotal) * 100) : 4}%` }}
                  title={`${m.rescue} rescue`}
                />
              </div>
              <div className="mt-2 text-xs font-mono font-semibold text-slate-900 tabular-nums">
                {m.total} total
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Individual Animal Photo-ID + Leaderboard */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Fingerprint className="w-4 h-4 text-cyan-700" />
            <h3 className="text-sm font-semibold text-slate-900">{t.individualMatches}</h3>
          </div>
          <div className="space-y-3">
            {stats.individuals.map((ind) => {
              const linked = sightings
                .filter((s) => s.individualId === ind.id)
                .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
              return (
                <div key={ind.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-mono text-cyan-800">{ind.id}</div>
                      <div className="text-sm font-semibold text-slate-900">
                        {ind.name} · {ind.commonName}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onTrackIndividualOnMap(ind.id)}
                      className="inline-flex items-center gap-1 rounded-md border border-cyan-700 bg-white px-2.5 py-1 text-xs font-medium text-cyan-800 hover:bg-cyan-50 whitespace-nowrap shrink-0"
                    >
                      <Navigation className="w-3 h-3" />
                      View Track ({linked.length})
                    </button>
                  </div>
                  <p className="text-xs text-slate-600">{ind.identifyingFeatures}</p>
                  <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                    {linked.map((l) => `${new Date(l.timestamp).toLocaleDateString()} (${l.region})`).join(' → ')}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Award className="w-4 h-4 text-amber-600" />
            <h3 className="text-sm font-semibold text-slate-900">{t.leaderboard}</h3>
          </div>
          <div className="divide-y divide-slate-200">
            {stats.leaderboard.map((entry, idx) => (
              <div key={entry.contributorId} className="py-3 flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-slate-400 tabular-nums">
                      #{idx + 1}
                    </span>
                    <span className="text-sm font-semibold text-slate-900">
                      {entry.contributorName}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {entry.badges.join(' · ')}
                  </div>
                </div>
                <div className="text-right font-mono tabular-nums">
                  <div className="text-sm font-semibold text-cyan-800">{entry.score} pts</div>
                  <div className="text-[11px] text-slate-500">
                    {entry.sightingCount} sightings · {entry.rescueReports} rescues
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
