import React from "react";
import {
  getWheelOrder, getWheelSize, getPocketAngle,
  getNumberColor, pocketLabel,
  type SpinResult, type WheelType,
} from "./engine";

export function RouletteWheel({ result, spinning, wheelType }: { result: SpinResult | null; spinning: boolean; wheelType: WheelType }) {
  const [wheelRot, setWheelRot] = React.useState(0);
  const [ballRot, setBallRot] = React.useState(0);

  const order = getWheelOrder(wheelType);
  const slice = getPocketAngle(wheelType);
  const N = getWheelSize(wheelType);

  React.useEffect(() => {
    if (!result) return;
    const idx = order.indexOf(result.number as never);
    if (idx < 0) return;
    const wheelTarget = -idx * slice;
    setWheelRot(prev => prev - (prev % 360) + 360 * 4 + wheelTarget);
    setBallRot(prev => prev - (prev % 360) - 360 * 6);
  }, [result, order, slice]);

  // When wheel type changes, reset rotation so visuals don't carry over a stale angle.
  React.useEffect(() => {
    setWheelRot(0);
    setBallRot(0);
  }, [wheelType]);

  const cx = 150, cy = 150;
  const numberR = 130;
  const innerR = 70;
  const labelR = 107;

  return (
    <div className="wheel-stage">
      <div className="wheel-rim" />
      <div className="wheel-pointer" />
      <div className="wheel-svg-wrap">
        <svg
          className="wheel-svg"
          viewBox="0 0 300 300"
          style={{ transform: `rotate(${wheelRot}deg)` }}
          role="img"
          aria-label={`${wheelType === "american" ? "American (double-zero)" : "European single-zero"} roulette wheel`}
        >
          <defs>
            <radialGradient id="hub" cx="50%" cy="50%">
              <stop offset="0%" stopColor="#f4c762" />
              <stop offset="60%" stopColor="#c6972b" />
              <stop offset="100%" stopColor="#8a6131" />
            </radialGradient>
            <radialGradient id="hubInner" cx="50%" cy="50%">
              <stop offset="0%" stopColor="#5b3d18" />
              <stop offset="100%" stopColor="#2a1a08" />
            </radialGradient>
          </defs>
          <circle cx={cx} cy={cy} r={148} fill="#241315" />
          {order.map((num, i) => {
            const a1 = ((i * slice - 90 - slice / 2) * Math.PI) / 180;
            const a2 = (((i + 1) * slice - 90 - slice / 2) * Math.PI) / 180;
            const x1 = cx + numberR * Math.cos(a1);
            const y1 = cy + numberR * Math.sin(a1);
            const x2 = cx + numberR * Math.cos(a2);
            const y2 = cy + numberR * Math.sin(a2);
            const x3 = cx + innerR * Math.cos(a2);
            const y3 = cy + innerR * Math.sin(a2);
            const x4 = cx + innerR * Math.cos(a1);
            const y4 = cy + innerR * Math.sin(a1);
            const color = getNumberColor(num);
            const fill = color === "green" ? "#149447" : color === "red" ? "#b91c1c" : "#0d1018";
            const labelAngle = i * slice;
            const lx = cx + labelR * Math.cos((labelAngle - 90) * (Math.PI / 180));
            const ly = cy + labelR * Math.sin((labelAngle - 90) * (Math.PI / 180));
            // shrink font slightly when 38 pockets
            const fontSize = N === 38 ? 8.5 : 10;
            return (
              <g key={`${wheelType}-${i}`}>
                <path
                  d={`M ${x1} ${y1} A ${numberR} ${numberR} 0 0 1 ${x2} ${y2} L ${x3} ${y3} A ${innerR} ${innerR} 0 0 0 ${x4} ${y4} Z`}
                  fill={fill}
                  stroke="rgba(244,199,98,0.55)"
                  strokeWidth="0.8"
                />
                <text
                  x={lx}
                  y={ly}
                  fill="#fff"
                  fontSize={fontSize}
                  fontWeight="800"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  transform={`rotate(${labelAngle}, ${lx}, ${ly})`}
                  style={{ fontFamily: "JetBrains Mono, monospace" }}
                >
                  {pocketLabel(num)}
                </text>
              </g>
            );
          })}
          <circle cx={cx} cy={cy} r={innerR} fill="url(#hubInner)" stroke="#5b3d18" strokeWidth="1.5" />
          <circle cx={cx} cy={cy} r={innerR - 16} fill="url(#hub)" stroke="#5b3d18" strokeWidth="1" />
          <circle cx={cx} cy={cy} r={innerR - 32} fill="#241315" />
          <circle cx={cx} cy={cy} r={6} fill="#f4c762" />
          {[0, 60, 120, 180, 240, 300].map(angle => {
            const rad = (angle - 90) * (Math.PI / 180);
            const x = cx + (innerR - 4) * Math.cos(rad);
            const y = cy + (innerR - 4) * Math.sin(rad);
            return <line key={angle} x1={cx} y1={cy} x2={x} y2={y} stroke="#5b3d18" strokeWidth="1.5" />;
          })}
        </svg>
      </div>
      <div
        className={`ball-orbit ${spinning ? "" : "idle"}`}
        style={spinning ? { transform: `rotate(${ballRot}deg)` } : undefined}
      >
        <div className="ball" />
      </div>
    </div>
  );
}
