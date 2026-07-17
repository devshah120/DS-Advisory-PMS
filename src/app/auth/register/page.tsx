'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Mail, Lock, User } from 'lucide-react';
import { apiClient } from '@/lib/api';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Input, Button } from '@/components/ui';

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.getClient().post('/auth/register', form);
      apiClient.setTokens(res.data);
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Registration failed');
      setLoading(false);
    }
  };

  const strength = Math.min(4, Math.floor(form.password.length / 3));
  const strengthLabel = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'][strength];
  const strengthColor = ['bg-danger', 'bg-danger', 'bg-warning', 'bg-info', 'bg-success'][strength];

  return (
    <AuthLayout>
      <div className="mb-8">
        <h1 className="text-[26px] font-semibold tracking-tight text-ink">Create your account</h1>
        <p className="mt-1.5 text-[14px] text-ink-secondary">Start managing portfolios in minutes.</p>
      </div>

      <form onSubmit={handleRegister} className="space-y-4">
        {error && (
          <div className="rounded-[10px] border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-[13px] font-medium text-danger">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="First name"
            required
            placeholder="Jane"
            leftIcon={<User className="h-4 w-4" />}
            value={form.firstName}
            onChange={(e) => set('firstName', e.target.value)}
          />
          <Input
            label="Last name"
            required
            placeholder="Doe"
            value={form.lastName}
            onChange={(e) => set('lastName', e.target.value)}
          />
        </div>

        <Input
          label="Work email"
          type="email"
          required
          placeholder="you@firm.com"
          leftIcon={<Mail className="h-4 w-4" />}
          value={form.email}
          onChange={(e) => set('email', e.target.value)}
        />

        <div>
          <Input
            label="Password"
            type="password"
            required
            placeholder="Create a strong password"
            leftIcon={<Lock className="h-4 w-4" />}
            value={form.password}
            onChange={(e) => set('password', e.target.value)}
          />
          {form.password && (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex flex-1 gap-1">
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className={`h-1 flex-1 rounded-full transition-colors ${
                      i < strength ? strengthColor : 'bg-surface-3'
                    }`}
                  />
                ))}
              </div>
              <span className="text-2xs font-medium text-ink-tertiary">{strengthLabel}</span>
            </div>
          )}
        </div>

        <Button type="submit" loading={loading} size="lg" className="w-full">
          Create account
        </Button>

        <p className="text-center text-2xs leading-relaxed text-ink-tertiary">
          By continuing you agree to DS Advisory&apos;s Terms of Service and Privacy Policy.
        </p>
      </form>

      <p className="mt-6 text-center text-[13px] text-ink-secondary">
        Already have an account?{' '}
        <Link href="/auth/login" className="font-semibold text-brand hover:text-brand-hover">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
