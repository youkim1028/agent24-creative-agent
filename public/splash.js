// Start splash — a diffusion "knowledge universe" that the workspace opens from.
// Concept words bloom out of noise, hold, fade, and are reborn elsewhere; nearby
// words are linked by flickering constellation lines, and neon clusters orbit as
// small galaxies. Every motion is a pure function of absolute time, so a single
// frozen frame (reduced motion, throttled tab) still reads as a finished picture.

const splash = document.querySelector("#splash");
const canvas = document.querySelector("#splash-canvas");
const startButton = document.querySelector("#splash-start");

const skipSplash = new URLSearchParams(location.search).get("nosplash") === "1";

if (splash && canvas && startButton && !skipSplash) {
  runSplash();
} else if (splash) {
  splash.remove();
}

function runSplash() {
  const ctx = canvas.getContext("2d");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const WORDS = [
    "evidence", "signal", "narrative", "thesis", "deck", "slide",
    "community", "sentiment", "conflict", "citation", "grounding",
    "insight", "context", "audience", "argument", "counterpoint",
    "verbatim", "youtube", "x post", "search", "recency", "reach",
    "structure", "hierarchy", "typography", "layout", "whitespace",
    "critique", "revision", "contract", "schema", "validate", "render",
    "pattern", "outlier", "consensus", "nuance", "decision", "priority",
    "diffusion", "denoise", "latent", "embedding", "attention", "prompt",
    "agent", "planner", "analyst", "architect", "composer", "critic",
  ];

  // One neon per cluster — the brand teal plus a small cyberpunk spread.
  const NEON = [
    "86,220,196",  // teal (brand accent)
    "142,134,236", // violet
    "226,168,86",  // amber
    "232,120,168", // magenta
    "140,214,130", // lime
  ];

  const STAR_LINK_DIST = 158;
  const MEMBER_LINK_RATIO = 0.85;

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // Flicker factor for a link — fixed seed per pair, so each line has its own
  // period, and sinks to a full blackout when the phase bottoms out.
  function blink(now, seed) {
    const speed = 480 + (seed % 7) * 160;
    const s = 0.5 + 0.5 * Math.sin(now / speed + seed * 1.7);
    if (s < 0.1) return 0;
    return 0.35 + 0.65 * s;
  }

  const dpr = Math.min(devicePixelRatio || 1, 1.5);
  let W = 0;
  let H = 0;
  let stars = [];
  let planets = [];
  let dots = [];
  let raf = 0;

  function makeStar(now) {
    const denoiseMs = 1600 + rand(0, 2200);
    const holdMs = 4000 + rand(0, 6000);
    const fadeMs = 1400 + rand(0, 2600);
    const bright = Math.random() < 0.16;
    return {
      x: rand(0.03, 0.97) * W,
      y: rand(0.03, 0.97) * H,
      word: pick(WORDS),
      size: bright ? rand(15, 20) : rand(9, 14),
      born: now - rand(0, denoiseMs + holdMs + fadeMs),
      denoiseMs,
      holdMs,
      fadeMs,
      peak: bright ? rand(0.5, 0.68) : rand(0.24, 0.44),
      twPhase: rand(0, Math.PI * 2),
      twSpeed: rand(700, 1400),
      alpha: 0,
      blur: 0,
    };
  }

  function makeMember(r, now, initial) {
    const denoiseMs = 1400 + rand(0, 1800);
    const holdMs = 6000 + rand(0, 8000);
    const fadeMs = 1200 + rand(0, 2000);
    return {
      word: pick(WORDS),
      size: rand(9, 14),
      baseAngle: rand(0, Math.PI * 2),
      // Denser toward the core — the power curve biases members inward.
      dist: r * (0.18 + 0.82 * Math.pow(Math.random(), 0.6)),
      born: now - (initial ? rand(0, denoiseMs + holdMs + fadeMs) : 0),
      denoiseMs,
      holdMs,
      fadeMs,
      peak: rand(0.5, 0.8),
      alpha: 0,
      blur: 0,
      x: 0,
      y: 0,
    };
  }

  function makePlanet(cx, cy, r, color, now) {
    const memberCount = Math.max(6, Math.round(r / 11));
    return {
      cx,
      cy,
      r,
      color,
      tilt: rand(-0.6, 0.6),
      flat: rand(0.42, 0.62),
      spin: rand(0.00004, 0.0001) * (Math.random() < 0.5 ? -1 : 1),
      wanderPhase: rand(0, Math.PI * 2),
      members: Array.from({ length: memberCount }, () => makeMember(r, now, true)),
      x: cx,
      y: cy,
    };
  }

  // Rejection sampling is enough here: clusters must miss each other and leave
  // the middle of the screen clear for the title.
  function placePlanets(now) {
    const count = Math.max(3, Math.min(7, Math.round((W * H) / 240000)));
    const placed = [];
    // The title block is wide and short, so the keep-out zone is an ellipse
    // rather than a circle — otherwise clusters crowd the wordmark's flanks.
    const clearX = Math.min(W * 0.38, 460);
    const clearY = Math.min(H * 0.3, 220);
    for (let i = 0; i < count; i++) {
      const r = rand(70, 148) * Math.min(1, W / 1100);
      let x = 0;
      let y = 0;
      let ok = false;
      for (let tries = 0; tries < 30 && !ok; tries++) {
        x = rand(0.1, 0.9) * W;
        y = rand(0.12, 0.88) * H;
        const nx = (x - W / 2) / (clearX + r * 0.6);
        const ny = (y - H / 2) / (clearY + r * 0.6);
        ok =
          Math.hypot(nx, ny) > 1 &&
          placed.every((p) => Math.hypot(x - p.cx, y - p.cy) > (r + p.r) * 1.05);
      }
      if (!ok) continue; // no room this layout — skip that cluster
      placed.push(makePlanet(x, y, r, NEON[i % NEON.length], now));
    }
    return placed;
  }

  function populate(now) {
    const DOTS = Math.round(Math.min(90, Math.max(40, (W * H) / 22000)));
    dots = Array.from({ length: DOTS }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.1,
      vy: (Math.random() - 0.5) * 0.07,
      r: 0.5 + Math.random() * 1.6,
      a: 0.04 + Math.random() * 0.12,
    }));

    const STARS = Math.round(Math.min(60, Math.max(16, (W * H) / 31000)));
    stars = Array.from({ length: STARS }, () => makeStar(now));
    planets = placePlanets(now);
  }

  function resize() {
    const nextW = Math.max(window.innerWidth, 360);
    const nextH = Math.max(window.innerHeight, 360);
    const changed = stars.length === 0 || Math.abs(nextW - W) > 40 || Math.abs(nextH - H) > 40;
    W = nextW;
    H = nextH;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (changed) populate(performance.now());
  }

  // Shared lifecycle: noise → focus → hold → dissolve, expressed as brightness
  // plus the blur that has not resolved yet.
  function phase(age, item) {
    if (age < item.denoiseMs) {
      const t = age / item.denoiseMs;
      return { base: item.peak * t, blur: (1 - t) * 3.4 };
    }
    if (age < item.denoiseMs + item.holdMs) return { base: item.peak, blur: 0 };
    const tf = (age - item.denoiseMs - item.holdMs) / item.fadeMs;
    return { base: item.peak * (1 - tf), blur: 0 };
  }

  function render(now) {
    ctx.clearRect(0, 0, W, H);

    // interstellar dust
    for (const d of dots) {
      d.x = (d.x + d.vx + W) % W;
      d.y = (d.y + d.vy + H) % H;
      ctx.beginPath();
      ctx.fillStyle = `rgba(200, 220, 240, ${d.a})`;
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // word-stars: advance the lifecycle, rebirth the expired ones elsewhere
    for (const s of stars) {
      const age = now - s.born;
      if (age > s.denoiseMs + s.holdMs + s.fadeMs) {
        Object.assign(s, makeStar(now), { born: now, alpha: 0, blur: 0 });
        continue;
      }
      const { base, blur } = phase(age, s);
      s.alpha = base * (0.78 + 0.22 * Math.sin(now / s.twSpeed + s.twPhase));
      s.blur = blur;
    }

    // constellation links — white, flickering
    ctx.lineWidth = 0.6;
    for (let i = 0; i < stars.length; i++) {
      const a = stars[i];
      if (a.alpha < 0.1) continue; // still out of focus — nothing to link yet
      for (let j = i + 1; j < stars.length; j++) {
        const b = stars[j];
        if (b.alpha < 0.1) continue;
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (dist > STAR_LINK_DIST) continue;
        const flicker = blink(now, i * 31 + j * 17);
        if (flicker === 0) continue;
        const strength = (1 - dist / STAR_LINK_DIST) * Math.min(a.alpha, b.alpha) * 0.55 * flicker;
        if (strength < 0.015) continue;
        ctx.strokeStyle = `rgba(215, 230, 255, ${strength.toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    // the words themselves
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    for (const s of stars) {
      if (s.alpha < 0.02) continue;
      ctx.font = `${s.size}px ui-monospace, SFMono-Regular, Consolas, monospace`;
      const bright = s.size >= 15;
      if (bright && s.alpha > 0.4) {
        ctx.shadowColor = `rgba(220, 235, 255, ${(s.alpha * 0.8).toFixed(3)})`;
        ctx.shadowBlur = 7;
      }
      const blurring = s.blur > 0.4;
      if (blurring) {
        ctx.save();
        ctx.filter = `blur(${s.blur.toFixed(1)}px)`;
      }
      ctx.fillStyle = `rgba(236, 244, 255, ${s.alpha.toFixed(3)})`;
      ctx.fillText(s.word, s.x, s.y);
      if (blurring) ctx.restore();
      if (bright) ctx.shadowBlur = 0;
    }

    // neon clusters
    for (let p = 0; p < planets.length; p++) {
      const pl = planets[p];
      pl.x = pl.cx + Math.sin(now / 26000 + pl.wanderPhase) * pl.r * 0.12;
      pl.y = pl.cy + Math.cos(now / 31000 + pl.wanderPhase * 1.3) * pl.r * 0.09;

      const cosT = Math.cos(pl.tilt);
      const sinT = Math.sin(pl.tilt);

      const glow = ctx.createRadialGradient(pl.x, pl.y, 0, pl.x, pl.y, pl.r * 1.4);
      glow.addColorStop(0, `rgba(${pl.color}, 0.11)`);
      glow.addColorStop(0.55, `rgba(${pl.color}, 0.04)`);
      glow.addColorStop(1, `rgba(${pl.color}, 0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(pl.x, pl.y, pl.r * 1.4, 0, Math.PI * 2);
      ctx.fill();

      const ringPulse = 0.6 + 0.4 * Math.sin(now / 1600 + pl.wanderPhase);
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(${pl.color}, ${(0.2 * ringPulse).toFixed(3)})`;
      ctx.beginPath();
      ctx.ellipse(pl.x, pl.y, pl.r, pl.r * pl.flat, pl.tilt, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = `rgba(${pl.color}, 0.08)`;
      ctx.beginPath();
      ctx.ellipse(pl.x, pl.y, pl.r * 0.62, pl.r * 0.62 * pl.flat, pl.tilt, 0, Math.PI * 2);
      ctx.stroke();

      for (const m of pl.members) {
        if (now - m.born > m.denoiseMs + m.holdMs + m.fadeMs) {
          Object.assign(m, makeMember(pl.r, now, false));
        }
        const { base, blur } = phase(now - m.born, m);
        m.alpha = Math.max(0, base);
        m.blur = blur;

        // absolute-time orbit on the tilted disc — stable across dropped frames
        const ang = m.baseAngle + now * pl.spin;
        const u = Math.cos(ang) * m.dist;
        const v = Math.sin(ang) * m.dist * pl.flat;
        m.x = pl.x + u * cosT - v * sinT;
        m.y = pl.y + u * sinT + v * cosT;
      }

      const linkDist = pl.r * MEMBER_LINK_RATIO;
      ctx.lineWidth = 0.7;
      for (let i = 0; i < pl.members.length; i++) {
        const a = pl.members[i];
        if (a.alpha < 0.12) continue;
        for (let j = i + 1; j < pl.members.length; j++) {
          const b = pl.members[j];
          if (b.alpha < 0.12) continue;
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          if (dist > linkDist) continue;
          const flicker = blink(now, p * 101 + i * 13 + j * 7);
          if (flicker === 0) continue;
          const strength = (1 - dist / linkDist) * Math.min(a.alpha, b.alpha) * 0.6 * flicker;
          if (strength < 0.02) continue;
          ctx.strokeStyle = `rgba(${pl.color}, ${strength.toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      for (const m of pl.members) {
        if (m.alpha < 0.02) continue;
        ctx.font = `${m.size}px ui-monospace, SFMono-Regular, Consolas, monospace`;
        if (m.alpha > 0.45) {
          ctx.shadowColor = `rgba(${pl.color}, ${(m.alpha * 0.7).toFixed(3)})`;
          ctx.shadowBlur = 6;
        }
        const blurring = m.blur > 0.4;
        if (blurring) {
          ctx.save();
          ctx.filter = `blur(${m.blur.toFixed(1)}px)`;
        }
        ctx.fillStyle = `rgba(${pl.color}, ${m.alpha.toFixed(3)})`;
        ctx.fillText(m.word, m.x, m.y);
        if (blurring) ctx.restore();
        ctx.shadowBlur = 0;
      }

      const corePulse = 0.7 + 0.3 * Math.sin(now / 1100 + pl.wanderPhase * 2);
      ctx.shadowColor = `rgba(${pl.color}, 0.85)`;
      ctx.shadowBlur = 14;
      ctx.fillStyle = `rgba(${pl.color}, ${(0.9 * corePulse).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(pl.x, pl.y, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  const onVisibility = () => {
    resize();
    if (reduced) render(performance.now());
  };

  const loop = (now) => {
    // Cheap self-check: recover if the first measurement happened while hidden.
    if (Math.abs(window.innerWidth - W) > 40 || Math.abs(window.innerHeight - H) > 40) resize();
    render(now);
    raf = requestAnimationFrame(loop);
  };

  let started = false;

  function start() {
    if (started) return;
    started = true;
    splash.classList.add("leaving");
    window.removeEventListener("keydown", onKey);
    splash.addEventListener(
      "transitionend",
      () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", resize);
        document.removeEventListener("visibilitychange", onVisibility);
        splash.remove();
        document.body.classList.remove("splash-open");
        document.querySelector("#brief")?.focus();
      },
      { once: true },
    );
  }

  function onKey(event) {
    if (event.key === "Tab" || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    start();
  }

  document.body.classList.add("splash-open");
  resize();
  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", onVisibility);
  render(performance.now()); // a valid first frame even where rAF never runs
  if (!reduced) raf = requestAnimationFrame(loop);

  splash.addEventListener("click", start);
  window.addEventListener("keydown", onKey);
  startButton.focus({ preventScroll: true });
}
