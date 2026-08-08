'use client';

import { useFormStatus } from 'react-dom';

function Inner() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn btn-credit btn-sm shrink-0"
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
