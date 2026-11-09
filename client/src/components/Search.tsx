import React, { useEffect, useRef, useState } from 'react';
import { api, ApiError, type SearchHit } from '../api';
import { fmtTime, STATUS_LABEL } from '../format';

interface Props {
  q: string;
  status: string;
  onQuery: (q: string, status: string) => void;
}

const STATUSES = ['SENT', 'FAILED', 'QUEUED', 'PROCESSING', 'PENDING', 'CANCELLED'];

const Search: React.FC<Props> = ({ q, status, onQuery }) => {
  const [text, setText] = useState(q);
  const [state, setState] = useState<{ loading: boolean; error: string | null; total: number; rows: SearchHit[] }>({
    loading: true,
    error: null,
    total: 0,
    rows: [],
  });
  const seq = useRef(0);

  // keep the input in step when the nav search or the URL changes q
  useEffect(() => setText(q), [q]);

  // debounce typing into the shared query
  useEffect(() => {
    if (text === q) return;
    const t = setTimeout(() => onQuery(text.trim(), status), 350);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    api
      .search({ q, status })
      .then((r) => {
        if (id === seq.current) setState({ loading: false, error: null, total: r.total, rows: r.results });
      })
      .catch((e) => {
        if (id === seq.current)
          setState({ loading: false, error: e instanceof ApiError ? e.message : 'Search failed.', total: 0, rows: [] });
      });
  }, [q, status]);

  const filtered = q !== '' || status !== '';

  return (
    <section className="section section--alt" id="search" aria-labelledby="search-title">
      <div className="container">
        <div className="section__head">
          <h2 id="search-title">Search every send.</h2>
          <p className="muted">Fuzzy match across subject, message and recipient.</p>
        </div>

        <form
          className="search-bar"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            onQuery(text.trim(), status);
          }}
        >
          <label className="field">
            <span className="visually-hidden">Search text</span>
            <input className="input" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Try a subject or an address" />
          </label>
          <label className="field">
            <span className="visually-hidden">Status</span>
            <select className="select" value={status} onChange={(e) => onQuery(q, e.target.value)}>
              <option value="">Any status</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
          </label>
          <button className="btn btn--line" type="submit">Search</button>
        </form>

        {state.error ? (
          <div className="error" role="alert">
            <h3>Search is unavailable</h3>
            <p>{state.error}</p>
          </div>
        ) : state.loading && state.rows.length === 0 ? (
          <div className="skel" aria-hidden="true"><i /><i /><i /></div>
        ) : state.rows.length === 0 ? (
          <div className="empty">
            <h3>{filtered ? 'No matches' : 'Nothing indexed yet'}</h3>
            <p>{filtered ? 'Try fewer words or clear the status filter.' : 'Emails appear here once the worker has sent or failed them.'}</p>
            {filtered && <button className="btn btn--line btn--sm" onClick={() => onQuery('', '')}>Clear search</button>}
          </div>
        ) : (
          <>
            <p className="muted small" role="status" style={{ marginBottom: 'var(--space-sm)' }}>
              <span className="num">{state.total}</span> {state.total === 1 ? 'match' : 'matches'}
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Recipient</th>
                    <th>Sender</th>
                    <th>Status</th>
                    <th>Sent</th>
                    <th className="num">Tries</th>
                  </tr>
                </thead>
                <tbody>
                  {state.rows.map((h) => (
                    <tr key={h.id}>
                      <td>
                        <span className="main" title={h.recipient}>{h.recipient}</span>
                        <span className="sub">{h.subject}</span>
                        {h.errorMessage && <span className="sub" style={{ color: 'var(--color-error)' }}>{h.errorMessage}</span>}
                      </td>
                      <td>{h.senderEmail}</td>
                      <td><span className={`st st--${h.status}`}>{STATUS_LABEL[h.status] ?? h.status}</span></td>
                      <td className="num">{fmtTime(h.sentAt ?? h.createdAt)}</td>
                      <td className="num">{h.attempts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  );
};

export default Search;
