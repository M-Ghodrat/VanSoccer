import React, { useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  deleteUser,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
  User,
} from 'firebase/auth';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { AlertCircle, ArrowRight, CheckCircle2, Mail, RefreshCw, Trash2 } from 'lucide-react';
import { auth } from '../firebase';
import { googleSignInWithGmail } from '../utils/gmailAuth';
import { GoogleSignInButton } from './GoogleSignInButton';

interface AuthGateProps {
  unverifiedUser: User | null;
  onUserVerified: () => Promise<void>;
}

interface PitchMarker {
  id: string;
  team: 'emerald' | 'amber';
  role: string;
  phases: Array<{ x: number; y: number }>;
}

// Three realistic tactical phases across a horizontal 360x200 pitch SVG
const TACTICAL_MARKERS: PitchMarker[] = [
  // Emerald squad (attacking left -> right)
  {
    id: 'e-gk',
    team: 'emerald',
    role: 'GK',
    phases: [
      { x: 24, y: 100 },
      { x: 28, y: 98 },
      { x: 24, y: 102 },
    ],
  },
  {
    id: 'e-def1',
    team: 'emerald',
    role: 'CB',
    phases: [
      { x: 86, y: 60 },
      { x: 108, y: 52 },
      { x: 96, y: 66 },
    ],
  },
  {
    id: 'e-def2',
    team: 'emerald',
    role: 'CB',
    phases: [
      { x: 86, y: 140 },
      { x: 112, y: 144 },
      { x: 96, y: 134 },
    ],
  },
  {
    id: 'e-mid',
    team: 'emerald',
    role: 'CM',
    phases: [
      { x: 158, y: 100 },
      { x: 196, y: 72 },
      { x: 174, y: 122 },
    ],
  },
  {
    id: 'e-wing',
    team: 'emerald',
    role: 'RW',
    phases: [
      { x: 196, y: 46 },
      { x: 256, y: 40 },
      { x: 230, y: 68 },
    ],
  },
  {
    id: 'e-st',
    team: 'emerald',
    role: 'ST',
    phases: [
      { x: 224, y: 136 },
      { x: 278, y: 104 },
      { x: 248, y: 112 },
    ],
  },
  // Amber squad (defending / countering right -> left)
  {
    id: 'a-gk',
    team: 'amber',
    role: 'GK',
    phases: [
      { x: 336, y: 100 },
      { x: 334, y: 102 },
      { x: 336, y: 98 },
    ],
  },
  {
    id: 'a-def1',
    team: 'amber',
    role: 'CB',
    phases: [
      { x: 274, y: 64 },
      { x: 292, y: 68 },
      { x: 258, y: 58 },
    ],
  },
  {
    id: 'a-def2',
    team: 'amber',
    role: 'CB',
    phases: [
      { x: 274, y: 136 },
      { x: 292, y: 134 },
      { x: 252, y: 142 },
    ],
  },
  {
    id: 'a-mid',
    team: 'amber',
    role: 'CM',
    phases: [
      { x: 204, y: 100 },
      { x: 232, y: 96 },
      { x: 184, y: 90 },
    ],
  },
  {
    id: 'a-wing',
    team: 'amber',
    role: 'LW',
    phases: [
      { x: 162, y: 152 },
      { x: 194, y: 154 },
      { x: 140, y: 144 },
    ],
  },
  {
    id: 'a-st',
    team: 'amber',
    role: 'ST',
    phases: [
      { x: 138, y: 54 },
      { x: 168, y: 76 },
      { x: 118, y: 72 },
    ],
  },
];

// Ball follows passing sequence through the tactical phases
const BALL_TRAJECTORY = [
  { x: 158, y: 100 }, // CM starts on the ball
  { x: 196, y: 46 },  // Driven out wide to RW
  { x: 256, y: 40 },  // RW advances down the flank
  { x: 278, y: 104 }, // Cutback into ST at the box
  { x: 230, y: 68 },  // Recycle through pressing shape
  { x: 174, y: 122 }, // Reset across midfield
];

export const AuthGate: React.FC<AuthGateProps> = ({ unverifiedUser, onUserVerified }) => {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [heroImgFailed, setHeroImgFailed] = useState(false);
  const [crestImgFailed, setCrestImgFailed] = useState(false);

  const shouldReduceMotion = useReducedMotion();

  const handleGoogleSignIn = async () => {
    setError(null);
    setNotice(null);
    setGoogleLoading(true);
    try {
      await googleSignInWithGmail();
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/popup-closed-by-user') {
        setError('Google sign-in popup was closed before finishing.');
      } else if (code === 'auth/account-exists-with-different-credential') {
        setError('An account already exists with this email using a different sign-in method.');
      } else {
        setError(err instanceof Error ? err.message : 'Google sign-in failed.');
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    if (mode === 'signup' && password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      if (mode === 'signup') {
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await sendEmailVerification(cred.user);
        setNotice('Confirmation email sent. Please check your inbox and verify your address.');
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/operation-not-allowed') {
        setError(
          'Email/Password sign-in is not yet enabled in Firebase Console (Authentication -> Sign-in method).'
        );
      } else if (code === 'auth/email-already-in-use') {
        setError('An account with this email already exists. Try signing in instead.');
      } else if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
        setError('Invalid email or password.');
      } else if (code === 'auth/weak-password') {
        setError('Password must be at least 6 characters.');
      } else {
        setError(err instanceof Error ? err.message : 'Authentication failed.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    if (!unverifiedUser) return;
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      await sendEmailVerification(unverifiedUser);
      setNotice(`Verification link re-sent to ${unverifiedUser.email}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend verification email.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!unverifiedUser) return;
    const checkOnFocus = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const current = auth.currentUser || unverifiedUser;
        await current.reload();
        if (current.emailVerified) {
          await current.getIdToken(true);
          await onUserVerified();
        }
      } catch {
        // Ignore silent background check errors; user can click Continue button
      }
    };
    window.addEventListener('focus', checkOnFocus);
    document.addEventListener('visibilitychange', checkOnFocus);
    return () => {
      window.removeEventListener('focus', checkOnFocus);
      document.removeEventListener('visibilitychange', checkOnFocus);
    };
  }, [unverifiedUser, onUserVerified]);

  const handleCheckVerification = async () => {
    const current = auth.currentUser || unverifiedUser;
    if (!current) return;
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      await current.reload();
      const refreshed = auth.currentUser || current;
      if (refreshed.emailVerified) {
        await refreshed.getIdToken(true);
        await onUserVerified();
      } else {
        setError('Email is not verified yet. Please open the confirmation link in your inbox (check spam/junk), then click Continue again.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh verification status.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUnverifiedAccount = async () => {
    if (!unverifiedUser) return;
    setError(null);
    setLoading(true);
    try {
      await deleteUser(unverifiedUser);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Please sign in again before deleting your account.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 grid lg:grid-cols-12 items-stretch overflow-x-hidden">
      {/* Left Floodlit Pitch Showcase */}
      <div className="lg:col-span-7 relative overflow-hidden flex flex-col justify-between p-7 sm:p-10 lg:p-14 min-h-[420px]">
        {/* Slow Ken Burns Pitch Backdrop */}
        <motion.div
          aria-hidden="true"
          className="absolute inset-0 will-change-transform"
          animate={
            shouldReduceMotion
              ? undefined
              : {
                  scale: [1.03, 1.11, 1.03],
                  x: ['0%', '-1.8%', '0%'],
                  y: ['0%', '-1.2%', '0%'],
                }
          }
          transition={{ duration: 28, repeat: Infinity, ease: 'easeInOut' }}
        >
          {!heroImgFailed ? (
            <img
              src="/src/assets/images/vancouver_pitch_hero_1794555179079.jpg"
              alt="Evening floodlit soccer pitch in Vancouver"
              referrerPolicy="no-referrer"
              onError={() => setHeroImgFailed(true)}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full pitch-stripes" />
          )}
        </motion.div>

        {/* Evening Stadium Depth Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/65 to-slate-950/45" />

        {/* Ambient Drifting Floodlight Sweeps (Compositor-Only Transform + Opacity) */}
        {!shouldReduceMotion && (
          <>
            <motion.div
              aria-hidden="true"
              className="pointer-events-none absolute -top-28 -left-24 w-[480px] h-[480px] rounded-full bg-emerald-400/20 blur-3xl will-change-transform"
              animate={{
                x: [0, 90, -20, 0],
                y: [0, 45, 15, 0],
                opacity: [0.35, 0.55, 0.35],
              }}
              transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.div
              aria-hidden="true"
              className="pointer-events-none absolute -bottom-24 right-[-60px] w-[420px] h-[420px] rounded-full bg-amber-400/15 blur-3xl will-change-transform"
              animate={{
                x: [0, -70, 20, 0],
                y: [0, -50, -10, 0],
                opacity: [0.25, 0.48, 0.25],
              }}
              transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
            />
          </>
        )}

        {/* Top Brand Lockup */}
        <motion.div
          initial={shouldReduceMotion ? false : { opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
          className="relative z-10 flex items-center"
        >
          <img
            src="/assets/aistudio/perspolis_icon.png"
            alt="Perspolis Vancouver"
            referrerPolicy="no-referrer"
            className="w-11 h-11 object-contain"
          />
        </motion.div>

        {/* Transparent Floating Tactical Pitch Overlay */}
        <motion.div
          initial={shouldReduceMotion ? false : { opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.55, delay: 0.1, ease: 'easeOut' }}
          className="relative z-10 my-6 lg:my-8 max-w-xl"
        >
          <svg
            viewBox="0 0 360 200"
            className="w-full h-auto block"
            role="img"
            aria-label="Animated 6-a-side tactical pitch formation preview"
          >
            {/* Translucent chalk pitch markings floating directly over stadium photo */}
            <g stroke="rgba(255,255,255,0.28)" strokeWidth="1.25" fill="none">
              <rect x="12" y="12" width="336" height="176" rx="4" />
              <line x1="180" y1="12" x2="180" y2="188" />
              <circle cx="180" cy="100" r="28" />
              <circle cx="180" cy="100" r="2" fill="rgba(255,255,255,0.4)" />
              {/* Left & Right penalty boxes */}
              <rect x="12" y="54" width="44" height="92" />
              <rect x="12" y="76" width="16" height="48" />
              <rect x="304" y="54" width="44" height="92" />
              <rect x="332" y="76" width="16" height="48" />
            </g>

            {/* Semi-Transparent Moving Tactical Player Nodes */}
            {TACTICAL_MARKERS.map((marker) => {
              const isEmerald = marker.team === 'emerald';
              const start = marker.phases[0];
              const xs = marker.phases.map((p) => p.x);
              const ys = marker.phases.map((p) => p.y);
              return (
                <motion.g
                  key={marker.id}
                  opacity={0.72}
                  initial={{ x: start.x, y: start.y }}
                  animate={
                    shouldReduceMotion
                      ? { x: start.x, y: start.y }
                      : {
                          x: [...xs, start.x],
                          y: [...ys, start.y],
                        }
                  }
                  transition={{
                    duration: 12,
                    repeat: Infinity,
                    ease: 'easeInOut',
                  }}
                >
                  <circle
                    cx="0"
                    cy="0"
                    r="11.5"
                    fill={isEmerald ? 'rgba(16, 185, 129, 0.14)' : 'rgba(245, 158, 11, 0.14)'}
                  />
                  <circle
                    cx="0"
                    cy="0"
                    r="8.5"
                    fill={isEmerald ? 'rgba(5, 150, 105, 0.56)' : 'rgba(217, 119, 6, 0.56)'}
                    stroke="rgba(255, 255, 255, 0.65)"
                    strokeWidth="1.25"
                  />
                  <text
                    x="0"
                    y="2.8"
                    textAnchor="middle"
                    fill="rgba(255, 255, 255, 0.9)"
                    fontSize="6.5"
                    fontWeight="700"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {marker.role}
                  </text>
                </motion.g>
              );
            })}

            {/* Semi-Transparent Animated Soccer Ball */}
            <motion.g
              opacity={0.78}
              initial={{ x: BALL_TRAJECTORY[0].x, y: BALL_TRAJECTORY[0].y }}
              animate={
                shouldReduceMotion
                  ? { x: BALL_TRAJECTORY[0].x, y: BALL_TRAJECTORY[0].y }
                  : {
                      x: [...BALL_TRAJECTORY.map((p) => p.x), BALL_TRAJECTORY[0].x],
                      y: [...BALL_TRAJECTORY.map((p) => p.y), BALL_TRAJECTORY[0].y],
                    }
              }
              transition={{
                duration: 12,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            >
              <circle cx="0" cy="0" r="8" fill="rgba(255, 255, 255, 0.18)" />
              <circle
                cx="0"
                cy="0"
                r="4.5"
                fill="rgba(255, 255, 255, 0.78)"
                stroke="rgba(15, 23, 42, 0.75)"
                strokeWidth="1.2"
              />
            </motion.g>
          </svg>
        </motion.div>

        {/* Bottom Hero Copy */}
        <motion.div
          initial={shouldReduceMotion ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.16, ease: 'easeOut' }}
          className="relative z-10 max-w-xl space-y-3"
        >
          <h1
            className="font-display font-bold tracking-tight text-white leading-[1.0] text-balance"
            style={{ fontSize: 'clamp(2.35rem, 4.2vw, 3.85rem)' }}
          >
            Perspolis Vancouver
          </h1>
          <p className="text-sm text-slate-300 leading-relaxed max-w-lg">
            Sign in to confirm matchday attendance, view balanced squad formations, and track club standings every week.
          </p>
        </motion.div>
      </div>

      {/* Right Auth Panel */}
      <div className="lg:col-span-5 bg-white text-slate-900 flex flex-col justify-center p-8 sm:p-12 lg:p-14 relative">
        <motion.div
          initial={shouldReduceMotion ? false : { opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
          className="w-full max-w-md mx-auto"
        >
          {/* Official Club Wordmark Logo */}
          <div className="mb-7">
            {!crestImgFailed ? (
              <motion.img
                src="/assets/aistudio/perspolis_logo.png"
                alt="Perspolis Vancouver"
                referrerPolicy="no-referrer"
                onError={() => setCrestImgFailed(true)}
                className="h-12 sm:h-14 w-auto object-contain will-change-transform"
                whileHover={shouldReduceMotion ? undefined : { scale: 1.03 }}
                transition={{ type: 'spring', stiffness: 360, damping: 22 }}
              />
            ) : (
              <div className="w-12 h-12 rounded-lg bg-red-700 flex items-center justify-center font-display text-xl font-bold text-white shrink-0">
                P
              </div>
            )}
          </div>

          <AnimatePresence mode="wait">
            {unverifiedUser ? (
              <motion.div
                key="unverified-view"
                initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={shouldReduceMotion ? undefined : { opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                className="space-y-6"
              >
                <div className="w-12 h-12 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700">
                  <Mail className="w-6 h-6" />
                </div>
                <div className="space-y-2">
                  <h2 className="font-display text-3xl font-bold tracking-tight text-slate-900">
                    Confirm Your Email
                  </h2>
                  <p className="text-sm text-slate-600 leading-relaxed">
                    We sent a verification link to <span className="font-semibold text-slate-900">{unverifiedUser.email}</span>. Click the link in your email to activate your player account.
                  </p>
                </div>

                {error && (
                  <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800 flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                {notice && (
                  <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>{notice}</span>
                  </div>
                )}

                <div className="space-y-3">
                  <motion.button
                    type="button"
                    onClick={handleCheckVerification}
                    disabled={loading}
                    whileHover={shouldReduceMotion ? undefined : { y: -1 }}
                    whileTap={shouldReduceMotion ? undefined : { scale: 0.99 }}
                    className="w-full py-2.5 px-4 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-60 whitespace-nowrap"
                  >
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    I Confirmed My Email — Continue
                  </motion.button>

                  <button
                    type="button"
                    onClick={handleResendVerification}
                    disabled={loading}
                    className="w-full py-2.5 px-4 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 font-medium text-sm transition-colors disabled:opacity-60 whitespace-nowrap"
                  >
                    Resend Confirmation Email
                  </button>
                </div>

                <div className="pt-4 border-t border-slate-200 flex items-center justify-between text-xs">
                  <button
                    type="button"
                    onClick={() => signOut(auth)}
                    className="text-slate-600 hover:text-slate-900 font-medium"
                  >
                    Sign out
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteUnverifiedAccount}
                    disabled={loading}
                    className="text-red-600 hover:text-red-700 font-medium flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete account
                  </button>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="auth-form-view"
                initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={shouldReduceMotion ? undefined : { opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                className="space-y-6"
              >
                <div>
                  <h2 className="font-display text-3xl font-bold tracking-tight text-slate-900">
                    {mode === 'signin' ? 'Club Sign In' : 'Register Player Account'}
                  </h2>
                  <p className="text-sm text-slate-600 mt-1">
                    {mode === 'signin'
                      ? 'Access weekly match polls, tactical pitches, and your club stats.'
                      : 'Create your account with email confirmation (password min 6 characters).'}
                  </p>
                </div>

                {/* Sliding Mode Switcher */}
                <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg relative">
                  {(['signin', 'signup'] as const).map((tab) => {
                    const isActive = mode === tab;
                    return (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => {
                          setMode(tab);
                          setError(null);
                          setNotice(null);
                        }}
                        className={`relative z-10 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                          isActive ? 'text-slate-900' : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {isActive && (
                          <motion.span
                            layoutId="auth-mode-indicator"
                            transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                            className="absolute inset-0 bg-white rounded-md shadow-sm -z-10"
                          />
                        )}
                        {tab === 'signin' ? 'Sign In' : 'Create Account'}
                      </button>
                    );
                  })}
                </div>

                <AnimatePresence initial={false}>
                  {error && (
                    <motion.div
                      initial={shouldReduceMotion ? false : { opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={shouldReduceMotion ? undefined : { opacity: 0, y: -4 }}
                      className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800 flex items-start gap-2.5"
                    >
                      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                      <span>{error}</span>
                    </motion.div>
                  )}

                  {notice && (
                    <motion.div
                      initial={shouldReduceMotion ? false : { opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={shouldReduceMotion ? undefined : { opacity: 0, y: -4 }}
                      className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 flex items-start gap-2.5"
                    >
                      <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                      <span>{notice}</span>
                    </motion.div>
                  )}
                </AnimatePresence>

                <form onSubmit={handleEmailAuth} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">Email Address</label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="player@vancouverfc.ca"
                      className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600 transition-shadow"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Password <span className="font-normal text-slate-500">(at least 6 characters)</span>
                    </label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••"
                      className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600 transition-shadow"
                    />
                  </div>

                  <AnimatePresence initial={false}>
                    {mode === 'signup' && (
                      <motion.div
                        key="confirm-password-field"
                        initial={shouldReduceMotion ? false : { opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={shouldReduceMotion ? undefined : { opacity: 0, y: -6 }}
                        transition={{ duration: 0.18 }}
                      >
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">Confirm Password</label>
                        <input
                          type="password"
                          required
                          minLength={6}
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder="••••••"
                          className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600 transition-shadow"
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <motion.button
                    type="submit"
                    disabled={loading}
                    whileHover={shouldReduceMotion ? undefined : { y: -1 }}
                    whileTap={shouldReduceMotion ? undefined : { scale: 0.99 }}
                    className="group relative overflow-hidden w-full py-2.5 px-4 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-sm transition-colors disabled:opacity-60 whitespace-nowrap flex items-center justify-center gap-2"
                  >
                    <span>
                      {loading
                        ? 'Processing...'
                        : mode === 'signin'
                          ? 'Sign In to Club'
                          : 'Create Account & Send Confirmation'}
                    </span>
                    {!loading && (
                      <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                    )}
                  </motion.button>
                </form>

                <div className="relative flex items-center py-1">
                  <div className="flex-1 border-t border-slate-200" />
                  <span className="px-3 text-[11px] font-medium text-slate-400 uppercase tracking-wider">
                    or
                  </span>
                  <div className="flex-1 border-t border-slate-200" />
                </div>

                <GoogleSignInButton
                  onClick={handleGoogleSignIn}
                  disabled={loading}
                  loading={googleLoading}
                  fullWidth
                />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  );
};

