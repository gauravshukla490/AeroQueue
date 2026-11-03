import './index.css';
import React, { useEffect, useState } from 'react';
import Header from './components/Header';
import ThemeToggle from './components/ThemeToggle';
import MetricsSection from './components/MetricsSection';
import DispatchForm from './components/DispatchForm';
import ActivityFeed from './components/ActivityFeed';
import SearchPanel from './components/SearchPanel';

interface Metrics {
  totalJobs: number;
  pending: number;
  queued: number;
  processing: number;
  sent: number;
  failed: number;
}

const App: React.FC = () => {
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  const fetchMetrics = async () => {
    try {
      const res = await fetch('/api/metrics/overview');
      const data = await res.json();
      setMetrics(data);
    } catch (e) {
      console.error('Failed to load metrics', e);
    }
  };

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 10000); // refresh every 10s
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-surface-light dark:bg-surface-dark text-text-light dark:text-text-dark transition-colors">
      <Header />
      <div className="container mx-auto p-4">
        <div className="flex justify-end mb-4">
          <ThemeToggle />
        </div>
        <MetricsSection metrics={metrics} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
          <DispatchForm />
          <SearchPanel />
        </div>
        <ActivityFeed />
      </div>
    </div>
  );
};

export default App;
