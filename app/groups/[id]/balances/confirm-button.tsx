'use client';

import { useFormStatus } from 'react-dom';

function Inner() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="shrink-0 rounded-md bg-green-700 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-800 disabled:opacity-50"
    >
      {pending ? 'Confirming…' : 'Confirm received'}
    </button>
  );
}

export function ConfirmButton({ action }: { action: () => Promise<void> }) {
  return (
    <form action={action}>
      <Inner />
    </form>
  );
}
