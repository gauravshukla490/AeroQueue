import React, { useState } from 'react';
import { api, ApiError, type Job } from '../api';
import { fmtTime, STATUS_LABEL } from '../format';

interface Props {
  jobs: Job[] | null;
  error: string | null;
  onChanged: () => void;
}

const Ledger: React.FC<Props> = ({ jobs, error, onChanged }) => {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function cancel(id: string) {
    setBusyId(id);
    setActionError(null);
    try {
      await api.cancel(id);
      setConfirming(null);
      onChanged();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Could not cancel that email.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="section" id="ledger" aria-labelledby="ledger-title">
      <div className="container">
        <div className="section__head">
          <h2 id="ledger-title">Recent sends.</h2>
          <p className="muted">The latest twelve emails, newest first.</p>
        </div>

        {actionError && <div className="msg msg--err" role="alert" style={{ marginBottom: 'var(--space-md)' }}>{actionError}</div>}

        {error && !jobs ? (
          <div className="error" role="alert">
            <h3>Could not load recent sends</h3>
            <p>{error}</p>
          </div>
        ) : !jobs ? (
          <div className="skel" aria-hidden="true"><i /><i /><i /></div>
        ) : jobs.length === 0 ? (
          <div className="empty">
            <h3>No emails yet</h3>
            <p>Scheduled emails appear here as soon as they are queued.</p>
            <a className="btn btn--sm" href="#dispatch">Schedule the first one</a>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Recipient</th>
                  <th>Status</th>
                  <th>Scheduled</th>
                  <th>Sent</th>
                  <th className="num">Tries</th>
                  <th><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => {
                  const cancellable = j.status !== 'SENT' && j.status !== 'CANCELLED';
                  return (
                    <tr key={j.id}>
                      <td>
                        <span className="main" title={j.recipient}>{j.recipient}</span>
                        <span className="sub">{j.subject}</span>
                        {j.status === 'FAILED' && j.lastError && <span className="sub" style={{ color: 'var(--color-error)' }}>{j.lastError}</span>}
                      </td>
                      <td><span className={`st st--${j.status}`}>{STATUS_LABEL[j.status] ?? j.status}</span></td>
                      <td className="num">{fmtTime(j.scheduledAt)}</td>
                      <td className="num">{fmtTime(j.sentAt)}</td>
                      <td className="num">{j.attempts}<span className="u"> / {j.maxAttempts}</span></td>
                      <td>
                        {cancellable &&
                          (confirming === j.id ? (
                            <span className="actions">
                              <button className="link-btn link-btn--danger" disabled={busyId === j.id} onClick={() => cancel(j.id)}>
                                {busyId === j.id ? 'Cancelling' : 'Confirm cancel'}
                              </button>
                              <button className="link-btn" onClick={() => setConfirming(null)}>Keep</button>
                            </span>
                          ) : (
                            <button className="link-btn" onClick={() => setConfirming(j.id)}>Cancel</button>
                          ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
};

export default Ledger;
