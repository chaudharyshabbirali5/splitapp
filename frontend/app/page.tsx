import { redirect } from 'next/navigation';

/**
 * The app has no marketing landing page yet. Middleware decides where an
 * unauthenticated visitor ends up, so send everyone at the real entry point.
 */
export default function Home() {
  redirect('/groups');
}
