'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Mail, Lock, Eye, EyeOff } from 'lucide-react';
import { apiClient } from '@/lib/api';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Input, Button } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('dev@atlas.com');
  const [password, setPassword] = useState('demo1234');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.getClient().post('/auth/login', { email, password });
      apiClient.setTokens(res.data);
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Invalid email or password');
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <div className="mb-8">
        <h1 className="text-[26px] font-semibold tracking-tight text-ink">Welcome back</h1>
        <p className="mt-1.5 text-[14px] text-ink-secondary">Sign in to your DS Advisory workspace.</p>
      </div>

      <form onSubmit={handleLogin} className="space-y-4">
        {error && (
          <div className="rounded-[10px] border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-[13px] font-medium text-danger">
            {error}
          </div>
        )}

        <Input
          label="Email address"
          type="email"
          required
          placeholder="you@firm.com"
          leftIcon={<Mail className="h-4 w-4" />}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <Input
          label="Password"
          type={show ? 'text' : 'password'}
          required
          placeholder="••••••••"
          leftIcon={<Lock className="h-4 w-4" />}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
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

        <div className="flex items-center justify-between pt-1">
          <label className="flex items-center gap-2 text-[13px] text-ink-secondary">
            <input type="checkbox" className="h-4 w-4 rounded border-border-strong text-brand focus:ring-brand/30" />
            Remember me
          </label>
          <button type="button" className="text-[13px] font-medium text-brand hover:text-brand-hover">
            Forgot password?
          </button>
        </div>

        <Button type="submit" loading={loading} size="lg" className="w-full">
          Sign in
        </Button>
      </form>

      <p className="mt-6 text-center text-[13px] text-ink-secondary">
        New to DS Advisory?{' '}
        <Link href="/auth/register" className="font-semibold text-brand hover:text-brand-hover">
          Create an account
        </Link>
      </p>
    </AuthLayout>
  );
}
