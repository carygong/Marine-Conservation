import React from 'react';
import {
  AlertTriangle,
  Award,
  Bell,
  CheckCircle2,
  Clock,
  Share2,
  ShieldAlert,
  Wifi,
} from 'lucide-react';
import type {
  NotificationItem,
  QueuedOfflineSighting,
  Sighting,
} from '../types';
import { TRANSLATIONS, type Locale } from '../i18n';

interface LogbookViewProps {
  contributorId: string;
  contributorName: string;
  sightings: Sighting[];
  notifications: NotificationItem[];
  offlineQueue: QueuedOfflineSighting[];
  onSyncOffline: () => void;
  syncingOffline: boolean;
  onMarkNotificationsRead: () => void;
  onShareSighting: (sighting: Sighting) => void;
  onOpenSafety: (sighting: Sighting) => void;
  locale: Locale;
}

export const LogbookView: React.FC<LogbookViewProps> = ({
  contributorId,
  contributorName,
  sightings,
  notifications,
  offlineQueue,
  onSyncOffline,
  syncingOffline,
  onMarkNotificationsRead,
  onShareSighting,
  onOpenSafety,
  locale,
}) => {
  const t = TRANSLATIONS[locale];

  const mySightings = sightings.filter(
    (s) =>
      s.contributorId === contributorId ||
      s.mergedReports.some((m) => m.contributorId === contributorId)
  );

  const uniqueSpecies = new Set(mySightings.map((s) => s.speciesCategory));
  const rescueCount = mySightings.filter((s) => s.classification === 'Possible rescue case').length;
  const hasIndividual = mySightings.some((s) => Boolean(s.individualId));

  const earnedBadges: Array<{ name: string; desc: string }> = [];
  if (mySightings.length >= 1)
    earnedBadges.push({ name: 'First Spotter', desc: 'Logged your first marine wildlife sighting' });
  if (rescueCount >= 1)
    earnedBadges.push({ name: 'Rescue Guardian', desc: 'Flagged a possible rescue case for dispatch' });
  if (uniqueSpecies.size >= 3)
    earnedBadges.push({ name: 'Multi-Species Tracker', desc: 'Observed 3+ distinct marine species groups' });
  if (mySightings.length >= 3)
    earnedBadges.push({ name: 'Field Veteran', desc: 'Contributed 3+ verified field observations' });
  if (hasIndividual)
    earnedBadges.push({ name: 'Photo-ID Pioneer', desc: 'Linked an observation to an individual animal' });

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="space-y-6">
      {/* Offline Pending Queue Banner */}
      {offlineQueue.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="text-sm text-amber-950">
            <strong>{offlineQueue.length} offline sighting(s)</strong> stored in your local IndexedDB queue waiting for signal.
          </div>
          <button
            type="button"
            disabled={syncingOffline}
            onClick={onSyncOffline}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-700 px-4 py-2 text-xs font-medium text-white hover:bg-amber-800 disabled:opacity-50"
          >
            <Wifi className="w-3.5 h-3.5" />
            {syncingOffline ? 'Syncing & Analyzing...' : 'Sync Queued Sightings Now'}
          </button>
        </div>
      )}

      {/* Notifications & Badges Split */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Notifications */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-cyan-700" />
              <h3 className="text-sm font-semibold text-slate-900">
                {t.notifications} ({unreadCount} unread)
              </h3>
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={onMarkNotificationsRead}
                className="text-xs font-medium text-cyan-700 hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <p className="text-xs text-slate-500 py-4">
              When a rescue organization updates a case you reported to Responding or Resolved, alerts appear here.
            </p>
          ) : (
            <div className="divide-y divide-slate-200">
              {notifications.map((n) => (
                <div
                  key={n.id}
                  className={`py-3 text-xs ${n.read ? 'text-slate-600' : 'text-slate-900 font-medium'}`}
                >
                  <div>{n.message}</div>
                  <div className="mt-1 font-mono text-[11px] text-slate-400 tabular-nums">
                    {new Date(n.createdAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Conservation Badges */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Award className="w-4 h-4 text-amber-600" />
            <h3 className="text-sm font-semibold text-slate-900">
              {t.myBadges} · {contributorName}
            </h3>
          </div>
          {earnedBadges.length === 0 ? (
            <p className="text-xs text-slate-500 py-4">
              Submit your first coastal wildlife sighting to earn your First Spotter badge.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {earnedBadges.map((b) => (
                <div
                  key={b.name}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-3"
                >
                  <div className="text-xs font-semibold text-slate-900">{b.name}</div>
                  <div className="text-[11px] text-slate-600 mt-0.5">{b.desc}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Personal Sighting History */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <h3 className="text-sm font-semibold text-slate-900">
          Your Sighting History ({mySightings.length})
        </h3>

        {mySightings.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500">
            No sightings logged under this observer profile yet. Use “Report Sighting” to submit a photo.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {mySightings.map((s) => {
              const isRescue = s.classification === 'Possible rescue case';
              return (
                <div
                  key={s.id}
                  className="rounded-lg border border-slate-200 bg-slate-50 overflow-hidden flex flex-col"
                >
                  <div className="aspect-[4/3] bg-slate-200">
                    <img
                      src={s.photoUrl}
                      alt={s.commonName}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                    <div>
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span>{s.region}</span>
                        <span className="font-mono tabular-nums">
                          {new Date(s.timestamp).toLocaleDateString()}
                        </span>
                      </div>
                      <h4 className="text-sm font-semibold text-slate-900 mt-1">{s.commonName}</h4>
                      <div className="mt-1 flex items-center gap-1.5 text-xs font-medium">
                        {isRescue ? (
                          <>
                            <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
                            <span className="text-red-700">
                              Rescue Status: {s.rescueStatus}
                            </span>
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            <span className="text-emerald-700">{t.healthySighting}</span>
                          </>
                        )}
                      </div>
                      {s.responderNotes && (
                        <div className="mt-2 flex items-start gap-1.5 text-[11px] text-slate-700 bg-white border border-slate-200 rounded p-2">
                          <Clock className="w-3 h-3 mt-0.5 text-cyan-700 shrink-0" />
                          <span>{s.responderNotes}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 pt-2 border-t border-slate-200">
                      <button
                        type="button"
                        onClick={() => onShareSighting(s)}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md bg-cyan-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-800"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                        {t.shareCard}
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenSafety(s)}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                      >
                        <ShieldAlert className="w-3.5 h-3.5" />
                        Rule
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
