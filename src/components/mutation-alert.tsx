type MutationAlertProps = {
  className?: string;
  message?: string | null;
};

export function MutationAlert({ className = "", message }: MutationAlertProps) {
  if (!message) {
    return null;
  }

  return (
    <div
      aria-live="polite"
      className={`rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold leading-5 text-rose-700 ${className}`}
      role="alert"
    >
      {message}
    </div>
  );
}
