import React from 'react';

const Footer: React.FC = () => (
  <footer className="footer">
    <div className="container">
      <h2 className="footer__statement">Crashes recover. Sends never repeat.</h2>
      <div className="footer__row">
        <span>AeroQueue email scheduler</span>
        <nav className="footer__links" aria-label="Footer">
          <a href="https://github.com/gauravshukla490/AeroQueue">Source on GitHub</a>
          <a href="/api/health">API health</a>
          <a href="#top">Back to top</a>
        </nav>
      </div>
    </div>
  </footer>
);

export default Footer;
