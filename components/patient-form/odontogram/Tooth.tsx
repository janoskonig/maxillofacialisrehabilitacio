'use client';

import { ToothConditions, ToothGroup, toothGroup } from './tooth-conditions';

interface ToothGeometry {
  out: string;
  crown: string;
  root: string;
  cej: [number, number];
  spot: [number, number];
  apex: [number, number];
  cx: number;
}

const GEO: Record<ToothGroup, ToothGeometry> = {
  incisor: {
    out: 'M11,8 Q11,3 14,3 Q17,3 17,8 L17,18 L15,33 Q14,35 13,33 L11,18 Z',
    crown: 'M11,8 Q11,3 14,3 Q17,3 17,8 L17,18 L11,18 Z',
    root: 'M11,18 L17,18 L15,33 Q14,35 13,33 Z',
    cej: [11, 17], spot: [14, 9], apex: [14, 33], cx: 14,
  },
  canine: {
    out: 'M11,9 Q11,3 14,2 Q17,3 17,9 L17,18 L15.5,35 Q14,37 12.5,35 L11,18 Z',
    crown: 'M11,9 Q11,3 14,2 Q17,3 17,9 L17,18 L11,18 Z',
    root: 'M11,18 L17,18 L15.5,35 Q14,37 12.5,35 Z',
    cej: [11, 17], spot: [14, 9], apex: [14, 35], cx: 14,
  },
  premolar: {
    out: 'M9,9 Q9,4 11,4 Q13,4 14,6.5 Q15,4 17,4 Q19,4 19,9 L19,18 L15,33 Q14,35 13,33 L9,18 Z',
    crown: 'M9,9 Q9,4 11,4 Q13,4 14,6.5 Q15,4 17,4 Q19,4 19,9 L19,18 L9,18 Z',
    root: 'M9,18 L19,18 L15,33 Q14,35 13,33 Z',
    cej: [9, 19], spot: [14, 11], apex: [14, 33], cx: 14,
  },
  molar: {
    out: 'M5,9 Q5,4 7,4 Q9,4 10,6 Q11.5,4 13.5,4 Q15.5,4 17,6 Q18,4 20,4 Q22,4 22,9 L22,18 L19,33 Q18,35 17,33 L14,21 Q13.5,20 13,21 L10,33 Q9,35 8,33 L5,18 Z',
    crown: 'M5,9 Q5,4 7,4 Q9,4 10,6 Q11.5,4 13.5,4 Q15.5,4 17,6 Q18,4 20,4 Q22,4 22,9 L22,18 L5,18 Z',
    root: 'M5,18 L22,18 L19,33 Q18,35 17,33 L14,21 Q13.5,20 13,21 L10,33 Q9,35 8,33 Z',
    cej: [5, 22], spot: [13.5, 10], apex: [13.5, 33], cx: 13.5,
  },
};

const TOOTH_FILL = '#EFEEE8';
const TOOTH_STROKE = '#8a887f';
const CROWN_FILL = '#378ADD';
const CROWN_STROKE = '#185FA5';
const PONTIC_FILL = '#5DCAA5';
const PONTIC_STROKE = '#0F6E56';
const ROOT_FILL = '#D85A30';
const ROOT_STROKE = '#993C1D';

const ROMAN = ['', 'I', 'II', 'III'];

interface ToothProps {
  fdi: number | string;
  conditions: ToothConditions;
  size?: number;
  selected?: boolean;
  showNumber?: boolean;
  numberPosition?: 'below' | 'above';
  onClick?: () => void;
  title?: string;
}

export function Tooth({
  fdi,
  conditions,
  size = 26,
  selected = false,
  showNumber = true,
  numberPosition = 'below',
  onClick,
  title,
}: ToothProps) {
  const group = toothGroup(fdi);
  const g = GEO[group];
  const { base, caries, periapical, mobility } = conditions;
  const interactive = !!onClick;

  const crownColored =
    base === 'crown' || base === 'bridge_abutment'
      ? { fill: CROWN_FILL, stroke: CROWN_STROKE }
      : base === 'bridge_pontic'
        ? { fill: PONTIC_FILL, stroke: PONTIC_STROKE }
        : null;

  const showRootCanal = base === 'root_canal';
  const showImplant = base === 'implant';
  // Hídtest = hiányzó természetes fog (gyökér nélkül, lebegő korona).
  const isPontic = base === 'bridge_pontic';
  const crownOnly = showImplant || isPontic;
  const showInlay = base === 'inlay';
  const showFilled = base === 'filled';
  const showNecrotic = base === 'necrotic';
  const rootRemnant = base === 'root_remnant';
  const missing = base === 'missing';
  const impacted = base === 'impacted';
  const outlineStroke = crownColored?.stroke ?? TOOTH_STROKE;

  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      {showNumber && numberPosition === 'above' && (
        <span className="text-[9.5px] leading-none mb-0.5 text-gray-400 dark:text-gray-500">{fdi}</span>
      )}
      <svg
        width={size}
        height={size * 1.46}
        viewBox="0 0 28 40"
        onClick={onClick}
        role={interactive ? 'button' : 'img'}
        aria-label={title || `${fdi} fog`}
        className={interactive ? 'cursor-pointer' : ''}
      >
        {title && <title>{title}</title>}
        {selected && (
          <rect x="1" y="0.5" width="26" height="39" rx="6" fill="#185FA5" opacity="0.12" stroke="#185FA5" strokeWidth="1" />
        )}

        {missing ? (
          <path d={g.out} fill="none" stroke="#b9b7ae" strokeWidth="1" strokeDasharray="2 1.5" opacity="0.7" />
        ) : impacted ? (
          <>
            <path d={g.out} fill={TOOTH_FILL} opacity="0.5" />
            <path d={g.out} fill="none" stroke="#9b9991" strokeWidth="1" strokeDasharray="2 1.5" />
            <rect x="3" y="2.5" width="22" height="4" rx="1.5" fill="#F4C0D1" />
          </>
        ) : rootRemnant ? (
          <>
            <path d={g.root} fill={TOOTH_FILL} />
            <path d={g.root} fill="none" stroke={TOOTH_STROKE} strokeWidth="1" />
            <polyline
              points={`${g.cej[0]},18 ${(g.cej[0] + g.cx) / 2},15.5 ${g.cx},18.5 ${(g.cej[1] + g.cx) / 2},15.5 ${g.cej[1]},17`}
              fill="none"
              stroke={TOOTH_STROKE}
              strokeWidth="1"
            />
          </>
        ) : (
          <>
            {/* alap kitöltés */}
            <path d={crownOnly ? g.crown : g.out} fill={TOOTH_FILL} />

            {/* régió-színezés */}
            {crownColored && <path d={g.crown} fill={crownColored.fill} />}
            {showRootCanal && <path d={g.root} fill={ROOT_FILL} />}

            {/* implantátum csavar a gyökér helyén */}
            {showImplant && (
              <>
                <polygon
                  points={`${g.cx - 3},18.5 ${g.cx + 3},18.5 ${g.cx + 2},33 ${g.cx - 2},33`}
                  fill="#B4B2A9"
                  stroke="#5F5E5A"
                  strokeWidth="0.8"
                />
                {[22, 25.5, 29, 32].map((y) => (
                  <line key={y} x1={g.cx - 2.6} y1={y} x2={g.cx + 2.6} y2={y} stroke="#5F5E5A" strokeWidth="0.7" />
                ))}
              </>
            )}

            {/* körvonal felül */}
            <path d={crownOnly ? g.crown : g.out} fill="none" stroke={outlineStroke} strokeWidth="1" />
            {showRootCanal && <line x1={g.cej[0]} y1={18} x2={g.cej[1]} y2={18} stroke={ROOT_STROKE} strokeWidth="0.8" />}

            {/* inlay/onlay */}
            {showInlay && (
              <rect x={g.cx - 3.5} y={6} width={7} height={4.5} rx={1} fill="#EF9F27" stroke="#854F0B" strokeWidth="0.7" />
            )}
            {/* tömés */}
            {showFilled && (
              <circle cx={g.cx} cy={g.spot[1] + 1} r={2.5} fill="#ffffff" stroke={TOOTH_STROKE} strokeWidth="0.8" />
            )}
            {/* nekrotizált pulpa */}
            {showNecrotic && (
              <path
                d={`M${g.cx - 1},7 L${g.cx + 1},7 L${g.cx + 0.6},20 Q${g.cx + 0.3},24 ${g.cx},27 Q${g.cx - 0.3},24 ${g.cx - 0.6},20 Z`}
                fill="#534AB7"
              />
            )}

            {/* gyökércsúcsi gyulladás */}
            {periapical && (
              <>
                <circle cx={g.apex[0]} cy={g.apex[1]} r={3.4} fill="#E24B4A" opacity="0.35" />
                <circle cx={g.apex[0]} cy={g.apex[1]} r={3.4} fill="none" stroke="#A32D2D" strokeWidth="0.8" />
              </>
            )}

            {/* szuvasodás — független réteg, mindenen látszik */}
            {caries && (
              <circle cx={g.spot[0] - 2.5} cy={g.spot[1]} r={2.3} fill="#2C2C2A" stroke="#fff" strokeWidth="0.9" />
            )}
          </>
        )}

        {/* mobilitás badge */}
        {!missing && mobility > 0 && (
          <text x="14" y="6" textAnchor="middle" fontSize="6" fill="#993C1D" fontWeight="500">
            {ROMAN[Math.min(3, mobility)]}
          </text>
        )}
      </svg>
      {showNumber && numberPosition === 'below' && (
        <span className="text-[9.5px] leading-none mt-0.5 text-gray-400 dark:text-gray-500">{fdi}</span>
      )}
    </div>
  );
}
