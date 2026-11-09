import React, { useState } from 'react';
import type { Health } from '../api';

interface Props {
  health: Health | null;
  healthError: boolean;
  onSearch: (q: string) => void;
}

const Nav: React.FC<Props> = ({ health, healthError, onSearch }) => {
  const [q, setQ] = useState('');
  const ok = !!health && health.status === 'healthy';
  const label = healthError
    ? 'API unreachable'
    : !health
      ? 'Checking services'
      : ok
        ? 'All services up'
        : 'Services degraded';

  return (
    <header className="nav">
      <div className="container nav__row">
        <a className="brand" href="#top" aria-label="AeroQueue home">
          AeroQueue
        </a>
        <form
          className="nav__search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            onSearch(q.trim());
          }}
        >
          <label className="visually-hidden" htmlFor="nav-q">
            Search sent email
          </label>
          <input
            id="nav-q"
            className="input"
            type="search"
            placeholder="Search subject, body or recipient"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </form>
        <span className="nav__status" data-ok={healthError ? 'false' : ok ? 'true' : undefined} role="status">
          {label}
        </span>
      </div>
    </header>
  );
};

export default Nav;
