import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type Health, type Overview, type Sender } from './api';
import Nav from './components/Nav';
import Hero from './components/Hero';
import Console from './components/Console';
import Dispatch from './components/Dispatch';
import Ledger from './components/Ledger';
import Search from './components/Search';
import Footer from './components/Footer';

const POLL_MS = 5000;

function readParams() {
  const p = new URLSearchParams(window.location.search);
  return { q: p.get('q') ?? '', status: p.get('status') ?? '' };
}

const App: React.FC = () => {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [sendersLoaded, setSendersLoaded] = useState(false);
  const [{ q, status }, setSearch] = useState(readParams);

  const loadOverview = useCallback(async () => {
    try {
      const data = await api.overview();
      setOverview(data);
      setOverviewError(null);
    } catch (e) {
      setOverviewError(e instanceof ApiError ? e.message : 'Could not load the queue.');
    }
  }, []);

  const loadSenders = useCallback(async () => {
    try {
      const res = await api.senders();
      setSenders(res.senders);
    } catch {
      /* the form shows its own empty state */
    } finally {
      setSendersLoaded(true);
    }
  }, []);

  const loadHealth = useCallback(async () => {
    try {
      setHealth(await api.health());
      setHealthError(false);
    } catch {
      setHealthError(true);
    }
  }, []);

  const refresh = useCallback(() => {
    loadOverview();
    loadSenders();
  }, [loadOverview, loadSenders]);

  // poll while the tab is visible
  useEffect(() => {
    loadOverview();
    loadSenders();
    loadHealth();
    const tick = () => {
      if (document.visibilityState === 'visible') loadOverview();
    };
    const a = setInterval(tick, POLL_MS);
    const b = setInterval(() => document.visibilityState === 'visible' && loadHealth(), 30000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(a);
      clearInterval(b);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [loadOverview, loadSenders, loadHealth]);

  // search state lives in the URL
  const onQuery = useCallback((nq: string, ns: string) => {
    const p = new URLSearchParams();
    if (nq) p.set('q', nq);
    if (ns) p.set('status', ns);
    const qs = p.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`);
    setSearch({ q: nq, status: ns });
  }, []);

  const fromNav = useCallback(
    (nq: string) => {
      onQuery(nq, status);
      document.getElementById('search')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    },
    [onQuery, status]
  );

  const latestSent = overview?.recentJobs.find((j) => j.status === 'SENT') ?? null;

  return (
    <>
      <a className="skip" href="#console">Skip to the console</a>
      <Nav health={health} healthError={healthError} onSearch={fromNav} />
      <main>
        <Hero sent={overview?.stats.totalSent ?? 0} latest={latestSent} />
        <Console data={overview} error={overviewError} onRetry={loadOverview} />
        <Dispatch senders={senders} sendersLoaded={sendersLoaded} onChanged={refresh} />
        <Ledger jobs={overview?.recentJobs ?? null} error={overviewError} onChanged={refresh} />
        <Search q={q} status={status} onQuery={onQuery} />
      </main>
      <Footer />
    </>
  );
};

export default App;
