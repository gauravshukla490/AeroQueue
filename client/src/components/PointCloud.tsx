import React, { useEffect, useRef } from 'react';

/**
 * Vantage point cloud: a generated terrain of points (no lines, no glow),
 * sized by depth and coloured by height. A sweep plane lifts the points it
 * touches. Lime points are "found": one per delivered email, up to MAX_FOUND.
 */

const MAX_FOUND = 160;
const POINTS = 9000;
const BUCKETS = 14;
const REV_SECONDS = 120;
const SWEEP_SECONDS = 7;

interface Props {
  found: number;
  latest: { recipient: string; when: string } | null;
}

// Small deterministic PRNG so the terrain is the same on every load.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function height(x: number, z: number) {
  const ridge = Math.sin(x * 2.2 + 1.1) * Math.cos(z * 1.8 - 0.4) * 0.34;
  const rolling = Math.sin(x * 4.6 + z * 3.3) * 0.12 + Math.cos(z * 5.1 - x * 1.7) * 0.08;
  const bowl = -0.22 * (x * x + z * z);
  return ridge + rolling + bowl;
}

interface Cloud {
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  bucket: Uint8Array;
  order: number[][];
  found: { x: number; y: number; z: number }[];
}

function buildCloud(): Cloud {
  const r = rng(7);
  const pts: { x: number; y: number; z: number }[] = [];
  const foundPool: { x: number; y: number; z: number }[] = [];

  // ground and canopy
  while (pts.length < POINTS * 0.82) {
    const x = r() * 2 - 1;
    const z = r() * 2 - 1;
    if (x * x + z * z > 1.05) continue;
    pts.push({ x, y: height(x, z) + (r() - 0.5) * 0.02, z });
  }
  // structures: a few blocks scanned on their faces and roofs
  const blocks = [
    { cx: -0.35, cz: 0.1, w: 0.2, d: 0.14, h: 0.2 },
    { cx: 0.28, cz: -0.28, w: 0.16, d: 0.22, h: 0.28 },
    { cx: 0.1, cz: 0.42, w: 0.24, d: 0.1, h: 0.14 },
  ];
  for (const b of blocks) {
    const base = height(b.cx, b.cz);
    const n = Math.floor((POINTS * 0.18) / blocks.length);
    for (let i = 0; i < n; i++) {
      const face = r();
      let x = b.cx + (r() - 0.5) * b.w;
      let z = b.cz + (r() - 0.5) * b.d;
      let y = base + b.h;
      if (face < 0.55) {
        // walls
        if (r() < 0.5) x = b.cx + (r() < 0.5 ? -b.w / 2 : b.w / 2);
        else z = b.cz + (r() < 0.5 ? -b.d / 2 : b.d / 2);
        y = base + r() * b.h;
      }
      pts.push({ x, y, z });
    }
    for (let i = 0; i < 40; i++) {
      foundPool.push({
        x: b.cx + (r() - 0.5) * b.w,
        y: base + b.h + 0.004,
        z: b.cz + (r() - 0.5) * b.d,
      });
    }
  }
  // more found positions on open ground
  while (foundPool.length < MAX_FOUND + 20) {
    const x = r() * 1.7 - 0.85;
    const z = r() * 1.7 - 0.85;
    if (x * x + z * z > 0.8) continue;
    foundPool.push({ x, y: height(x, z) + 0.004, z });
  }
  // shuffle found pool deterministically
  for (let i = foundPool.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [foundPool[i], foundPool[j]] = [foundPool[j], foundPool[i]];
  }

  // centre-out order: the first found points are always inside the frame
  foundPool.sort((a, b) => a.x * a.x + a.z * a.z - (b.x * b.x + b.z * b.z));

  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const x = new Float32Array(pts.length);
  const y = new Float32Array(pts.length);
  const z = new Float32Array(pts.length);
  const bucket = new Uint8Array(pts.length);
  const order: number[][] = Array.from({ length: BUCKETS }, () => []);
  pts.forEach((p, i) => {
    x[i] = p.x;
    y[i] = p.y;
    z[i] = p.z;
    const t = (p.y - minY) / (maxY - minY);
    const b = Math.min(BUCKETS - 1, Math.floor(Math.pow(t, 0.85) * (BUCKETS - 1)));
    bucket[i] = b;
    order[b].push(i);
  });
  return { x, y, z, bucket, order, found: foundPool.slice(0, MAX_FOUND) };
}

// Resolve a CSS colour expression (tokens included) to a string canvas accepts.
function resolveColor(expr: string): string {
  const el = document.createElement('span');
  el.style.color = expr;
  el.style.display = 'none';
  document.body.appendChild(el);
  const out = getComputedStyle(el).color;
  el.remove();
  return out;
}

const PointCloud: React.FC<Props> = ({ found, latest }) => {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const callout = useRef<HTMLDivElement>(null);
  const foundRef = useRef(found);
  foundRef.current = found;

  useEffect(() => {
    const cv = canvas.current;
    const host = wrap.current;
    if (!cv || !host) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    const cloud = buildCloud();
    const palette: string[] = [];
    for (let i = 0; i < BUCKETS; i++) {
      const hi = Math.round((i / (BUCKETS - 1)) * 100);
      // low points are the steel ground, high points the pale ink
      palette.push(
        hi < 55
          ? resolveColor(`color-mix(in oklab, var(--point-mid) ${Math.round((hi / 55) * 100)}%, var(--point-lo))`)
          : resolveColor(`color-mix(in oklab, var(--point-hi) ${Math.round(((hi - 55) / 45) * 100)}%, var(--point-mid))`)
      );
    }
    const hiColor = resolveColor('var(--point-hi)');
    const limeColor = resolveColor('var(--color-accent)');

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let visible = true;
    let raf = 0;
    let tiltX = 0;
    let tiltY = 0;
    let targetX = 0;
    let targetY = 0;
    const start = performance.now();

    const resize = () => {
      const r = host.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = Math.max(1, r.width);
      h = Math.max(1, r.height);
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;
      if (reduce) draw(start + 38000);
    };

    const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

    function draw(now: number) {
      const t = (now - start) / 1000;
      const angle = (t / REV_SECONDS) * Math.PI * 2 + 0.6;
      const ca = Math.cos(angle);
      const sa = Math.sin(angle);
      const tilt = -0.62 + tiltY;
      const ct = Math.cos(tilt);
      const st = Math.sin(tilt);
      const yaw = tiltX;
      const cy2 = Math.cos(yaw);
      const sy2 = Math.sin(yaw);

      const wide = w > 760;
      const cx = wide ? w * 0.64 : w * 0.5;
      const cyc = wide ? h * 0.56 : h * 0.62;
      const scale = (wide ? Math.min(w * 0.36, h * 0.82) : Math.min(w * 0.46, h * 0.42)) * 1.0;
      const f = 3.1;

      const phase = reduce ? 0.5 : (t % SWEEP_SECONDS) / SWEEP_SECONDS;
      const sweep = ease(phase) * 3.0 - 1.5;

      ctx!.setTransform(1, 0, 0, 1, 0, 0);
      ctx!.clearRect(0, 0, cv!.width, cv!.height);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

      const boosted: number[] = [];
      const sx = new Float32Array(cloud.x.length);
      const sy = new Float32Array(cloud.x.length);
      const ss = new Float32Array(cloud.x.length);
      const flag = new Uint8Array(cloud.x.length);

      for (let i = 0; i < cloud.x.length; i++) {
        // rotate about the vertical axis, then yaw nudge, then tilt
        const x0 = cloud.x[i] * ca - cloud.z[i] * sa;
        const z0 = cloud.x[i] * sa + cloud.z[i] * ca;
        const x1 = x0 * cy2 - z0 * sy2;
        const z1 = x0 * sy2 + z0 * cy2;
        const y1 = cloud.y[i] * ct - z1 * st;
        const z2 = cloud.y[i] * st + z1 * ct;
        const k = f / (f + z2);
        sx[i] = cx + x1 * scale * k * 1.9;
        sy[i] = cyc - y1 * scale * k * 1.9;
        ss[i] = k;
        if (Math.abs(x1 - sweep) < 0.07) {
          flag[i] = 1;
          boosted.push(i);
        }
      }

      for (let b = 0; b < BUCKETS; b++) {
        ctx!.fillStyle = palette[b];
        const idx = cloud.order[b];
        for (let n = 0; n < idx.length; n++) {
          const i = idx[n];
          if (flag[i]) continue;
          const s = 0.9 + ss[i] * 1.15;
          ctx!.fillRect(sx[i], sy[i], s, s);
        }
      }
      ctx!.fillStyle = hiColor;
      for (const i of boosted) {
        const s = 1.2 + ss[i] * 1.5;
        ctx!.fillRect(sx[i], sy[i], s, s);
      }

      // found points: one per delivered email
      const count = Math.min(foundRef.current, MAX_FOUND);
      ctx!.fillStyle = limeColor;
      let first: { x: number; y: number } | null = null;
      for (let n = 0; n < count; n++) {
        const p = cloud.found[n];
        const x0 = p.x * ca - p.z * sa;
        const z0 = p.x * sa + p.z * ca;
        const x1 = x0 * cy2 - z0 * sy2;
        const z1 = x0 * sy2 + z0 * cy2;
        const y1 = p.y * ct - z1 * st;
        const z2 = p.y * st + z1 * ct;
        const k = f / (f + z2);
        const px = cx + x1 * scale * k * 1.9;
        const py = cyc - y1 * scale * k * 1.9;
        ctx!.beginPath();
        ctx!.arc(px, py, 3 + k * 2, 0, Math.PI * 2);
        ctx!.fill();
        if (n === 0) first = { x: px, y: py };
      }

      const c = callout.current;
      if (c) {
        if (first && count > 0) {
          c.style.opacity = '1';
          c.style.transform = `translate3d(${first.x.toFixed(1)}px, ${first.y.toFixed(1)}px, 0)`;
        } else {
          c.style.opacity = '0';
        }
      }
    }

    const loop = (now: number) => {
      tiltX += (targetX - tiltX) * 0.04;
      tiltY += (targetY - tiltY) * 0.04;
      if (visible) draw(now);
      raf = requestAnimationFrame(loop);
    };

    const onMove = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      targetX = ((e.clientX - r.left) / r.width - 0.5) * 0.12;
      targetY = ((e.clientY - r.top) / r.height - 0.5) * -0.08;
    };

    const ro = new ResizeObserver(resize);
    ro.observe(host);
    const io = new IntersectionObserver((e) => {
      visible = e[0]?.isIntersecting ?? true;
    });
    io.observe(host);
    resize();

    const redraw = () => {
      if (reduce) draw(start + 38000);
    };
    window.addEventListener('aq-redraw', redraw);

    if (reduce) {
      // one still frame, sweep stopped mid-scene
      draw(start + 38000);
    } else {
      window.addEventListener('pointermove', onMove);
      raf = requestAnimationFrame(loop);
    }
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('aq-redraw', redraw);
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  // Redraw the still frame when the count changes under reduced motion.
  useEffect(() => {
    window.dispatchEvent(new Event('aq-redraw'));
  }, [found]);

  return (
    <div className="cloud" ref={wrap} aria-hidden="true">
      <canvas ref={canvas} />
      <div className="callout" ref={callout} style={{ opacity: 0 }}>
        <span className="callout__dot" />
        <span className="callout__leader" />
        {latest && (
          <span className="callout__label">
            <span className="callout__name">{latest.recipient}</span>
            <span className="callout__meta">Delivered {latest.when}</span>
          </span>
        )}
      </div>
    </div>
  );
};

export default PointCloud;
