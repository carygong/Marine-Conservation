import React from 'react';
import { AlertTriangle, CheckCircle2, ShieldAlert, X, Ruler, Radio, Fingerprint, Layers } from 'lucide-react';
import type { Sighting, SpeciesSafetyRule } from '../types';
import { TRANSLATIONS, type Locale } from '../i18n';

interface SafetyPopupModalProps {
  open: boolean;
  onClose: () => void;
  sighting: Sighting;
  safetyRule: SpeciesSafetyRule;
  merged?: boolean;
  alertedOrgName?: string;
  dispatchDistanceKm?: number;
  locale: Locale;
}

export const SafetyPopupModal: React.FC<SafetyPopupModalProps> = ({
  open,
  onClose,
  sighting,
  safetyRule,
  merged,
  alertedOrgName,
  dispatchDistanceKm,
  locale,
}) => {
  if (!open) return null;
  const t = TRANSLATIONS[locale];
  const isRescue = sighting.classification === 'Possible rescue case';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="safety-popup-title"
    >
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2.5">
            <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0" />
            <h2 id="safety-popup-title" className="text-base font-semibold text-slate-900">
              {t.safetyProtocol} · {sighting.commonName}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close safety dialog"
            className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Mandatory Warning Banner */}
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
            <p className="text-base font-bold text-amber-950">
              {t.stayBackMessage}
            </p>
            <div className="mt-2.5 flex items-start gap-2 text-sm text-amber-900">
              <Ruler className="w-4 h-4 mt-0.5 shrink-0 text-amber-700" />
              <div>
                <div className="font-semibold text-xs uppercase tracking-wide text-amber-800">
                  {t.minimumDistance}
                </div>
                <div className="mt-0.5 font-medium">{safetyRule.distanceRule}</div>
              </div>
            </div>
            <p className="mt-2.5 text-xs text-amber-800 leading-relaxed">
              {safetyRule.legalNote}
            </p>
          </div>

          {/* Classification & Triage Summary */}
          <div className="flex items-start justify-between gap-4 border-t border-slate-200 pt-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold">
                {isRescue ? (
                  <>
                    <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                    <span className="text-red-700">{t.possibleRescue}</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span className="text-emerald-700">{t.healthySighting}</span>
                  </>
                )}
              </div>
              <p className="mt-1 text-xs text-slate-600 leading-relaxed">{sighting.aiNotes}</p>
            </div>
            <div className="text-right shrink-0">
              <div className="text-xs text-slate-500">AI Confidence</div>
              <div className="font-mono text-lg font-semibold text-slate-900 tabular-nums">
                {sighting.confidence}%
              </div>
            </div>
          </div>

          {/* Rescue Dispatch / Duplicate Merge / Individual Match notices */}
          {(alertedOrgName || merged || sighting.individualId || sighting.isSensitiveSite) && (
            <div className="space-y-2 border-t border-slate-200 pt-4 text-xs text-slate-700">
              {alertedOrgName && (
                <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 p-3 text-red-900">
                  <Radio className="w-4 h-4 mt-0.5 text-red-600 shrink-0" />
                  <div>
                    <span className="font-semibold">Nearest Rescue Team Alerted:</span> {alertedOrgName}
                    {dispatchDistanceKm !== undefined && (
                      <span className="font-mono ml-1.5 text-red-700">({dispatchDistanceKm} km away)</span>
                    )}
                  </div>
                </div>
              )}

              {merged && (
                <div className="flex items-start gap-2 rounded-md bg-cyan-50 border border-cyan-200 p-3 text-cyan-900">
                  <Layers className="w-4 h-4 mt-0.5 text-cyan-700 shrink-0" />
                  <div>
                    <span className="font-semibold">Duplicate Sighting Merged:</span> Combined with an active nearby report of the same species ({sighting.reportCount} total reports on this case).
                  </div>
                </div>
              )}

              {sighting.individualId && (
                <div className="flex items-start gap-2 rounded-md bg-slate-100 border border-slate-200 p-3 text-slate-800">
                  <Fingerprint className="w-4 h-4 mt-0.5 text-cyan-700 shrink-0" />
                  <div>
                    <span className="font-semibold">Photo-ID Catalog Match:</span>{' '}
                    <span className="font-mono">{sighting.individualId}</span> · {sighting.individualName}
                  </div>
                </div>
              )}

              {sighting.isSensitiveSite && (
                <div className="text-xs text-amber-800 bg-amber-50/70 border border-amber-200 rounded-md p-2.5">
                  {t.sensitiveZoneNote} ({sighting.sensitiveReason}).
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-cyan-700 text-white text-sm font-medium hover:bg-cyan-800 transition-colors"
            >
              {t.acknowledgeSafety}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
