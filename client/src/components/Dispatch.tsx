import React, { useEffect, useState } from 'react';
import { api, ApiError, type Sender } from '../api';
import { toIso } from '../format';

interface Props {
  senders: Sender[];
  sendersLoaded: boolean;
  onChanged: () => void;
}

type Mode = 'single' | 'campaign';
type Result = { kind: 'ok'; text: React.ReactNode } | { kind: 'err'; message: string; details: { path: string; message: string }[] } | null;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function errResult(e: unknown): Result {
  if (e instanceof ApiError) return { kind: 'err', message: e.message, details: e.details };
  return { kind: 'err', message: 'Something went wrong.', details: [] };
}

const Dispatch: React.FC<Props> = ({ senders, sendersLoaded, onChanged }) => {
  const [mode, setMode] = useState<Mode>('single');
  const [senderId, setSenderId] = useState('');
  const [recipient, setRecipient] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [at, setAt] = useState('');
  const [idem, setIdem] = useState('');
  const [campName, setCampName] = useState('');
  const [list, setList] = useState('');
  const [spacing, setSpacing] = useState('2');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);

  // sender creation
  const [sEmail, setSEmail] = useState('');
  const [sName, setSName] = useState('');
  const [sQuota, setSQuota] = useState('200');
  const [sDelay, setSDelay] = useState('2000');
  const [sBusy, setSBusy] = useState(false);
  const [sResult, setSResult] = useState<Result>(null);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    if (!senderId && senders.length) setSenderId(senders[0].id);
  }, [senders, senderId]);

  const noSenders = sendersLoaded && senders.length === 0;

  async function addSender(e: React.FormEvent) {
    e.preventDefault();
    setSBusy(true);
    setSResult(null);
    try {
      const res = await api.addSender({
        email: sEmail.trim(),
        name: sName.trim() || undefined,
        hourlyQuota: Number(sQuota) || 200,
        minDelayMs: Number(sDelay) >= 0 ? Number(sDelay) : 2000,
      });
      setSenderId(res.sender.id);
      setSEmail('');
      setSName('');
      setSResult({ kind: 'ok', text: <>Sender <b>{res.sender.email}</b> is ready.</> });
      setAddOpen(false);
      onChanged();
    } catch (err) {
      setSResult(errResult(err));
    } finally {
      setSBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    if (!senderId) {
      setResult({ kind: 'err', message: 'Choose or add a sender first.', details: [] });
      return;
    }
    if (when === 'later' && !toIso(at)) {
      setResult({ kind: 'err', message: 'Pick a date and time, or send now.', details: [] });
      return;
    }
    const scheduledAt = when === 'later' ? toIso(at) : undefined;
    setBusy(true);
    try {
      if (mode === 'single') {
        if (!EMAIL.test(recipient.trim())) {
          setResult({ kind: 'err', message: 'Enter a valid recipient address.', details: [] });
          return;
        }
        const res = await api.schedule({
          senderId,
          recipient: recipient.trim(),
          subject: subject.trim(),
          body,
          scheduledAt,
          idempotencyKey: idem.trim() || undefined,
        });
        setResult({
          kind: 'ok',
          text: res.isDuplicate ? (
            <>This key was already used. Existing job <b>{res.emailJobId.slice(0, 8)}</b> is {res.status.toLowerCase()}.</>
          ) : (
            <>Scheduled. Job <b>{res.emailJobId.slice(0, 8)}</b> is {res.status.toLowerCase()}.</>
          ),
        });
        if (!res.isDuplicate) {
          setRecipient('');
          setSubject('');
          setBody('');
          setIdem('');
        }
      } else {
        const rows = list
          .split(/[\n,;]+/)
          .map((r) => r.trim())
          .filter(Boolean);
        const bad = rows.find((r) => !EMAIL.test(r));
        if (!rows.length || bad) {
          setResult({ kind: 'err', message: bad ? `"${bad}" is not a valid address.` : 'Add at least one recipient.', details: [] });
          return;
        }
        const res = await api.campaign({
          name: campName.trim(),
          senderId,
          recipients: rows.map((r) => ({ recipient: r, subject: subject.trim(), body })),
          startAt: scheduledAt,
          spacingSeconds: Math.max(1, Math.round(Number(spacing)) || 2),
        });
        setResult({ kind: 'ok', text: <>Campaign <b>{res.campaign.name}</b> scheduled {res.totalScheduled} emails.</> });
        setList('');
        setSubject('');
        setBody('');
        setCampName('');
      }
      onChanged();
    } catch (err) {
      setResult(errResult(err));
    } finally {
      setBusy(false);
    }
  }

  const showAdd = addOpen || noSenders;

  return (
    <section className="section section--alt" id="dispatch" aria-labelledby="dispatch-title">
      <div className="container split">
        <div className="split__lead">
          <h2 id="dispatch-title">Schedule a send.</h2>
          <p className="lead">Pick a sender and a time. The worker paces it against the sender's hourly limit.</p>
        </div>

        <div className="form ticks">
          <div className="seg" role="group" aria-label="What to schedule" style={{ justifySelf: 'start' }}>
            <button type="button" aria-pressed={mode === 'single'} onClick={() => { setMode('single'); setResult(null); }}>
              One email
            </button>
            <button type="button" aria-pressed={mode === 'campaign'} onClick={() => { setMode('campaign'); setResult(null); }}>
              Campaign
            </button>
          </div>

          {!sendersLoaded ? (
            <div className="skel" aria-hidden="true"><i /><i /></div>
          ) : (
            <>
              {senders.length > 0 && (
                <label className="field">
                  <span>Sender</span>
                  <select className="select" value={senderId} onChange={(e) => setSenderId(e.target.value)}>
                    {senders.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name ? `${s.name} <${s.email}>` : s.email}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <details className="disclosure" open={showAdd} onToggle={(e) => setAddOpen((e.target as HTMLDetailsElement).open)}>
                <summary>{noSenders ? 'Add your first sender' : 'Add or update a sender'}</summary>
                <form className="disclosure__body" onSubmit={addSender}>
                  <div className="form__row">
                    <label className="field">
                      <span>Email address</span>
                      <input className="input" type="email" required value={sEmail} onChange={(e) => setSEmail(e.target.value)} placeholder="you@yourdomain.com" />
                    </label>
                    <label className="field">
                      <span>Display name</span>
                      <input className="input" value={sName} onChange={(e) => setSName(e.target.value)} placeholder="Optional" />
                    </label>
                  </div>
                  <div className="form__row">
                    <label className="field">
                      <span>Emails per hour</span>
                      <input className="input" type="number" min={1} value={sQuota} onChange={(e) => setSQuota(e.target.value)} />
                    </label>
                    <label className="field">
                      <span>Minimum gap, ms</span>
                      <input className="input" type="number" min={0} value={sDelay} onChange={(e) => setSDelay(e.target.value)} />
                    </label>
                  </div>
                  <div className="form__foot">
                    <button className="btn btn--line btn--sm" type="submit" disabled={sBusy} aria-busy={sBusy}>
                      {sBusy ? 'Saving' : 'Save sender'}
                    </button>
                  </div>
                  {sResult?.kind === 'err' && (
                    <div className="msg msg--err" role="alert">
                      {sResult.message}
                      {sResult.details.length > 0 && <ul>{sResult.details.map((d, i) => <li key={i}>{d.path}: {d.message}</li>)}</ul>}
                    </div>
                  )}
                </form>
              </details>
              {sResult?.kind === 'ok' && <div className="msg msg--ok" role="status">{sResult.text}</div>}
            </>
          )}

          <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--space-lg)' }} noValidate>
            {mode === 'single' ? (
              <label className="field">
                <span>Recipient</span>
                <input className="input" type="email" required value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="name@example.com" />
              </label>
            ) : (
              <>
                <label className="field">
                  <span>Campaign name</span>
                  <input className="input" required value={campName} onChange={(e) => setCampName(e.target.value)} placeholder="Autumn launch" />
                </label>
                <label className="field">
                  <span>Recipients</span>
                  <textarea className="textarea" required value={list} onChange={(e) => setList(e.target.value)} placeholder={'One address per line'} />
                </label>
                <label className="field">
                  <span>Seconds between sends</span>
                  <input className="input" type="number" min={1} value={spacing} onChange={(e) => setSpacing(e.target.value)} />
                </label>
              </>
            )}

            <label className="field">
              <span>Subject</span>
              <input className="input" required value={subject} onChange={(e) => setSubject(e.target.value)} />
            </label>
            <label className="field">
              <span>Message</span>
              <textarea className="textarea" required value={body} onChange={(e) => setBody(e.target.value)} />
              <small>HTML is sent as written.</small>
            </label>

            <fieldset style={{ display: 'grid', gap: 'var(--space-xs)', border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              <legend className="visually-hidden">When to send</legend>
              <div className="radios">
                <label>
                  <input type="radio" name="when" checked={when === 'now'} onChange={() => setWhen('now')} />
                  Send now
                </label>
                <label>
                  <input type="radio" name="when" checked={when === 'later'} onChange={() => setWhen('later')} />
                  Send later
                </label>
              </div>
              {when === 'later' && (
                <label className="field">
                  <span>Date and time</span>
                  <input className="input" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
                </label>
              )}
            </fieldset>

            {mode === 'single' && (
              <details className="disclosure">
                <summary>Advanced</summary>
                <div className="disclosure__body">
                  <label className="field">
                    <span>Idempotency key</span>
                    <input className="input" value={idem} onChange={(e) => setIdem(e.target.value)} placeholder="Optional" />
                    <small>Re-submitting the same key never sends twice.</small>
                  </label>
                </div>
              </details>
            )}

            <div className="form__foot">
              <button className="btn" type="submit" disabled={busy || noSenders} aria-busy={busy}>
                {busy ? 'Scheduling' : mode === 'single' ? 'Schedule email' : 'Schedule campaign'}
              </button>
              {noSenders && <span className="muted small">Add a sender first.</span>}
            </div>

            {result?.kind === 'ok' && <div className="msg msg--ok" role="status">{result.text}</div>}
            {result?.kind === 'err' && (
              <div className="msg msg--err" role="alert">
                {result.message}
                {result.details.length > 0 && <ul>{result.details.map((d, i) => <li key={i}>{d.path}: {d.message}</li>)}</ul>}
              </div>
            )}
          </form>
        </div>
      </div>
    </section>
  );
};

export default Dispatch;
