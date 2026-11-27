import React, { useEffect, useState } from 'react';
import { User } from 'firebase/auth';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  AlertTriangle,
  Award,
  Check,
  CheckCircle2,
  Clock,
  DollarSign,
  Edit3,
  FileCheck2,
  FileText,
  HeartHandshake,
  Plus,
  RefreshCcw,
  Scale,
  Shield,
  ShieldAlert,
  Sparkles,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { ClubBrandMark } from './ClubBrandMark';

export interface ClubRuleItem {
  id: string;
  category: 'sportsmanship' | 'attendance' | 'discipline' | 'safety' | 'financial' | 'general';
  title: string;
  summary: string;
  details: string[];
}

export interface ClubRulesDoc {
  title: string;
  subtitle: string;
  lastUpdated: string;
  rules: ClubRuleItem[];
  updatedBy?: string;
  updatedAt?: unknown;
}

export const DEFAULT_CLUB_RULES: ClubRulesDoc = {
  title: 'Code of Conduct & Club Discipline',
  subtitle: 'Official sporting standards, matchday discipline, and community commitments of Persepolis Vancouver Football Club Society (PVFCS).',
  lastUpdated: 'November 2026',
  rules: [
    {
      id: 'rule-ethos',
      category: 'sportsmanship',
      title: '1. Sportsmanship, Brotherhood & Club Ethos',
      summary: 'Persepolis Vancouver Football Club Society (PVFCS) is dedicated to competitive joy, brotherhood, and community pride.',
      details: [
        'Treat every teammate, opponent, and referee with genuine respect before, during, and after the whistle.',
        'Foster a positive, inclusive, and encouraging team environment regardless of the scoreline or match outcome.',
        'Abusive language, taunting, discrimination, or personal disrespect of any kind will not be tolerated.',
      ],
    },
    {
      id: 'rule-attendance',
      category: 'attendance',
      title: '2. Attendance & Matchday Commitment',
      summary: 'Respecting the schedule ensures balanced squad lineups and equal game time for all members.',
      details: [
        'Vote on the weekly match poll before the lock deadline so managers can finalize balanced 6-a-side / 7-a-side teams.',
        'If you mark "Attending", your attendance is a firm commitment to the squad. Arrive at least 15 minutes prior to kickoff.',
        'Emergency cancellations must be communicated at least 24 hours in advance to allow waitlisted members to play.',
        'Two consecutive "no-shows" without notice will result in suspension from the subsequent matchday poll.',
      ],
    },
    {
      id: 'rule-discipline',
      category: 'discipline',
      title: '3. On-Pitch Discipline & Sanctions',
      summary: 'Physical safety is paramount. Violent conduct is strictly penalized.',
      details: [
        'Tackles from behind, reckless challenges, or excessive force are strictly prohibited on all pitch surfaces.',
        'Yellow Card: Verbal warning recorded by organizers; repeated yellow cards result in a 1-match cooldown.',
        'Red Card (Violent conduct, fighting, or referee abuse): Immediate ejection from the pitch and automatic minimum 2-week ban.',
        'Serious or repeated disciplinary infractions will result in permanent termination of club membership upon committee review.',
      ],
    },
    {
      id: 'rule-safety',
      category: 'safety',
      title: '4. Equipment, Jersey & Matchday Safety',
      summary: 'Proper soccer gear ensures individual safety and professional squad identity.',
      details: [
        'Players must wear suitable footwear (clean turf shoes or molded cleats appropriate for the facility).',
        'Shin guards are strongly recommended for all competitive scrimmage sessions.',
        'Always wear the designated team kit color (Navy Blue, Red, Amber, or White) assigned by the manager lineup.',
        'Remove watches, loose jewelry, and dangerous accessories before taking the field.',
      ],
    },
    {
      id: 'rule-financial',
      category: 'financial',
      title: '5. Financial Responsibility & Society Dues',
      summary: 'Prompt contribution keeps our pitches reserved, balls supplied, and club operations seamless.',
      details: [
        'Monthly society dues or drop-in match fees must be settled promptly upon notification.',
        'Interac e-Transfers should be sent directly to persepolisvfc@gmail.com with your name in the message memo.',
        'Unpaid accounts after the monthly cutoff will temporarily pause player voting eligibility until resolved.',
      ],
    },
    {
      id: 'rule-dispute',
      category: 'general',
      title: '6. Captaincy & Dispute Resolution',
      summary: 'Resolve disputes calmly through leadership channels, never through confrontation on the field.',
      details: [
        'On-field disputes must be addressed solely by the designated team captains and match coordinator.',
        'Disagreements or concerns should be brought quietly to the club executive after matchday concludes.',
        'Decisions made by the executive committee are authoritative and final for the integrity of the society.',
      ],
    },
  ],
};

interface ClubRulesViewProps {
  user: User;
  isAdmin: boolean;
}

export const ClubRulesView: React.FC<ClubRulesViewProps> = ({ user, isAdmin }) => {
  const [rulesDoc, setRulesDoc] = useState<ClubRulesDoc>(DEFAULT_CLUB_RULES);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [draftDoc, setDraftDoc] = useState<ClubRulesDoc>(DEFAULT_CLUB_RULES);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Subscribe to live Firestore club rules
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'club_rules', 'official'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as ClubRulesDoc;
          if (data && Array.isArray(data.rules) && data.rules.length > 0) {
            setRulesDoc(data);
            setDraftDoc(data);
          }
        }
        setLoading(false);
      },
      (err) => {
        console.warn('Could not load remote club rules, using official defaults:', err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  const handleOpenEdit = () => {
    setDraftDoc(JSON.parse(JSON.stringify(rulesDoc)));
    setIsEditing(true);
    setSaveSuccess(false);
  };

  const handleSaveDraft = async () => {
    setSaving(true);
    try {
      await setDoc(doc(db, 'club_rules', 'official'), {
        ...draftDoc,
        updatedBy: user.uid,
        updatedAt: serverTimestamp(),
      });
      setRulesDoc(draftDoc);
      setSaveSuccess(true);
      setTimeout(() => {
        setIsEditing(false);
        setSaveSuccess(false);
      }, 800);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'club_rules/official');
    } finally {
      setSaving(false);
    }
  };

  const handleResetToOfficialDefaults = () => {
    if (confirm('Reset Code of Conduct to the official Persepolis Vancouver Football Club Society (PVFCS) defaults?')) {
      setDraftDoc(DEFAULT_CLUB_RULES);
    }
  };

  const handleUpdateRuleItem = (
    index: number,
    field: keyof ClubRuleItem,
    value: string | string[]
  ) => {
    const next = [...draftDoc.rules];
    next[index] = { ...next[index], [field]: value };
    setDraftDoc({ ...draftDoc, rules: next });
  };

  const handleAddRuleItem = () => {
    const newRule: ClubRuleItem = {
      id: `rule-${Date.now()}`,
      category: 'discipline',
      title: `${draftDoc.rules.length + 1}. New Rule Title`,
      summary: 'Summary of the new standard or policy.',
      details: ['First policy detail or requirement.'],
    };
    setDraftDoc({ ...draftDoc, rules: [...draftDoc.rules, newRule] });
  };

  const handleDeleteRuleItem = (index: number) => {
    const next = draftDoc.rules.filter((_, i) => i !== index);
    setDraftDoc({ ...draftDoc, rules: next });
  };

  const getCategoryBadge = (category: ClubRuleItem['category']) => {
    switch (category) {
      case 'sportsmanship':
        return {
          icon: HeartHandshake,
          label: 'Sportsmanship & Respect',
          className: 'bg-emerald-50 text-emerald-800 border-emerald-200',
        };
      case 'attendance':
        return {
          icon: Clock,
          label: 'Attendance & Polls',
          className: 'bg-sky-50 text-sky-800 border-sky-200',
        };
      case 'discipline':
        return {
          icon: ShieldAlert,
          label: 'Discipline & Cards',
          className: 'bg-rose-50 text-rose-800 border-rose-200',
        };
      case 'safety':
        return {
          icon: Shield,
          label: 'Safety & Equipment',
          className: 'bg-amber-50 text-amber-800 border-amber-200',
        };
      case 'financial':
        return {
          icon: DollarSign,
          label: 'Society Dues',
          className: 'bg-purple-50 text-purple-800 border-purple-200',
        };
      default:
        return {
          icon: Scale,
          label: 'General Conduct',
          className: 'bg-slate-50 text-slate-800 border-slate-200',
        };
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Top Banner & Header */}
      <div className="bg-gradient-to-br from-slate-950 via-slate-900 to-[#0e1d38] border border-slate-800 rounded-2xl p-6 sm:p-8 text-white relative overflow-hidden shadow-xl">
        <div className="absolute top-0 right-0 -mt-10 -mr-10 w-64 h-64 bg-red-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 -mb-10 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div className="space-y-2.5 max-w-xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-950/70 border border-red-800/60 text-red-300 text-xs font-semibold uppercase tracking-wider">
              <Scale className="w-3.5 h-3.5 text-red-400" />
              Persepolis Vancouver Football Club Society (PVFCS)
            </div>
            <h1 className="text-2xl sm:text-3xl font-display font-bold tracking-tight text-white">
              {rulesDoc.title}
            </h1>
            <p className="text-sm text-slate-300 leading-relaxed">
              {rulesDoc.subtitle}
            </p>
            <div className="text-xs text-slate-400 flex items-center gap-2 pt-1 font-mono-tabular">
              <span>Last revised: {rulesDoc.lastUpdated}</span>
              <span>•</span>
              <span>All members accountable</span>
            </div>
          </div>

          <div className="flex flex-col items-end gap-3 shrink-0 w-full sm:w-auto">
            <ClubBrandMark showWordmark={false} size="md" tone="dark" />
            {isAdmin && (
              <button
                type="button"
                onClick={handleOpenEdit}
                className="w-full sm:w-auto px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-semibold border border-white/20 transition-colors flex items-center justify-center gap-1.5"
              >
                <Edit3 className="w-3.5 h-3.5" />
                Edit Code of Conduct
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Rules Accordion / Cards List */}
      <div className="space-y-4">
        {rulesDoc.rules.map((rule, index) => {
          const badge = getCategoryBadge(rule.category);
          const BadgeIcon = badge.icon;
          return (
            <div
              key={rule.id || index}
              className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-3.5 shadow-xs hover:border-slate-300 transition-colors"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <h3 className="text-base font-semibold text-slate-900">
                  {rule.title}
                </h3>
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold border ${badge.className} self-start sm:self-auto shrink-0`}
                >
                  <BadgeIcon className="w-3 h-3" />
                  {badge.label}
                </span>
              </div>

              <p className="text-xs font-medium text-slate-700 bg-slate-50 border border-slate-100 rounded-lg p-3 leading-relaxed">
                {rule.summary}
              </p>

              <ul className="space-y-2 text-xs text-slate-600 pl-1">
                {rule.details.map((detail, dIdx) => (
                  <li key={dIdx} className="flex items-start gap-2.5 leading-relaxed">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-600 mt-1.5 shrink-0" />
                    <span>{detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {/* Disciplinary Notice Footer */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 text-center space-y-1.5 text-xs text-slate-600">
        <div className="font-semibold text-slate-800 flex items-center justify-center gap-1.5">
          <ShieldAlert className="w-4 h-4 text-red-600" />
          Zero Tolerance Disciplinary Policy
        </div>
        <p className="max-w-2xl mx-auto text-slate-500">
          Persepolis Vancouver Football Club Society (PVFCS) maintains a zero-tolerance policy against aggression, unsportsmanlike behavior, or intentional misconduct. The management reserves the absolute right to suspend or revoke membership at any time to preserve the safety and joy of the club.
        </p>
      </div>

      {/* Admin Edit Modal */}
      {isEditing && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/70 flex items-center justify-center p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col my-auto">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4 bg-slate-50 shrink-0">
              <div>
                <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                  <Edit3 className="w-4 h-4 text-emerald-700" />
                  Manage Code of Conduct &amp; Rules
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Update rules, discipline guidelines, and society expectations visible to all players.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6 text-xs">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Section Title</label>
                  <input
                    type="text"
                    value={draftDoc.title}
                    onChange={(e) => setDraftDoc({ ...draftDoc, title: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Last Revision Date</label>
                  <input
                    type="text"
                    value={draftDoc.lastUpdated}
                    onChange={(e) => setDraftDoc({ ...draftDoc, lastUpdated: e.target.value })}
                    placeholder="November 2026"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Subtitle / Purpose</label>
                <textarea
                  rows={2}
                  value={draftDoc.subtitle}
                  onChange={(e) => setDraftDoc({ ...draftDoc, subtitle: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-none"
                />
              </div>

              <div className="border-t border-slate-200 pt-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-slate-900 text-sm">Rules &amp; Discipline Items ({draftDoc.rules.length})</h4>
                  <button
                    type="button"
                    onClick={handleAddRuleItem}
                    className="px-3 py-1.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-300 hover:bg-emerald-100 font-semibold inline-flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Rule
                  </button>
                </div>

                {draftDoc.rules.map((rule, idx) => (
                  <div key={rule.id || idx} className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 flex-1">
                        <span className="font-mono font-bold text-slate-400">#{idx + 1}</span>
                        <input
                          type="text"
                          value={rule.title}
                          onChange={(e) => handleUpdateRuleItem(idx, 'title', e.target.value)}
                          className="flex-1 px-2.5 py-1.5 rounded-md border border-slate-300 bg-white font-semibold text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-none"
                        />
                      </div>
                      <select
                        value={rule.category}
                        onChange={(e) => handleUpdateRuleItem(idx, 'category', e.target.value as ClubRuleItem['category'])}
                        className="px-2 py-1.5 rounded-md border border-slate-300 bg-white text-xs"
                      >
                        <option value="sportsmanship">Sportsmanship</option>
                        <option value="attendance">Attendance</option>
                        <option value="discipline">Discipline</option>
                        <option value="safety">Safety</option>
                        <option value="financial">Financial</option>
                        <option value="general">General</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => handleDeleteRuleItem(idx)}
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded-md"
                        title="Delete rule"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">Summary</label>
                      <input
                        type="text"
                        value={rule.summary}
                        onChange={(e) => handleUpdateRuleItem(idx, 'summary', e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-md border border-slate-300 bg-white text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        Bullet Points (one per line)
                      </label>
                      <textarea
                        rows={3}
                        value={rule.details.join('\n')}
                        onChange={(e) =>
                          handleUpdateRuleItem(
                            idx,
                            'details',
                            e.target.value.split('\n').filter((l) => l.trim().length > 0)
                          )
                        }
                        className="w-full px-2.5 py-1.5 rounded-md border border-slate-300 bg-white text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-none font-mono"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3 shrink-0">
              <button
                type="button"
                onClick={handleResetToOfficialDefaults}
                className="px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <RefreshCcw className="w-3.5 h-3.5" />
                Reset to Official Standard
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSaveDraft}
                  className="px-5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold disabled:opacity-50 inline-flex items-center gap-1.5 shadow-xs"
                >
                  {saving ? (
                    'Saving...'
                  ) : saveSuccess ? (
                    <>
                      <Check className="w-3.5 h-3.5" /> Saved!
                    </>
                  ) : (
                    'Save & Publish Rules'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
