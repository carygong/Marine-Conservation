import React, { useState } from 'react';
import { Check, Copy, Download, ShieldCheck, X } from 'lucide-react';
import type { Sighting } from '../types';
import { TRANSLATIONS, type Locale } from '../i18n';

interface ShareCardModalProps {
  sighting: Sighting | null;
  onClose: () => void;
  locale: Locale;
}

export const ShareCardModal: React.FC<ShareCardModalProps> = ({ sighting, onClose, locale }) => {
  const [copied, setCopied] = useState(false);
  if (!sighting) return null;
  const t = TRANSLATIONS[locale];

  const shareSummary = `PelagicWatch Conservation Sighting\nSpecies: ${sighting.commonName} (${sighting.scientificName})\nStatus: ${sighting.classification} · ${sighting.confidence}% AI confidence\nRegion: ${sighting.region} (${sighting.locationLabel})\nObserved: ${new Date(sighting.timestamp).toLocaleString()}\nContributor: ${sighting.contributorName}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareSummary);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleDownloadPng = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 960;
    canvas.height = 600;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, 960, 600);

      // Header bar
      ctx.fillStyle = '#0e7490';
      ctx.fillRect(0, 0, 960, 72);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 24px sans-serif';
      ctx.fillText('PelagicWatch Field Sighting Card', 32, 45);

      // Photo on left
      ctx.drawImage(img, 32, 104, 440, 330);

      // Right metadata
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 30px sans-serif';
      ctx.fillText(sighting.commonName, 504, 144);

      ctx.fillStyle = '#475569';
      ctx.font = 'italic 20px sans-serif';
      ctx.fillText(sighting.scientificName, 504, 178);

      const isRescue = sighting.classification === 'Possible rescue case';
      ctx.fillStyle = isRescue ? '#b91c1c' : '#047857';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText(
        `${sighting.classification} · ${sighting.confidence}% confidence`,
        504,
        222
      );

      ctx.fillStyle = '#334155';
      ctx.font = '17px sans-serif';
      ctx.fillText(`Region: ${sighting.region}`, 504, 272);
      ctx.fillText(`Location: ${sighting.locationLabel}`, 504, 304);
      ctx.fillText(`Date: ${new Date(sighting.timestamp).toLocaleDateString()}`, 504, 336);
      ctx.fillText(`Observer: ${sighting.contributorName}`, 504, 368);
      if (sighting.individualId) {
        ctx.fillText(`Photo-ID: ${sighting.individualId} (${sighting.individualName})`, 504, 400);
      }

      // Footer
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(32, 466, 896, 1);
      ctx.fillStyle = '#475569';
      ctx.font = '16px sans-serif';
      ctx.fillText(
        'Wildlife Guideline: Stay back and do not touch the animal. Sensitive sites masked for protection.',
        32,
        512
      );

      const link = document.createElement('a');
      link.download = `pelagicwatch_${sighting.id}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    };
    img.src = sighting.photoUrl;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h3 className="text-base font-semibold text-slate-900">{t.shareCard}</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 overflow-hidden">
            <div className="aspect-[4/3] w-full bg-slate-200 relative overflow-hidden">
              <img
                src={sighting.photoUrl}
                alt={sighting.commonName}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/85 via-slate-950/40 to-transparent p-4 text-white">
                <div className="text-lg font-semibold leading-tight">{sighting.commonName}</div>
                <div className="text-xs italic text-slate-200">{sighting.scientificName}</div>
              </div>
            </div>
            <div className="p-4 space-y-1.5 text-xs text-slate-600">
              <div className="flex items-center justify-between font-medium text-slate-900">
                <span>{sighting.classification}</span>
                <span className="font-mono tabular-nums">{sighting.confidence}% AI</span>
              </div>
              <div>
                {sighting.region} · {sighting.locationLabel}
              </div>
              <div className="font-mono tabular-nums">
                {new Date(sighting.timestamp).toLocaleString()}
              </div>
              <div className="flex items-center gap-1.5 pt-1 text-cyan-800 font-medium">
                <ShieldCheck className="w-3.5 h-3.5" />
                Observed by {sighting.contributorName}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleDownloadPng}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-700 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-800 transition-colors"
            >
              <Download className="w-4 h-4" />
              {t.downloadCard}
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copied' : 'Copy Summary'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
