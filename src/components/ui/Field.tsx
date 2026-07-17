'use client';

import { forwardRef, ReactNode, useId } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ---- Shared label / helper wrapper --------------------------------------- */
export function FieldShell({
  label,
  htmlFor,
  helper,
  error,
  success,
  required,
  children,
  className,
}: {
  label?: string;
  htmlFor?: string;
  helper?: string;
  error?: string;
  success?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <label
          htmlFor={htmlFor}
          className="block text-[13px] font-medium text-ink"
        >
          {label}
          {required && <span className="ml-0.5 text-danger">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="flex items-center gap-1 text-xs font-medium text-danger">
          <AlertCircle className="h-3.5 w-3.5" />
          {error}
        </p>
      ) : success ? (
        <p className="flex items-center gap-1 text-xs font-medium text-success">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {success}
        </p>
      ) : helper ? (
        <p className="text-xs text-ink-secondary">{helper}</p>
      ) : null}
    </div>
  );
}

const baseField =
  'w-full rounded-[10px] border bg-white px-3.5 text-sm text-ink placeholder:text-ink-tertiary transition-all duration-150 focus:outline-none disabled:opacity-60 disabled:bg-surface-2';

function stateClasses(error?: boolean, success?: boolean) {
  if (error)
    return 'border-danger/60 focus:border-danger focus:ring-2 focus:ring-danger/15';
  if (success)
    return 'border-success/50 focus:border-success focus:ring-2 focus:ring-success/15';
  return 'border-border hover:border-border-strong focus:border-brand focus:ring-2 focus:ring-brand/15';
}

/* ---- Input ---------------------------------------------------------------- */
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helper?: string;
  error?: string;
  success?: string;
  leftIcon?: ReactNode;
  rightAddon?: ReactNode;
  containerClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    { label, helper, error, success, leftIcon, rightAddon, required, className, containerClassName, id, ...props },
    ref
  ) => {
    const reactId = useId();
    const fieldId = id ?? reactId;
    return (
      <FieldShell
        label={label}
        htmlFor={fieldId}
        helper={helper}
        error={error}
        success={success}
        required={required}
        className={containerClassName}
      >
        <div className="relative">
          {leftIcon && (
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-tertiary">
              {leftIcon}
            </span>
          )}
          <input
            ref={ref}
            id={fieldId}
            className={cn(
              baseField,
              'h-10',
              stateClasses(!!error, !!success),
              leftIcon && 'pl-10',
              rightAddon && 'pr-12',
              className
            )}
            {...props}
          />
          {rightAddon && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[13px] font-medium text-ink-secondary">
              {rightAddon}
            </span>
          )}
        </div>
      </FieldShell>
    );
  }
);
Input.displayName = 'Input';

/* ---- Textarea ------------------------------------------------------------- */
interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  helper?: string;
  error?: string;
  required?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, helper, error, required, className, id, ...props }, ref) => {
    const reactId = useId();
    const fieldId = id ?? reactId;
    return (
      <FieldShell label={label} htmlFor={fieldId} helper={helper} error={error} required={required}>
        <textarea
          ref={ref}
          id={fieldId}
          className={cn(baseField, 'py-2.5 resize-y min-h-[88px]', stateClasses(!!error), className)}
          {...props}
        />
      </FieldShell>
    );
  }
);
Textarea.displayName = 'Textarea';

/* ---- Native Select (styled) ---------------------------------------------- */
interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  helper?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, helper, error, required, className, children, id, ...props }, ref) => {
    const reactId = useId();
    const fieldId = id ?? reactId;
    return (
      <FieldShell label={label} htmlFor={fieldId} helper={helper} error={error} required={required}>
        <div className="relative">
          <select
            ref={ref}
            id={fieldId}
            className={cn(
              baseField,
              'h-10 appearance-none pr-9 cursor-pointer',
              stateClasses(!!error),
              className
            )}
            {...props}
          >
            {children}
          </select>
          <svg
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-tertiary"
            viewBox="0 0 20 20"
            fill="none"
          >
            <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </FieldShell>
    );
  }
);
Select.displayName = 'Select';
