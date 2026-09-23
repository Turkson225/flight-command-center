import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import './firebase-connection.css'

export interface FirebaseConnectionProps {
  configured: boolean
  authLoading: boolean
  userEmail: string | null
  connectionStatus: string
  message: string
  onSignIn: (email: string, password: string) => Promise<void>
  onSignOut: () => Promise<void>
}

/** Owner authentication is separate from the aircraft telemetry source. */
export function FirebaseConnection({
  configured,
  authLoading,
  userEmail,
  connectionStatus,
  message,
  onSignIn,
  onSignOut,
}: FirebaseConnectionProps) {
  const formId = useId()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const busy = authLoading || pending

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !configured) return

    const form = event.currentTarget
    const fields = new FormData(form)
    const email = String(fields.get('email') ?? '').trim()
    const password = String(fields.get('password') ?? '')
    if (!email || !password) return

    setError('')
    setPending(true)
    try {
      await onSignIn(email, password)
      form.reset()
    } catch {
      setError('Sign in failed. Check your email and password, then try again.')
    } finally {
      setPending(false)
    }
  }

  async function signOut() {
    if (busy) return
    setError('')
    setPending(true)
    try {
      await onSignOut()
    } catch {
      setError('Could not sign out. Please try again.')
    } finally {
      setPending(false)
    }
  }

  return <section className="panel firebase-connection" aria-labelledby={`${formId}-heading`} aria-busy={busy}>
    <div className="panel-head">
      <div>
        <span className="eyebrow">CLOUD / FIREBASE</span>
        <h2 id={`${formId}-heading`}>Owner connection</h2>
      </div>
      <span className={`firebase-connection-badge ${userEmail ? 'connected' : configured ? 'disconnected' : 'unconfigured'}`}>
        {userEmail ? 'SIGNED IN' : configured ? 'SIGNED OUT' : 'SETUP REQUIRED'}
      </span>
    </div>

    {!configured ? <div className="firebase-connection-empty">
      <strong>Firebase is not configured</strong>
      <p>Add the Firebase web configuration to the deployment to enable owner sign-in and cloud telemetry.</p>
    </div> : userEmail ? <div className="firebase-connection-account">
      <div><span>OWNER ACCOUNT</span><strong>{userEmail}</strong></div>
      <button type="button" className="firebase-connection-button secondary" onClick={signOut} disabled={busy}>SIGN OUT</button>
    </div> : <form className="firebase-connection-form" onSubmit={submit}>
      <div className="firebase-connection-field">
        <label htmlFor={`${formId}-email`}>Email</label>
        <input id={`${formId}-email`} name="email" type="email" autoComplete="username" placeholder="owner@example.com" required disabled={busy}/>
      </div>
      <div className="firebase-connection-field">
        <label htmlFor={`${formId}-password`}>Password</label>
        <input id={`${formId}-password`} name="password" type="password" autoComplete="current-password" placeholder="Your password" required disabled={busy}/>
      </div>
      <button type="submit" className="firebase-connection-button" disabled={busy}>{busy ? 'CONNECTING…' : 'SIGN IN TO FIREBASE'}</button>
    </form>}

    {error && <p className="firebase-connection-error" role="alert">{error}</p>}
    <div className="firebase-connection-status" role="status" aria-live="polite">
      <span>CLOUD LINK</span><strong>{connectionStatus}</strong>
      {message && <p>{message}</p>}
    </div>
    <p className="firebase-connection-note">Sign-in does not activate flight control. Simulation remains labeled separately from aircraft telemetry.</p>
  </section>
}
