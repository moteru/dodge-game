import { useEffect, useRef, useState, useCallback } from "react";

const W = 360;
const PLAYER_SPEED = 3.5;
const PLAYER_RADIUS = 6;
const BULLET_RADIUS = 5;

const PAD_SIZE = 180;
const PAD_R = PAD_SIZE / 2;
const ZONE_R = PAD_R * 0.38;
const BTN = 52;

function getDifficulty(t) {
  return Math.min(1.0, 1 - 1 / (1 + (t / 20) * 1.4 + (t / 70) * 1.0));
}

function getBulletConfig(elapsed) {
  const d = getDifficulty(elapsed);
  // Interval: 950ms → 220ms
  const interval = Math.round(950 - d * 730);
  // Speed: 1.4 → 3.6 (reduced cap, feels fair)
  const speed = 1.4 + d * 1.6 + Math.pow(d, 2.0) * 0.6;
  // Burst chance: starts at d>0.6, max ~0.6
  const burstChance = d > 0.6 ? (d - 0.6) * 1.5 : 0;
  // Aim bias: 0 → 0.45 (slightly lower than before)
  const aimBias = Math.min(0.45, Math.max(0, (d - 0.38) * 1.2));
  // Gravity bullet ratio: 0 → 40% of bullets get the bend effect
  const gravChance = Math.min(0.4, d * 0.5);
  return { interval, speed, burstChance, aimBias, gravChance };
}

function makeBulletFromSide(side, speed, aimBias, gravChance, playerX, playerY, canvasH) {
  let x, y, baseVx, baseVy;
  if (side === 0) {
    x = Math.random() * W; y = -BULLET_RADIUS;
    baseVx = (Math.random() - 0.5) * 1.2; baseVy = 1;
  } else if (side === 1) {
    x = Math.random() * W; y = canvasH + BULLET_RADIUS;
    baseVx = (Math.random() - 0.5) * 1.2; baseVy = -1;
  } else if (side === 2) {
    x = -BULLET_RADIUS; y = Math.random() * canvasH;
    baseVx = 1; baseVy = (Math.random() - 0.5) * 1.2;
  } else {
    x = W + BULLET_RADIUS; y = Math.random() * canvasH;
    baseVx = -1; baseVy = (Math.random() - 0.5) * 1.2;
  }
  const toDx = playerX - x, toDy = playerY - y;
  const toLen = Math.sqrt(toDx * toDx + toDy * toDy) || 1;
  const aimVx = toDx / toLen, aimVy = toDy / toLen;
  const baseLen = Math.sqrt(baseVx * baseVx + baseVy * baseVy) || 1;
  const nBx = baseVx / baseLen, nBy = baseVy / baseLen;
  const fVx = nBx * (1 - aimBias) + aimVx * aimBias;
  const fVy = nBy * (1 - aimBias) + aimVy * aimBias;
  const fLen = Math.sqrt(fVx * fVx + fVy * fVy) || 1;
  const jitter = 0.88 + Math.random() * 0.24;
  const baseSpeed = speed * jitter;
  const nvx = (fVx / fLen) * baseSpeed;
  const nvy = (fVy / fLen) * baseSpeed;

  // Gravity-bend bullet: decelerates, bends 5~15°, re-accelerates
  const isGrav = Math.random() < gravChance;
  let gravState = null;
  if (isGrav) {
    // bendDelay: frames until deceleration begins (60~150 frames ≈ 1~2.5s at 60fps)
    const bendDelay = 60 + Math.floor(Math.random() * 90);
    // bendAngle: rotation in radians (5~15 degrees, random sign)
    const sign = Math.random() < 0.5 ? 1 : -1;
    const bendAngle = sign * (5 + Math.random() * 10) * (Math.PI / 180);
    gravState = {
      phase: 'normal',   // normal → slowing → bending → reaccel
      timer: 0,
      bendDelay,
      bendAngle,
      baseSpeed,
      slowDuration: 40 + Math.floor(Math.random() * 30), // frames to decelerate
      done: false,
    };
  }

  return { x, y, vx: nvx, vy: nvy, baseSpeed, isGrav, gravState, id: Math.random() };
}

function spawnBullet(elapsed, canvasH, playerX, playerY) {
  const cfg = getBulletConfig(elapsed);
  const side = Math.floor(Math.random() * 4);
  const bullets = [makeBulletFromSide(side, cfg.speed, cfg.aimBias, cfg.gravChance, playerX, playerY, canvasH)];
  if (Math.random() < cfg.burstChance) {
    const count = Math.random() < 0.4 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      bullets.push(makeBulletFromSide(side, cfg.speed * (0.9 + Math.random() * 0.18), cfg.aimBias, cfg.gravChance, playerX, playerY, canvasH));
    }
  }
  return bullets;
}

// Per-frame gravity bullet physics update
function updateGravBullet(b) {
  if (!b.isGrav || !b.gravState || b.gravState.done) return;
  const g = b.gravState;
  g.timer++;

  if (g.phase === 'normal' && g.timer >= g.bendDelay) {
    g.phase = 'slowing';
    g.timer = 0;
    // Store direction at moment of bend for rotation
    const spd = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    g.preBendAngle = Math.atan2(b.vy, b.vx);
    g.preBendSpeed = spd;
  } else if (g.phase === 'slowing') {
    // Ease speed down to ~30% over slowDuration frames
    const t = g.timer / g.slowDuration;
    const easedT = t < 1 ? t : 1;
    const targetSpeed = g.preBendSpeed * 0.30;
    const curSpeed = g.preBendSpeed * (1 - easedT) + targetSpeed * easedT;
    // Simultaneously rotate direction by bendAngle (proportional to t)
    const curAngle = g.preBendAngle + g.bendAngle * easedT;
    b.vx = Math.cos(curAngle) * curSpeed;
    b.vy = Math.sin(curAngle) * curSpeed;
    if (g.timer >= g.slowDuration) {
      g.phase = 'reaccel';
      g.timer = 0;
      g.finalAngle = g.preBendAngle + g.bendAngle;
    }
  } else if (g.phase === 'reaccel') {
    // Re-accelerate back to original speed over same duration
    const t = Math.min(1, g.timer / g.slowDuration);
    const ease = t * t * (3 - 2 * t); // smoothstep
    const curSpeed = g.preBendSpeed * 0.30 + (g.preBendSpeed - g.preBendSpeed * 0.30) * ease;
    b.vx = Math.cos(g.finalAngle) * curSpeed;
    b.vy = Math.sin(g.finalAngle) * curSpeed;
    if (t >= 1) g.done = true;
  }
}

function getDirectionsFromOffset(ox, oy) {
  const dist = Math.sqrt(ox * ox + oy * oy);
  if (dist < ZONE_R) return { up: false, down: false, left: false, right: false };
  const ratio = Math.abs(oy) / (Math.abs(ox) || 0.001);
  const thresh = 0.414;
  return {
    up: oy < 0 && ratio > thresh,
    down: oy > 0 && ratio > thresh,
    left: ox < 0 && (1 / ratio) > thresh,
    right: ox > 0 && (1 / ratio) > thresh,
  };
}

export default function DodgeGame() {
  const canvasRef = useRef(null);
  const canvasHRef = useRef(300);
  const stateRef = useRef({
    phase: "idle",
    player: { x: W / 2, y: 150, angle: -Math.PI / 2 },
    bullets: [],
    elapsed: 0,
    lastTime: null,
    nextSpawn: 600,
    keys: { up: false, down: false, left: false, right: false },
    animId: null,
  });
  const padRef = useRef(null);
  const mouseDownRef = useRef(false);

  const [displayTime, setDisplayTime] = useState(0);
  const [bestTime, setBestTime] = useState(0);
  const [phase, setPhase] = useState("idle");
  const [pressedDirs, setPressedDirs] = useState({ up: false, down: false, left: false, right: false });

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const H = canvas.height;
    const s = stateRef.current;

    ctx.fillStyle = "#0a0a0f";
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < H; i += 4) {
      ctx.fillStyle = "rgba(0,0,0,0.07)";
      ctx.fillRect(0, i, W, 1);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.03)";
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 30) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y < H; y += 30) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    s.bullets.forEach(b => {
      // Gravity bullets: cyan-purple; normal: red
      const isGravActive = b.isGrav && b.gravState && !b.gravState.done;
      const isBending = isGravActive && (b.gravState.phase === 'slowing' || b.gravState.phase === 'reaccel');
      const coreColor = isGravActive ? (isBending ? "#cc88ff" : "#55ddcc") : "#ff4444";
      const glowColor = isGravActive ? (isBending ? "rgba(180,80,255,0.5)" : "rgba(60,220,200,0.45)") : "rgba(255,80,80,0.5)";
      const glowR = isBending ? BULLET_RADIUS * 5 : BULLET_RADIUS * 3.5;
      const grd = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, glowR);
      grd.addColorStop(0, glowColor);
      grd.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(b.x, b.y, glowR, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = coreColor;
      ctx.beginPath(); ctx.arc(b.x, b.y, BULLET_RADIUS, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.beginPath(); ctx.arc(b.x - 1, b.y - 1, 1.8, 0, Math.PI * 2); ctx.fill();
    });

    const p = s.player;
    const pgrd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 24);
    pgrd.addColorStop(0, "rgba(100,200,255,0.28)");
    pgrd.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = pgrd;
    ctx.beginPath(); ctx.arc(p.x, p.y, 24, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.beginPath();
    ctx.moveTo(0, -12); ctx.lineTo(8.4, 7.2); ctx.lineTo(-8.4, 7.2);
    ctx.closePath();
    ctx.fillStyle = "#64c8ff";
    ctx.fill();
    ctx.strokeStyle = "#c0eaff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }, []);

  const gameLoop = useCallback((timestamp) => {
    const s = stateRef.current;
    if (s.phase !== "playing") return;
    if (!s.lastTime) s.lastTime = timestamp;
    const dt = Math.min((timestamp - s.lastTime) / 1000, 0.05);
    s.lastTime = timestamp;
    s.elapsed += dt;

    const { keys, player } = s;
    let dx = 0, dy = 0;
    if (keys.up) dy -= 1;
    if (keys.down) dy += 1;
    if (keys.left) dx -= 1;
    if (keys.right) dx += 1;
    if (dx !== 0 && dy !== 0) { dx *= 0.707; dy *= 0.707; }

    // Update facing angle when moving
    // atan2(dy,dx): right=0, down=π/2. Triangle tip is drawn upward (−π/2 offset).
    if (dx !== 0 || dy !== 0) {
      const targetAngle = Math.atan2(dy, dx) + Math.PI / 2;
      let diff = targetAngle - player.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      player.angle += diff * 0.28;
    }
    const H = canvasHRef.current;
    player.x = Math.max(PLAYER_RADIUS, Math.min(W - PLAYER_RADIUS, player.x + dx * PLAYER_SPEED));
    player.y = Math.max(PLAYER_RADIUS, Math.min(H - PLAYER_RADIUS, player.y + dy * PLAYER_SPEED));

    const cfg = getBulletConfig(s.elapsed);
    if (s.elapsed * 1000 >= s.nextSpawn) {
      const newBullets = spawnBullet(s.elapsed, H, player.x, player.y);
      s.bullets.push(...newBullets);
      s.nextSpawn = s.elapsed * 1000 + cfg.interval + (Math.random() - 0.5) * 80;
    }
    s.bullets = s.bullets.filter(b => {
      updateGravBullet(b);   // gravity-bend physics (no-op for normal bullets)
      b.x += b.vx; b.y += b.vy;
      return b.x > -20 && b.x < W + 20 && b.y > -20 && b.y < H + 20;
    });

    for (const b of s.bullets) {
      const ddx = b.x - player.x, ddy = b.y - player.y;
      if (Math.sqrt(ddx * ddx + ddy * ddy) < PLAYER_RADIUS + BULLET_RADIUS - 1) {
        s.phase = "dead";
        setPhase("dead");
        setBestTime(prev => Math.max(prev, s.elapsed));
        setDisplayTime(s.elapsed);
        drawFrame();
        return;
      }
    }
    setDisplayTime(s.elapsed);
    drawFrame();
    s.animId = requestAnimationFrame(gameLoop);
  }, [drawFrame]);

  const startGame = useCallback(() => {
    const s = stateRef.current;
    if (s.animId) cancelAnimationFrame(s.animId);
    const H = canvasHRef.current;
    s.phase = "playing";
    s.player = { x: W / 2, y: H / 2, angle: -Math.PI / 2 };
    s.bullets = [];
    s.elapsed = 0;
    s.lastTime = null;
    s.nextSpawn = 600;
    s.keys = { up: false, down: false, left: false, right: false };
    setPressedDirs({ up: false, down: false, left: false, right: false });
    setDisplayTime(0);
    setPhase("playing");
    drawFrame();
    s.animId = requestAnimationFrame(gameLoop);
  }, [gameLoop, drawFrame]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const obs = new ResizeObserver(() => {
      const h = canvas.clientHeight;
      if (h > 0) {
        canvasHRef.current = h;
        canvas.height = h;
        drawFrame();
      }
    });
    obs.observe(canvas);
    return () => obs.disconnect();
  }, [drawFrame]);

  useEffect(() => {
    drawFrame();
    return () => { if (stateRef.current.animId) cancelAnimationFrame(stateRef.current.animId); };
  }, [drawFrame]);

  const applyDirs = useCallback((dirs) => {
    stateRef.current.keys = { ...dirs };
    setPressedDirs({ ...dirs });
  }, []);

  const getPadOffset = useCallback((clientX, clientY) => {
    const pad = padRef.current;
    if (!pad) return { ox: 0, oy: 0 };
    const rect = pad.getBoundingClientRect();
    return { ox: clientX - rect.left - PAD_R, oy: clientY - rect.top - PAD_R };
  }, []);

  const handlePadTouchStart = useCallback((e) => {
    e.preventDefault();
    if (!e.touches.length) return;
    const t = e.touches[e.touches.length - 1];
    const { ox, oy } = getPadOffset(t.clientX, t.clientY);
    applyDirs(getDirectionsFromOffset(ox, oy));
  }, [getPadOffset, applyDirs]);

  const handlePadTouchMove = useCallback((e) => {
    e.preventDefault();
    if (!e.touches.length) return;
    const t = e.touches[e.touches.length - 1];
    const { ox, oy } = getPadOffset(t.clientX, t.clientY);
    applyDirs(getDirectionsFromOffset(ox, oy));
  }, [getPadOffset, applyDirs]);

  const handlePadTouchEnd = useCallback((e) => {
    e.preventDefault();
    if (!e.touches.length) {
      applyDirs({ up: false, down: false, left: false, right: false });
    } else {
      const t = e.touches[e.touches.length - 1];
      const { ox, oy } = getPadOffset(t.clientX, t.clientY);
      applyDirs(getDirectionsFromOffset(ox, oy));
    }
  }, [getPadOffset, applyDirs]);

  const handlePadMouseDown = useCallback((e) => {
    mouseDownRef.current = true;
    const { ox, oy } = getPadOffset(e.clientX, e.clientY);
    applyDirs(getDirectionsFromOffset(ox, oy));
  }, [getPadOffset, applyDirs]);

  const handlePadMouseMove = useCallback((e) => {
    if (!mouseDownRef.current) return;
    const { ox, oy } = getPadOffset(e.clientX, e.clientY);
    applyDirs(getDirectionsFromOffset(ox, oy));
  }, [getPadOffset, applyDirs]);

  const handlePadMouseUp = useCallback(() => {
    mouseDownRef.current = false;
    applyDirs({ up: false, down: false, left: false, right: false });
  }, [applyDirs]);

  const fmt = (t) => t.toFixed(1) + "s";

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      height: "100svh",
      overflow: "hidden",
      backgroundColor: "#050508",
      fontFamily: "'Courier New', monospace",
      userSelect: "none",
      WebkitUserSelect: "none",
      touchAction: "none",
    }}>
      <div style={{
        width: "min(360px, 100vw)",
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}>
        {/* HUD */}
        <div style={{
          flexShrink: 0,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "7px 14px",
          backgroundColor: "#0a0a0f",
          borderBottom: "1px solid rgba(100,200,255,0.13)",
        }}>
          <div>
            <div style={{ fontSize: 9, color: "rgba(100,200,255,0.45)", letterSpacing: 2, textTransform: "uppercase" }}>TIME</div>
            <div style={{ fontSize: 20, color: "#64c8ff", fontWeight: "bold", letterSpacing: 1, lineHeight: 1.2 }}>{fmt(displayTime)}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
            <div style={{ fontSize: 9, color: "rgba(255,200,100,0.45)", letterSpacing: 2 }}>DANGER</div>
            <div style={{ width: 60, height: 6, backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 3, overflow: "hidden" }}>
              <div style={{
                height: "100%",
                width: `${Math.min(100, getDifficulty(displayTime) * 100)}%`,
                background: `linear-gradient(90deg, #22cc66, #ffcc00 50%, #ff3333)`,
                borderRadius: 3,
                transition: "width 0.4s ease",
              }} />
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 9, color: "rgba(255,200,100,0.45)", letterSpacing: 2, textTransform: "uppercase" }}>BEST</div>
            <div style={{ fontSize: 20, color: "#ffc864", fontWeight: "bold", letterSpacing: 1, lineHeight: 1.2 }}>{fmt(bestTime)}</div>
          </div>
        </div>

        {/* Canvas */}
        <div style={{ position: "relative", flexGrow: 1, overflow: "hidden" }}>
          <canvas ref={canvasRef} width={W} style={{ display: "block", width: "100%", height: "100%" }} />

          {phase === "idle" && (
            <div onClick={startGame} onTouchEnd={(e) => { e.preventDefault(); startGame(); }}
              style={{
                position: "absolute", inset: 0, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center",
                backgroundColor: "rgba(0,0,0,0.76)", cursor: "pointer",
              }}>
              <div style={{ fontSize: 10, color: "rgba(100,200,255,0.55)", letterSpacing: 6, marginBottom: 14 }}>DODGE</div>
              <div style={{ fontSize: 26, color: "#64c8ff", fontWeight: "bold", letterSpacing: 2, marginBottom: 8 }}>TAP TO START</div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.28)", letterSpacing: 2 }}>AVOID ALL BULLETS</div>
            </div>
          )}

          {phase === "dead" && (
            <div onClick={startGame} onTouchEnd={(e) => { e.preventDefault(); startGame(); }}
              style={{
                position: "absolute", inset: 0, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center",
                backgroundColor: "rgba(0,0,0,0.82)", cursor: "pointer",
              }}>
              <div style={{ fontSize: 10, color: "rgba(255,80,80,0.7)", letterSpacing: 6, marginBottom: 12 }}>GAME OVER</div>
              <div style={{
                border: "1px solid rgba(100,200,255,0.2)", borderRadius: 8,
                padding: "18px 32px", marginBottom: 22, textAlign: "center",
                backgroundColor: "rgba(10,10,20,0.8)",
              }}>
                <div style={{ fontSize: 10, color: "rgba(100,200,255,0.45)", letterSpacing: 3, marginBottom: 5 }}>SURVIVED</div>
                <div style={{ fontSize: 38, color: "#64c8ff", fontWeight: "bold", letterSpacing: 2 }}>{fmt(displayTime)}</div>
                {displayTime >= bestTime && displayTime > 0 && (
                  <div style={{ fontSize: 10, color: "#ffc864", letterSpacing: 3, marginTop: 5 }}>★ NEW BEST ★</div>
                )}
              </div>
              <div style={{
                padding: "13px 28px", border: "1px solid rgba(100,200,255,0.38)",
                borderRadius: 6, fontSize: 13, color: "#64c8ff", letterSpacing: 3,
                backgroundColor: "rgba(100,200,255,0.07)",
              }}>TAP TO RESTART</div>
            </div>
          )}
        </div>

        {/* D-pad */}
        <div style={{
          flexShrink: 0,
          backgroundColor: "#080810",
          borderTop: "1px solid rgba(100,200,255,0.09)",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          padding: "14px 0 18px",
        }}>
          <div
            ref={padRef}
            onTouchStart={handlePadTouchStart}
            onTouchMove={handlePadTouchMove}
            onTouchEnd={handlePadTouchEnd}
            onTouchCancel={handlePadTouchEnd}
            onMouseDown={handlePadMouseDown}
            onMouseMove={handlePadMouseMove}
            onMouseUp={handlePadMouseUp}
            onMouseLeave={handlePadMouseUp}
            style={{
              position: "relative",
              width: PAD_SIZE,
              height: PAD_SIZE,
              borderRadius: "50%",
              background: "radial-gradient(circle at 38% 35%, #1c1c2e 0%, #0d0d18 55%, #070710 100%)",
              border: "2.5px solid rgba(100,200,255,0.18)",
              boxShadow: `
                0 0 0 1px rgba(100,200,255,0.05),
                0 0 28px rgba(0,0,0,0.85),
                inset 0 1px 0 rgba(255,255,255,0.05),
                inset 0 -1px 0 rgba(0,0,0,0.5)
              `,
              cursor: "pointer",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            {/* Center dot */}
            <div style={{
              position: "absolute", top: "50%", left: "50%",
              transform: "translate(-50%,-50%)",
              width: PAD_SIZE * 0.26, height: PAD_SIZE * 0.26,
              borderRadius: "50%",
              background: "radial-gradient(circle, #0b0b17, #060610)",
              border: "1px solid rgba(100,200,255,0.09)",
              boxShadow: "inset 0 2px 5px rgba(0,0,0,0.7)",
              zIndex: 2,
              pointerEvents: "none",
            }} />

            {/* Cross divider lines */}
            <div style={{
              position: "absolute", top: "50%", left: "14%", right: "14%",
              height: 1, background: "rgba(100,200,255,0.07)",
              transform: "translateY(-50%)", pointerEvents: "none", zIndex: 1,
            }} />
            <div style={{
              position: "absolute", left: "50%", top: "14%", bottom: "14%",
              width: 1, background: "rgba(100,200,255,0.07)",
              transform: "translateX(-50%)", pointerEvents: "none", zIndex: 1,
            }} />

            <Arrow dir="up" pressed={pressedDirs.up} />
            <Arrow dir="down" pressed={pressedDirs.down} />
            <Arrow dir="left" pressed={pressedDirs.left} />
            <Arrow dir="right" pressed={pressedDirs.right} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Arrow({ dir, pressed }) {
  const pos = {
    up: { top: "7%", left: "50%", transform: "translateX(-50%)" },
    down: { bottom: "7%", left: "50%", transform: "translateX(-50%)" },
    left: { left: "7%", top: "50%", transform: "translateY(-50%)" },
    right: { right: "7%", top: "50%", transform: "translateY(-50%)" },
  };
  const sym = { up: "▲", down: "▼", left: "◀", right: "▶" };

  return (
    <div style={{
      position: "absolute",
      width: BTN, height: BTN,
      display: "flex", alignItems: "center", justifyContent: "center",
      ...pos[dir],
      borderRadius: 8,
      backgroundColor: pressed ? "rgba(100,200,255,0.18)" : "rgba(100,200,255,0.04)",
      transition: "background-color 0.05s",
      pointerEvents: "none",
      zIndex: 3,
    }}>
      <span style={{
        fontSize: 20,
        color: pressed ? "#c0eaff" : "rgba(100,200,255,0.3)",
        textShadow: pressed ? "0 0 12px rgba(100,200,255,0.9)" : "none",
        transition: "color 0.05s, text-shadow 0.05s",
        lineHeight: 1,
      }}>{sym[dir]}</span>
    </div>
  );
}
