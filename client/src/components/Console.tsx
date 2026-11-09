import React from 'react';
import type { Overview } from '../api';

interface Props {
  data: Overview | null;
  error: string | null;
  onRetry: () => void;
}

const Skeleton: React.FC = () => (
  <div className="skel" aria-hidden="true">
    <i />
    <i />
    <i />
  </div>
);

const Console: React.FC<Props> = ({ data, error, onRetry }) => {
  const s = data?.stats;
  const dispatched = s ? s.totalSent + s.totalFailed : 0;
  const q = data?.queueCounts ?? {};

  return (
    <section className="section" id="console" aria-labelledby="console-title">
      <div className="container">
        <div className="section__head">
          <h2 id="console-title">The queue, right now.</h2>
          <p className="muted">Live from your workers. Refreshes every few seconds.</p>
        </div>

        {error && !data ? (
          <div className="error" role="alert">
            <h3>Could not load the queue</h3>
            <p>{error}</p>
            <button className="btn btn--line btn--sm" onClick={onRetry}>
              Try again
            </button>
          </div>
        ) : (
          <div className="bento">
            <article className="cell ticks cell--rate" aria-label="Delivery rate">
              <h3>Delivery rate</h3>
              {!data ? (
                <Skeleton />
              ) : dispatched === 0 ? (
                <div>
                  <p className="big" aria-label="No data yet">
                    -
                  </p>
                  <p className="muted small">Nothing has been dispatched yet.</p>
                </div>
              ) : (
                <div>
                  <p className="big">
                    {s!.successRate}
                    <span className="u">%</span>
                  </p>
                  <p className="muted small">
                    {s!.totalSent} of {dispatched} dispatched emails delivered.
                  </p>
                </div>
              )}
            </article>

            <article className="cell ticks cell--status" aria-label="Email status">
              <h3>Emails by status</h3>
              {!data ? (
                <Skeleton />
              ) : (
                <ul className="ruled">
                  <li>
                    <span>Pending</span>
                    <span className="num">{s!.totalPending}</span>
                  </li>
                  <li>
                    <span>Queued</span>
                    <span className="num">{s!.totalQueued}</span>
                  </li>
                  <li>
                    <span>Processing</span>
                    <span className="num">{s!.totalProcessing}</span>
                  </li>
                  <li>
                    <span>Sent</span>
                    <span className="num found">{s!.totalSent}</span>
                  </li>
                  <li>
                    <span>Failed</span>
                    <span className="num">{s!.totalFailed}</span>
                  </li>
                </ul>
              )}
            </article>

            <article className="cell ticks cell--queue" aria-label="Worker queue">
              <h3>Worker queue</h3>
              {!data ? (
                <Skeleton />
              ) : (
                <ul className="ruled">
                  <li>
                    <span>Waiting</span>
                    <span className="num">{q.waiting ?? 0}</span>
                  </li>
                  <li>
                    <span>Active</span>
                    <span className="num">{q.active ?? 0}</span>
                  </li>
                  <li>
                    <span>Delayed</span>
                    <span className="num">{q.delayed ?? 0}</span>
                  </li>
                  <li>
                    <span>Completed</span>
                    <span className="num">{q.completed ?? 0}</span>
                  </li>
                  <li>
                    <span>Failed</span>
                    <span className="num">{q.failed ?? 0}</span>
                  </li>
                </ul>
              )}
            </article>

            <article className="cell ticks cell--quota" aria-label="Sender quotas">
              <h3>Sender quotas, last hour</h3>
              {!data ? (
                <Skeleton />
              ) : data.senderQuotas.length === 0 ? (
                <div className="empty">
                  <h3>No senders yet</h3>
                  <p>A sender is the address mail goes out from. Add one to start scheduling.</p>
                  <a className="btn btn--sm" href="#dispatch">
                    Add a sender
                  </a>
                </div>
              ) : (
                <div className="quotas">
                  {data.senderQuotas.map((sq) => (
                    <div className="quota" key={sq.id}>
                      <div className="quota__top">
                        <span>{sq.email}</span>
                        <span className="num">
                          {sq.usedInWindow}
                          <span className="u"> / {sq.hourlyQuota}</span>
                        </span>
                      </div>
                      <div
                        className="meter"
                        role="meter"
                        aria-valuemin={0}
                        aria-valuemax={sq.hourlyQuota}
                        aria-valuenow={sq.usedInWindow}
                        aria-label={`${sq.email} hourly quota used`}
                      >
                        <i style={{ transform: `scaleX(${Math.max(sq.percentUsed, sq.usedInWindow > 0 ? 1 : 0) / 100})` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </article>
          </div>
        )}
      </div>
    </section>
  );
};

export default Console;
