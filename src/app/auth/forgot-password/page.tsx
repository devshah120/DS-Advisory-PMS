'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Mail, Lock, Eye, EyeOff, KeyRound, ArrowLeft } from 'lucide-react';
import { apiClient } from '@/lib/api';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Input, Button } from '@/components/ui';

type Step = 'request' | 'reset';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('request');

  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [show, setShow] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  // Step 1 — ask the backend to email a reset code.
  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setInfo('');
    try {
      const res = await apiClient
        .getClient()
        .post('/auth/forgot-password', { email });
      setInfo(res.data?.message || 'If an account exists, a reset code has been sent.');
      setStep('reset');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not send reset code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Step 2 — verify the code and set the new password.
  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await apiClient
        .getClient()
        .post('/auth/reset-password', { email, otp, newPassword });
      router.push('/auth/login?reset=1');
    } catch (err: any) {
      const msg = err.response?.data?.message;
      setError(Array.isArray(msg) ? msg[0] : msg || 'Could not reset password. Please try again.');
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <div className="mb-8">
        <h1 className="text-[26px] font-semibold tracking-tight text-ink">
          {step === 'request' ? 'Forgot password' : 'Enter reset code'}
        </h1>
        <p className="mt-1.5 text-[14px] text-ink-secondary">
          {step === 'request'
            ? "Enter your email and we'll send you a 6-digit reset code."
            : `We sent a code to ${email}. Enter it below with your new password.`}
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-[10px] border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-[13px] font-medium text-danger">
          {error}
        </div>
      )}
      {info && step === 'reset' && (
        <div className="mb-4 rounded-[10px] border border-brand/30 bg-brand/5 px-3.5 py-2.5 text-[13px] font-medium text-brand">
          {info}
        </div>
      )}

      {step === 'request' ? (
        <form onSubmit={handleRequest} className="space-y-4">
          <Input
            label="Email address"
            type="email"
            required
            placeholder="you@mail.com"
            leftIcon={<Mail className="h-4 w-4" />}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <Button type="submit" loading={loading} size="lg" className="w-full">
            Send reset code
          </Button>
        </form>
      ) : (
        <form onSubmit={handleReset} className="space-y-4">
          <Input
            label="Reset code"
            type="text"
            inputMode="numeric"
            required
            maxLength={6}
            placeholder="123456"
            leftIcon={<KeyRound className="h-4 w-4" />}
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
          />

          <Input
            label="New password"
            type={show ? 'text' : 'password'}
            required
            minLength={6}
            placeholder="••••••••"
            leftIcon={<Lock className="h-4 w-4" />}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            rightAddon={
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="text-ink-tertiary transition-colors hover:text-ink"
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            }
          />

          <Button type="submit" loading={loading} size="lg" className="w-full">
            Reset password
          </Button>

          <button
            type="button"
            onClick={() => {
              setStep('request');
              setError('');
              setOtp('');
              setNewPassword('');
            }}
            className="w-full text-[13px] font-medium text-ink-secondary hover:text-ink"
          >
            Use a different email
          </button>
        </form>
      )}

      <div className="mt-6">
        <Link
          href="/auth/login"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-brand hover:text-brand-hover"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to sign in
        </Link>
      </div>
    </AuthLayout>
  );
}
