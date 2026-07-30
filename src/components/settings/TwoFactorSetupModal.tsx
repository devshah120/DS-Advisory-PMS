'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { Check, Copy, Download, ShieldCheck } from 'lucide-react';
import { parseApiError } from '@/lib/clients.api';
import { securityApi, type TwoFactorSetup } from '@/lib/security.api';
import { Button, Input, Modal, Skeleton, useToast } from '@/components/ui';

/**
 * Enrolment is two screens, in this order for a reason: the codes screen only
 * appears once the authenticator has produced a working code, so a user can
 * never be left holding recovery codes for a factor that was never armed.
 */
type Step = 'scan' | 'codes';

export function TwoFactorSetupModal({
  isOpen,
  onClose,
  onEnabled,
}: {
  isOpen: boolean;
  onClose: () => void;
  /** Fired after the factor is live, so the parent can refresh its status. */
  onEnabled: () => void;
}) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>('scan');
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  const start = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      setSetup(await securityApi.startTwoFactorSetup());
    } catch (err) {
      setLoadError(parseApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch a fresh secret each time the modal opens. Re-opening after a cancelled
  // attempt therefore starts clean rather than reusing a half-scanned secret.
  useEffect(() => {
    if (!isOpen) return;
    setStep('scan');
    setCode('');
    setCodeError('');
    setRecoveryCodes([]);
    setCopied(false);
    start();
  }, [isOpen, start]);

  const verify = async () => {
    if (code.replace(/\s/g, '').length !== 6) {
      setCodeError('Enter the 6-digit code from your app');
      return;
    }

    setVerifying(true);
    setCodeError('');
    try {
      const res = await securityApi.confirmTwoFactor(code.replace(/\s/g, ''));
      setRecoveryCodes(res.recoveryCodes);
      setStep('codes');
      onEnabled();
      toast({ tone: 'success', title: 'Two-factor authentication enabled' });
    } catch (err) {
      setCodeError(parseApiError(err).message);
    } finally {
      setVerifying(false);
    }
  };

  const copyCodes = async () => {
    try {
      await navigator.clipboard.writeText(recoveryCodes.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ tone: 'error', title: 'Could not copy to clipboard' });
    }
  };

  const downloadCodes = () => {
    const body = [
      'Giriraj Global Capital — two-factor recovery codes',
      'Each code can be used once if you lose access to your authenticator app.',
      '',
      ...recoveryCodes,
    ].join('\n');

    const url = URL.createObjectURL(new Blob([body], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ds-advisory-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size={step === 'codes' ? 'md' : 'lg'}
      title={
        step === 'scan'
          ? 'Enable two-factor authentication'
          : 'Save your recovery codes'
      }
      description={
        step === 'scan'
          ? 'Scan the QR code with an authenticator app, then enter the code it shows.'
          : 'Store these somewhere safe. They are the only way back in if you lose your device.'
      }
      footer={
        step === 'scan' ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              loading={verifying}
              disabled={loading || !!loadError}
              leftIcon={<ShieldCheck className="h-4 w-4" />}
              onClick={verify}
            >
              Verify & enable
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>I&apos;ve saved these codes</Button>
        )
      }
    >
      {step === 'scan' ? (
        <div className="space-y-5">
          {loadError ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-[13px] text-danger">{loadError}</p>
              <Button variant="outline" size="sm" onClick={start}>
                Try again
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
              <div className="shrink-0">
                {loading || !setup ? (
                  <Skeleton className="h-[180px] w-[180px] rounded-[12px]" />
                ) : (
                  <div className="rounded-[12px] border border-border bg-white p-3">
                    {/* A data URI from our own API — unoptimized skips the
                        Next image loader, which can't process one. */}
                    <Image
                      src={setup.qrCodeDataUrl}
                      alt="Two-factor authentication QR code"
                      width={156}
                      height={156}
                      unoptimized
                    />
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1 space-y-4">
                <div>
                  <p className="text-[13px] font-medium text-ink">
                    Can&apos;t scan the code?
                  </p>
                  <p className="mt-1 text-[13px] text-ink-secondary">
                    Enter this key in your app instead:
                  </p>
                  {loading || !setup ? (
                    <Skeleton className="mt-2 h-9 w-full" />
                  ) : (
                    <code className="mt-2 block break-all rounded-[8px] bg-surface-2 px-3 py-2 font-mono text-[12px] tracking-wide text-ink">
                      {setup.secret}
                    </code>
                  )}
                </div>

                <Input
                  label="Verification code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  maxLength={7}
                  value={code}
                  error={codeError || undefined}
                  onChange={(e) => {
                    setCode(e.target.value.replace(/[^\d]/g, ''));
                    setCodeError('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') verify();
                  }}
                />
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 rounded-[10px] border border-border bg-surface-2 p-4">
            {recoveryCodes.map((c) => (
              <code
                key={c}
                className="font-mono text-[13px] tracking-wide text-ink"
              >
                {c}
              </code>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              leftIcon={
                copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />
              }
              onClick={copyCodes}
            >
              {copied ? 'Copied' : 'Copy codes'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              leftIcon={<Download className="h-4 w-4" />}
              onClick={downloadCodes}
            >
              Download
            </Button>
          </div>

          <p className="text-[12px] text-ink-tertiary">
            Each code works once. You won&apos;t be able to see them again — but you
            can generate a new set from Settings at any time.
          </p>
        </div>
      )}
    </Modal>
  );
}
