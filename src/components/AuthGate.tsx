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
import { AlertCircle, ArrowRight, Check, CheckCircle2, Mail, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { auth } from '../firebase';
import { ClubBrandMark } from './ClubBrandMark';
import { standardGoogleSignIn } from '../utils/gmailAuth';
import { GoogleSignInButton } from './GoogleSignInButton';
import {
  claimUsername,
  isUsernameAvailable,
  lookupEmailByUsername,
  validateUsername,
} from '../utils/usernameAuth';

interface AuthGateProps {
  unverifiedUser: User | null;
  onUserVerified: () => Promise<void>;
}

export const AuthGate: React.FC<AuthGateProps> = ({ unverifiedUser, onUserVerified }) => {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [email, setEmail] = useState('');
  const [signupUsername, setSignupUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [heroImgFailed, setHeroImgFailed] = useState(false);

  const shouldReduceMotion = useReducedMotion();

  // Password strength checks (Standard OWASP/NIST criteria: min 8, upper, lower, digit, special)
  const pwdMinLen = password.length >= 8;
  const pwdHasUpper = /[A-Z]/.test(password);
  const pwdHasLower = /[a-z]/.test(password);
  const pwdHasDigit = /[0-9]/.test(password);
  const pwdHasSpecial = /[^A-Za-z0-9]/.test(password);
  const isPwdStrong = pwdMinLen && pwdHasUpper && pwdHasLower && pwdHasDigit && pwdHasSpecial;

  const handleGoogleSignIn = async () => {
    setError(null);
    setNotice(null);
    setGoogleLoading(true);
    try {
      await standardGoogleSignIn();
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

    if (mode === 'signup') {
      if (!pwdMinLen) {
        setError('Password must be at least 8 characters long.');
        return;
      }
      if (!pwdHasUpper) {
        setError('Password must contain at least one uppercase letter (A-Z).');
        return;
      }
      if (!pwdHasLower) {
        setError('Password must contain at least one lowercase letter (a-z).');
        return;
      }
      if (!pwdHasDigit) {
        setError('Password must contain at least one number (0-9).');
        return;
      }
      if (!pwdHasSpecial) {
        setError('Password must contain at least one special character (!@#$%^&* etc.).');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
    } else {
      if (!password || password.length < 6) {
        setError('Please enter your password.');
        return;
      }
    }

    setLoading(true);
    try {
      if (mode === 'signup') {
        const cleanUser = signupUsername.trim().toLowerCase();
        if (cleanUser) {
          const val = validateUsername(cleanUser);
          if (!val.valid) {
            setError(val.error || 'Invalid username format.');
            setLoading(false);
            return;
          }
          const avail = await isUsernameAvailable(cleanUser);
          if (!avail) {
            setError('This username is already taken. Please choose another one.');
            setLoading(false);
            return;
          }
        }

        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        if (cleanUser) {
          try {
            await claimUsername(cleanUser, email.trim(), cred.user.uid);
          } catch (claimErr) {
            console.warn('Could not register username on signup:', claimErr);
          }
        }
        await sendEmailVerification(cred.user);
        setNotice('Confirmation email sent. Please check your inbox and verify your address.');
      } else {
        const rawId = loginIdentifier.trim();
        if (!rawId) {
          setError('Please enter your email or personal username.');
          setLoading(false);
          return;
        }

        let targetEmail = rawId;
        if (!rawId.includes('@')) {
          // Username resolution
          const foundEmail = await lookupEmailByUsername(rawId);
          if (!foundEmail) {
            setError('No account found for this username. Please check your spelling or sign in with your email address.');
            setLoading(false);
            return;
          }
          targetEmail = foundEmail;
        }

        await signInWithEmailAndPassword(auth, targetEmail, password);
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
        setError('Invalid credentials. Please verify your email/username and password.');
      } else if (code === 'auth/weak-password') {
        setError('Password must meet the strong password criteria (8+ characters, upper, lower, number, special).');
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
      <div className="lg:col-span-7 relative overflow-hidden flex flex-col justify-end p-7 sm:p-10 lg:p-14 min-h-[420px]">
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

        {/* Bottom Hero Copy */}
        <motion.div
          initial={shouldReduceMotion ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.16, ease: 'easeOut' }}
          className="relative z-10 max-w-2xl space-y-3"
        >
          <h1
            className="font-display font-bold tracking-tight text-white leading-[1.06] text-balance"
            style={{ fontSize: 'clamp(1.85rem, 3.3vw, 3.1rem)' }}
          >
            Persepolis Vancouver Football Club Society (PVFCS)
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
            <motion.div
              className="inline-flex will-change-transform"
              whileHover={shouldReduceMotion ? undefined : { scale: 1.03 }}
              transition={{ type: 'spring', stiffness: 360, damping: 22 }}
            >
              <ClubBrandMark showWordmark={true} size="lg" tone="light" />
            </motion.div>
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
                      ? 'Sign in with your personal username or email to access weekly match polls and stats.'
                      : 'Create your account with a personal username and strong password (min 8 chars).'}
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
                  {mode === 'signin' ? (
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        Email Address or Personal Username
                      </label>
                      <input
                        type="text"
                        required
                        value={loginIdentifier}
                        onChange={(e) => setLoginIdentifier(e.target.value)}
                        placeholder="player@vancouverfc.ca or ali"
                        autoComplete="username"
                        className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600 transition-shadow"
                      />
                    </div>
                  ) : (
                    <>
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="block text-xs font-semibold text-slate-700">
                            Personal Username <span className="font-normal text-slate-500">(for easy login)</span>
                          </label>
                        </div>
                        <input
                          type="text"
                          value={signupUsername}
                          onChange={(e) =>
                            setSignupUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_.-]/g, ''))
                          }
                          placeholder="ali"
                          maxLength={24}
                          className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600 transition-shadow font-mono"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">Email Address *</label>
                        <input
                          type="email"
                          required
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="player@vancouverfc.ca"
                          className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600 transition-shadow"
                        />
                      </div>
                    </>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Password {mode === 'signup' && <span className="font-normal text-slate-500">(standard strong)</span>}
                    </label>
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600 transition-shadow"
                    />

                    {/* Live Strong Password Checklist (Standard OWASP Criteria) */}
                    {mode === 'signup' && (
                      <div className="mt-2.5 p-2.5 rounded-lg bg-slate-50 border border-slate-200 grid grid-cols-2 gap-1.5 text-[11px]">
                        <div className={`flex items-center gap-1.5 ${pwdMinLen ? 'text-emerald-700 font-semibold' : 'text-slate-500'}`}>
                          <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] ${pwdMinLen ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'}`}>✓</span>
                          8+ characters
                        </div>
                        <div className={`flex items-center gap-1.5 ${pwdHasUpper ? 'text-emerald-700 font-semibold' : 'text-slate-500'}`}>
                          <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] ${pwdHasUpper ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'}`}>✓</span>
                          Uppercase letter (A-Z)
                        </div>
                        <div className={`flex items-center gap-1.5 ${pwdHasLower ? 'text-emerald-700 font-semibold' : 'text-slate-500'}`}>
                          <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] ${pwdHasLower ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'}`}>✓</span>
                          Lowercase letter (a-z)
                        </div>
                        <div className={`flex items-center gap-1.5 ${pwdHasDigit ? 'text-emerald-700 font-semibold' : 'text-slate-500'}`}>
                          <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] ${pwdHasDigit ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'}`}>✓</span>
                          Number (0-9)
                        </div>
                        <div className={`flex items-center gap-1.5 col-span-2 ${pwdHasSpecial ? 'text-emerald-700 font-semibold' : 'text-slate-500'}`}>
                          <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] ${pwdHasSpecial ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'}`}>✓</span>
                          Special character (!@#$%^&*)
                        </div>
                      </div>
                    )}
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
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder="••••••••"
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

