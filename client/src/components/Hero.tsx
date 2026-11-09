import React from 'react';
import PointCloud from './PointCloud';
import type { Job } from '../api';
import { rel } from '../format';

interface Props {
  sent: number;
  latest: Job | null;
}

const Hero: React.FC<Props> = ({ sent, latest }) => (
  <section className="hero" id="top" aria-labelledby="hero-title">
    <PointCloud
      found={sent}
      latest={latest ? { recipient: latest.recipient, when: rel(latest.sentAt ?? latest.scheduledAt) } : null}
    />
    <div className="container">
      <div className="hero__head">
        <h1 id="hero-title">Every email, sent on time.</h1>
        <p className="lead">Schedule once. AeroQueue paces, retries and records each send.</p>
        <div className="hero__actions">
          <a className="btn" href="#dispatch">
            Schedule an email
          </a>
          <a className="btn btn--line" href="#ledger">
            Read the ledger
          </a>
        </div>
      </div>
    </div>
    <p className="hero__note">Each lime point is an email delivered from your queue.</p>
  </section>
);

export default Hero;
