import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Lock,
  LogOut,
  MapPin,
  Radio,
  Shield,
  Siren,
} from 'lucide-react';
import type { ClusterAlert, RescueOrg, Sighting } from '../types';
import { TRANSLATIONS, type Locale } from '../i18n';

interface RescueDeskViewProps {
  rescueToken: string | null;
  activeOrg: RescueOrg | null;
  onAuthenticated: (token: string, org: RescueOrg) => void;
  onLogout: () => void;
  onCaseUpdated: () => void;
  locale: Locale;
}

export const RescueDeskView: React.FC<RescueDeskViewProps> = ({
  rescueToken,
  activeOrg,
  onAuthenticated,
  onLogout,
  onCaseUpdated,
  locale,
}) => {
  const t = TRANSLATIONS[locale];
  const [setupRequired, setSetupRequired] = useState<boolean>(false);
  const [orgs, setOrgs] = useState<RescueOrg[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>('org-ccdu');
  const [passcode, setPasscode] = useState<string>('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);

  const [cases, setCases] = useState<Sighting[]>([]);
  const [clusterAlerts, setClusterAlerts] = useState<ClusterAlert[]>([]);
  const [loadingCases, setLoadingCases] = useState(false);
  const [notesByCase, setNotesByCase] = useState<Record<string, string>>({});
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'Reported' | 'Responding' | 'Resolved'>('all');

  useEffect(() => {
    fetch('/api/rescue/auth-status')
      .then((r) => r.json())
      .then((data) => {
        setSetupRequired(Boolean(data.setupRequired));
        if (Array.isArray(data.orgs)) {
          setOrgs(data.orgs);
          if (data.orgs.length > 0) setSelectedOrgId(data.orgs[0].id);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingAuth(false));
  }, []);

  const fetchCases = async (token: string) => {
    setLoadingCases(true);
    try {
      const res = await fetch('/api/rescue/cases', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        onLogout();
        return;
      }
      const data = await res.json();
      setCases(data.cases || []);
      setClusterAlerts(data.clusterAlerts || []);
    } finally {
      setLoadingCases(false);
    }
  };

  useEffect(() => {
    if (rescueToken) {
      fetchCases(rescueToken);
    }
  }, [rescueToken]);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    const endpoint = setupRequired ? '/api/rescue/setup-passcode' : '/api/rescue/login';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId: selectedOrgId, passcode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || 'Authentication failed');
        return;
      }
      setPasscode('');
      setSetupRequired(false);
      onAuthenticated(data.token, data.org);
    } catch {
      setAuthError('Network error connecting to rescue server.');
    }
  };

  const handleStatusChange = async (caseId: string, status: 'Responding' | 'Resolved') => {
    if (!rescueToken) return;
    setUpdatingId(caseId);
    try {
      const res = await fetch(`/api/rescue/cases/${caseId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${rescueToken}`,
        },
        body: JSON.stringify({
          status,
          responderNotes: notesByCase[caseId] || undefined,
        }),
      });
      if (res.ok) {
        await fetchCases(rescueToken);
        onCaseUpdated();
      }
    } finally {
      setUpdatingId(null);
    }
  };

  if (loadingAuth) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
        Loading rescue portal status...
      </div>
    );
  }

  if (!rescueToken) {
    return (
      <div className="max-w-lg mx-auto rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex items-center gap-2.5 text-slate-900">
          <Shield className="w-5 h-5 text-cyan-700" />
          <h2 className="text-lg font-semibold">
            {setupRequired ? 'Initialize Rescue Organization Portal' : 'Rescue Organization Sign-In'}
          </h2>
        </div>
        <p className="mt-2 text-sm text-slate-600 leading-relaxed">
          {setupRequired
            ? 'First-run setup: choose your rescue organization and claim a team passcode (stored securely on the server with scrypt) to unlock exact GPS coordinates and case dispatch.'
            : 'Sign in with your authorized marine rescue organization and portal passcode to manage incoming rescue cases and view unmasked coordinates.'}
        </p>

        <form onSubmit={handleAuthSubmit} className="mt-6 space-y-4">
          {authError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">
              {authError}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Rescue Organization
            </label>
            <select
              value={selectedOrgId}
              onChange={(e) => setSelectedOrgId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-600"
            >
              {orgs.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name} ({org.region})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              {setupRequired ? 'Create Team Passcode (min 4 characters)' : 'Team Passcode'}
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="password"
                required
                minLength={4}
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder="Enter rescue team passcode"
                className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-600"
              />
            </div>
          </div>

          <button
            type="submit"
            className="w-full rounded-lg bg-cyan-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-cyan-800 transition-colors"
          >
            {setupRequired ? 'Set Passcode & Open Rescue Desk' : 'Sign In to Rescue Desk'}
          </button>
        </form>
      </div>
    );
  }

  const filteredCases =
    statusFilter === 'all' ? cases : cases.filter((c) => c.rescueStatus === statusFilter);

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-6 py-4">
        <div>
          <div className="text-xs text-slate-500">
            Authenticated Organization · {activeOrg?.region}
          </div>
          <h2 className="text-lg font-semibold text-slate-900">
            {activeOrg?.name} — {t.rescueDeskTitle}
          </h2>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(['all', 'Reported', 'Responding', 'Resolved'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  statusFilter === st
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {st === 'all' ? 'All Cases' : st}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onLogout}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </div>

      {/* Early Warning Cluster Alerts */}
      {clusterAlerts.length > 0 && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-red-900">
            <Siren className="w-4 h-4 text-red-600 shrink-0" />
            <span>{t.clusterAlertTitle}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {clusterAlerts.map((alert) => (
              <div
                key={alert.id}
                className="rounded-lg border border-red-200 bg-white px-4 py-3 text-xs text-slate-800"
              >
                <div className="font-semibold text-red-800">{alert.message}</div>
                <div className="mt-1 font-mono text-slate-500 tabular-nums">
                  Center: {alert.centerLat.toFixed(4)}, {alert.centerLng.toFixed(4)} · Radius {alert.radiusKm} km
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Case List */}
      {loadingCases ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          Loading incoming rescue cases...
        </div>
      ) : filteredCases.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          No rescue cases match the selected status filter.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filteredCases.map((c) => {
            const isResolved = c.rescueStatus === 'Resolved';
            const isResponding = c.rescueStatus === 'Responding';
            return (
              <div
                key={c.id}
                className="rounded-xl border border-slate-200 bg-white overflow-hidden grid grid-cols-1 lg:grid-cols-12"
              >
                <div className="lg:col-span-3 bg-slate-100 aspect-[4/3] lg:aspect-auto">
                  <img
                    src={c.photoUrl}
                    alt={c.commonName}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                </div>

                <div className="lg:col-span-9 p-5 flex flex-col justify-between gap-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <span className="font-mono">{c.id}</span>
                        <span>·</span>
                        <span>{c.region}</span>
                        <span>·</span>
                        <span className="font-mono tabular-nums">
                          {new Date(c.timestamp).toLocaleString()}
                        </span>
                        {c.reportCount > 1 && (
                          <>
                            <span>·</span>
                            <span className="font-semibold text-cyan-800">
                              {c.reportCount} merged reports
                            </span>
                          </>
                        )}
                      </div>
                      <h3 className="text-lg font-semibold text-slate-900 mt-1">
                        {c.commonName}{' '}
                        <span className="text-sm font-normal italic text-slate-500">
                          ({c.scientificName})
                        </span>
                      </h3>
                    </div>

                    <div className="flex items-center gap-2 text-xs font-semibold">
                      {isResolved ? (
                        <span className="inline-flex items-center gap-1.5 text-emerald-700">
                          <CheckCircle2 className="w-4 h-4" />
                          Resolved
                        </span>
                      ) : isResponding ? (
                        <span className="inline-flex items-center gap-1.5 text-amber-700">
                          <Clock className="w-4 h-4" />
                          Responding
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-red-700">
                          <AlertTriangle className="w-4 h-4" />
                          Reported · Needs Dispatch
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    <div className="space-y-1">
                      <div className="font-semibold text-slate-700">AI Clinical Triage ({c.confidence}% confidence)</div>
                      <p className="text-slate-600 leading-relaxed">{c.aiNotes}</p>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5 text-slate-700 font-medium">
                        <MapPin className="w-3.5 h-3.5 text-cyan-700" />
                        <span>Exact Dispatch GPS:</span>
                        <span className="font-mono tabular-nums text-slate-900">
                          {c.lat.toFixed(5)}, {c.lng.toFixed(5)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-slate-600">
                        <Radio className="w-3.5 h-3.5 text-slate-400" />
                        <span>Assigned Unit: {c.alertedOrgName || 'Unassigned'}</span>
                      </div>
                      {c.responderNotes && (
                        <div className="text-slate-700 bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5">
                          <strong>Team Note:</strong> {c.responderNotes}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-slate-200">
                    <input
                      type="text"
                      value={notesByCase[c.id] ?? ''}
                      onChange={(e) =>
                        setNotesByCase((prev) => ({ ...prev, [c.id]: e.target.value }))
                      }
                      placeholder="Add dispatch / responder update note for contributor..."
                      className="flex-1 min-w-[220px] rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-600"
                    />
                    <button
                      type="button"
                      disabled={updatingId === c.id || isResponding}
                      onClick={() => handleStatusChange(c.id, 'Responding')}
                      className="px-3.5 py-1.5 rounded-md border border-amber-600 bg-amber-50 text-amber-900 text-xs font-medium hover:bg-amber-100 disabled:opacity-50 whitespace-nowrap shrink-0"
                    >
                      {t.markResponding}
                    </button>
                    <button
                      type="button"
                      disabled={updatingId === c.id || isResolved}
                      onClick={() => handleStatusChange(c.id, 'Resolved')}
                      className="px-3.5 py-1.5 rounded-md bg-emerald-700 text-white text-xs font-medium hover:bg-emerald-800 disabled:opacity-50 whitespace-nowrap shrink-0"
                    >
                      {t.markResolved}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
