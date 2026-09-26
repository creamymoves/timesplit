import { signInWithEmail } from './actions';

export default function LoginPage({ searchParams }: { searchParams: { next?: string; sent?: string; error?: string } }) {
  return (
    <main>
      <h1>Sign in</h1>
      {searchParams.sent ? (
        <p>Check your email for a sign-in link.</p>
      ) : (
        <form action={signInWithEmail}>
          <input type="hidden" name="next" value={searchParams.next ?? '/dashboard'} />
          <label>
            Email <input type="email" name="email" required />
          </label>
          <button type="submit">Send magic link</button>
          {searchParams.error ? <p role="alert">{searchParams.error}</p> : null}
        </form>
      )}
    </main>
  );
}
