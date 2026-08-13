'use client';

import { useId } from 'react';
import { ToothConditions, ToothGroup, toothGroup, surfacesOf } from './tooth-conditions';
import { GEO } from './ToothShape';
import {
  SURFACE_MARK_COLORS,
  isUpperJaw,
  surfaceForRegion,
  surfaceLabel,
  hasSurfaceMark,
  type SurfaceKey,
  type SurfaceRegion,
} from './tooth-surfaces';

/**
 * Grafikus (arpadent-szerű) fogstátusz-nézet: a korona okkluzális
 * fogfelszín-diagramként (keret + 4 trapéz + középső mező), a gyökerek
 * anatómiai sziluettként jelennek meg. Felső fogaknál a gyökér felül,
 * alsóknál alul van (a rajz a szájközépvonal felé "néz").
 *
 * Ugyanabban a 0..28 × 0..40 koordináta-dobozban rajzol, mint a ToothShape,
 * így a két nézet csere-kompatibilis az ívekben és az önálló Tooth-ban.
 */

interface Rect4 {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface ChartGeometry {
  /** Fogfelszín-doboz (külső keret). */
  box: Rect4;
  /** Középső mező (anteriornál keskeny sáv, vízszintesen kettéosztva). */
  center: Rect4;
  splitCenter: boolean;
  /** Gyökér-sziluett path — "gyökér felül" orientációban, a doboz tetejéig (y=20) ér. */
  root: string;
  /** Gyökértömés / nekrózis-vonal x pozíciója. */
  rootCanalX: number;
  /** Gyökércsúcs (periapikális jelzés helye). */
  apex: [number, number];
}

const BOX_TOP = 20;
const BOX_BOTTOM = 36;

const ANTERIOR_BOX: Rect4 = { x0: 7, y0: BOX_TOP, x1: 21, y1: BOX_BOTTOM };
const ANTERIOR_CENTER: Rect4 = { x0: 11.5, y0: 23, x1: 16.5, y1: 33 };

function chartGeometry(group: ToothGroup, upper: boolean): ChartGeometry {
  switch (group) {
    case 'incisor':
      return {
        box: ANTERIOR_BOX,
        center: ANTERIOR_CENTER,
        splitCenter: true,
        root: 'M10.6,20 L10.3,10 Q10.3,2.6 14,2.6 Q17.7,2.6 17.7,10 L17.4,20 Z',
        rootCanalX: 14,
        apex: [14, 3.6],
      };
    case 'canine':
      return {
        box: ANTERIOR_BOX,
        center: ANTERIOR_CENTER,
        splitCenter: true,
        root: 'M10.6,20 L10.2,9 Q10.2,1.8 14,1.8 Q17.8,1.8 17.8,9 L17.4,20 Z',
        rootCanalX: 14,
        apex: [14, 3],
      };
    case 'premolar':
      return {
        box: { x0: 5, y0: BOX_TOP, x1: 23, y1: BOX_BOTTOM },
        center: { x0: 10, y0: 24.5, x1: 18, y1: 31.5 },
        splitCenter: false,
        root: 'M10.4,20 L10.1,9.5 Q10.1,2.8 14,2.8 Q17.9,2.8 17.9,9.5 L17.6,20 Z',
        rootCanalX: 14,
        apex: [14, 4],
      };
    case 'molar':
      return {
        box: { x0: 2, y0: BOX_TOP, x1: 26, y1: BOX_BOTTOM },
        center: { x0: 8, y0: 24.5, x1: 20, y1: 31.5 },
        splitCenter: false,
        // Felső moláris: 3 gyökér, alsó: 2 gyökér.
        root: upper
          ? 'M3.8,20 L3.8,10.5 Q3.8,3.2 7,3.2 Q10,3.2 10.1,9.5 L10.3,13.5 Q11,15.2 11.7,13.5 L11.8,9.2 Q11.9,4.2 14,4.2 Q16.1,4.2 16.2,9.2 L16.3,13.5 Q17,15.2 17.7,13.5 L17.9,9.5 Q18,3.2 21,3.2 Q24.2,3.2 24.2,10.5 L24.2,20 Z'
          : 'M4.2,20 L4.2,10.5 Q4.2,3.2 8,3.2 Q11.6,3.2 11.7,9.5 L11.9,12.5 Q14,15.5 16.1,12.5 L16.3,9.5 Q16.4,3.2 20,3.2 Q23.8,3.2 23.8,10.5 L23.8,20 Z',
        rootCanalX: upper ? 7 : 8,
        apex: [upper ? 7 : 8, 3.8],
      };
  }
}

const IVORY = '#F7F5EA';
const STROKE = '#5B594F';
const CARIES_FILL = SURFACE_MARK_COLORS.caries;
const FILLING_FILL = SURFACE_MARK_COLORS.filling;
const INLAY_FILL = '#EF9F27';
const PROSTH_FILL = '#BFD9F1';
const PROSTH_STROKE = '#3E76AC';
const MISSING_FILL = '#DEDDD7';
const MISSING_STROKE = '#B9B7AE';
const IMPLANT_FILL = '#B4B2A9';
const IMPLANT_STROKE = '#5F5E5A';
const ROOT_CANAL_COLOR = '#D53A2F';
const NECROTIC_COLOR = '#534AB7';
const BRIDGE_BAR = '#35332E';
const ROMAN = ['', 'I', 'II', 'III'];

function trapezoids(box: Rect4, center: Rect4) {
  return {
    top: `M${box.x0},${box.y0} L${box.x1},${box.y0} L${center.x1},${center.y0} L${center.x0},${center.y0} Z`,
    bottom: `M${box.x0},${box.y1} L${box.x1},${box.y1} L${center.x1},${center.y1} L${center.x0},${center.y1} Z`,
    left: `M${box.x0},${box.y0} L${center.x0},${center.y0} L${center.x0},${center.y1} L${box.x0},${box.y1} Z`,
    right: `M${box.x1},${box.y0} L${center.x1},${center.y0} L${center.x1},${center.y1} L${box.x1},${box.y1} Z`,
  };
}

const FRAME_REGIONS = ['top', 'bottom', 'left', 'right'] as const satisfies readonly SurfaceRegion[];

/**
 * Kibővített találati zóna a felszín-mezőkhöz: a látható koronadoboznál nagyobb
 * dobozból ugyanazzal a szerkesztéssel képzett trapézok. Így érintéssel is
 * célozhatók a keskeny keret-mezők (a fog gyökér felőli része a vesztibuláris
 * mező találati zónája lesz) — a rajz maga változatlan.
 */
function hitGeometry(box: Rect4): Rect4 {
  return {
    x0: Math.max(0, box.x0 - 2),
    x1: Math.min(28, box.x1 + 2),
    y0: Math.max(4, box.y0 - 12),
    y1: Math.min(40, box.y1 + 3),
  };
}

function SurfaceBox({
  geo,
  fills,
  stroke,
  clipId,
  onRegionClick,
  regionTitle,
}: {
  geo: ChartGeometry;
  /** Régiónkénti kitöltés (a felszín-jelölések már fel vannak oldva). */
  fills: Record<SurfaceRegion, string>;
  stroke: string;
  clipId: string;
  onRegionClick?: (region: SurfaceRegion) => void;
  regionTitle?: (region: SurfaceRegion) => string;
}) {
  const { box, center, splitCenter } = geo;
  const t = trapezoids(box, center);
  const centerMidY = (center.y0 + center.y1) / 2;
  const interactive = !!onRegionClick;
  const titleFor = (region: SurfaceRegion) => {
    const title = regionTitle?.(region);
    return title ? <title>{title}</title> : null;
  };

  return (
    <>
      <clipPath id={clipId}>
        <rect x={box.x0} y={box.y0} width={box.x1 - box.x0} height={box.y1 - box.y0} rx={2} />
      </clipPath>
      <g clipPath={`url(#${clipId})`} pointerEvents={interactive ? 'none' : undefined}>
        {FRAME_REGIONS.map((region) => (
          <path key={region} d={t[region]} fill={fills[region]}>
            {!interactive && titleFor(region)}
          </path>
        ))}
        <rect
          x={center.x0}
          y={center.y0}
          width={center.x1 - center.x0}
          height={center.y1 - center.y0}
          fill={fills.center}
        >
          {!interactive && titleFor('center')}
        </rect>
        {/* átlós elválasztók a sarkokból a középső mezőig */}
        <g pointerEvents="none">
          <line x1={box.x0} y1={box.y0} x2={center.x0} y2={center.y0} stroke={stroke} strokeWidth="0.55" />
          <line x1={box.x1} y1={box.y0} x2={center.x1} y2={center.y0} stroke={stroke} strokeWidth="0.55" />
          <line x1={box.x0} y1={box.y1} x2={center.x0} y2={center.y1} stroke={stroke} strokeWidth="0.55" />
          <line x1={box.x1} y1={box.y1} x2={center.x1} y2={center.y1} stroke={stroke} strokeWidth="0.55" />
          {splitCenter && (
            <line x1={center.x0} y1={centerMidY} x2={center.x1} y2={centerMidY} stroke={stroke} strokeWidth="0.55" />
          )}
        </g>
      </g>
      <g pointerEvents="none">
        <rect
          x={center.x0}
          y={center.y0}
          width={center.x1 - center.x0}
          height={center.y1 - center.y0}
          fill="none"
          stroke={stroke}
          strokeWidth="0.6"
        />
        <rect
          x={box.x0}
          y={box.y0}
          width={box.x1 - box.x0}
          height={box.y1 - box.y0}
          rx={2}
          fill="none"
          stroke={stroke}
          strokeWidth="1"
        />
      </g>
      {interactive && (
        <SurfaceHitLayer
          geo={geo}
          onRegionClick={onRegionClick!}
          regionTitle={regionTitle}
        />
      )}
    </>
  );
}

/** Átlátszó, kibővített találati zónák a felszín-mezőkhöz (csak szerkesztéskor). */
function SurfaceHitLayer({
  geo,
  onRegionClick,
  regionTitle,
}: {
  geo: ChartGeometry;
  onRegionClick: (region: SurfaceRegion) => void;
  regionTitle?: (region: SurfaceRegion) => string;
}) {
  const hitBox = hitGeometry(geo.box);
  const t = trapezoids(hitBox, geo.center);
  const props = (region: SurfaceRegion) => ({
    fill: 'transparent',
    style: { cursor: 'pointer' as const },
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      onRegionClick(region);
    },
  });
  return (
    <g>
      {FRAME_REGIONS.map((region) => (
        <path key={region} d={t[region]} {...props(region)}>
          {regionTitle?.(region) && <title>{regionTitle(region)}</title>}
        </path>
      ))}
      <rect
        x={geo.center.x0}
        y={geo.center.y0}
        width={geo.center.x1 - geo.center.x0}
        height={geo.center.y1 - geo.center.y0}
        {...props('center')}
      >
        {regionTitle?.('center') && <title>{regionTitle('center')}</title>}
      </rect>
    </g>
  );
}

/** Implantátum-csavar a gyökérzónában (csúcs felfelé, "gyökér felül" orientációban). */
function ImplantScrew() {
  const cx = 14;
  const halfWidthAt = (y: number) => 1.5 + ((y - 4.5) / 15.1) * 1.5;
  return (
    <>
      <polygon
        points={`${cx - 3},19.6 ${cx + 3},19.6 ${cx + 1.5},4.5 ${cx - 1.5},4.5`}
        fill={IMPLANT_FILL}
        stroke={IMPLANT_STROKE}
        strokeWidth="0.8"
      />
      {[7, 10, 13, 16].map((y) => {
        const hw = halfWidthAt(y) + 0.9;
        return <line key={y} x1={cx - hw} y1={y} x2={cx + hw} y2={y} stroke={IMPLANT_STROKE} strokeWidth="0.7" />;
      })}
    </>
  );
}

export function ToothShapeChart({
  fdi,
  conditions,
  onSurfaceClick,
}: {
  fdi: number | string;
  conditions: ToothConditions;
  /** Ha megadva, a felszín-mezők kattinthatók (szerkesztő nézet). */
  onSurfaceClick?: (surface: SurfaceKey) => void;
}) {
  const clipId = useId();
  const group = toothGroup(fdi);
  const upper = isUpperJaw(fdi);
  const geo = chartGeometry(group, upper);
  const { base, periapical, mobility } = conditions;
  const surfaces = surfacesOf(conditions);

  const prosthetic = base === 'crown' || base === 'bridge_abutment' || base === 'bridge_pontic';
  const isBridge = base === 'bridge_abutment' || base === 'bridge_pontic';
  const noRoot = base === 'bridge_pontic';
  const stroke = prosthetic ? PROSTH_STROKE : STROKE;

  // Fog-szintű jelölők csak akkor festik az egész keretet / középső mezőt, ha
  // nincs pontosabb felszín-adat — így a régi (felszín nélküli) felvételek
  // változatlanul jelennek meg, a felszín-jelölés viszont felülírja őket.
  const cariesFallback = conditions.caries && !hasSurfaceMark(surfaces, 'caries');
  const frameFallback = cariesFallback ? CARIES_FILL : prosthetic ? PROSTH_FILL : IVORY;
  // A középső mező az alapállapotot mutatja (tömés / inlay), ha nincs rá
  // felszín-jelölés. A fog-szintű szuvas-jelző — mint korábban is — csak a
  // keretet festi, hogy megkülönböztethető maradjon a felszín-szintű adattól.
  const centerFallback = prosthetic
    ? PROSTH_FILL
    : base === 'filled'
      ? FILLING_FILL
      : base === 'inlay'
        ? INLAY_FILL
        : IVORY;

  const fillFor = (region: SurfaceRegion): string => {
    const mark = surfaces[surfaceForRegion(fdi, region)];
    if (mark) return SURFACE_MARK_COLORS[mark];
    return region === 'center' ? centerFallback : frameFallback;
  };
  const fills: Record<SurfaceRegion, string> = {
    top: fillFor('top'),
    bottom: fillFor('bottom'),
    left: fillFor('left'),
    right: fillFor('right'),
    center: fillFor('center'),
  };
  // Tooltip: szerkesztéskor minden mezőn (célzáshoz), egyébként csak a
  // megjelölt felszíneken — így az ívben nem keletkezik 160 néma <title>.
  const regionTitle = (region: SurfaceRegion) => {
    const key = surfaceForRegion(fdi, region);
    const mark = surfaces[key];
    if (!mark && !onSurfaceClick) return '';
    return `${fdi} · ${surfaceLabel(fdi, key)}${mark ? ` — ${mark === 'caries' ? 'szuvas' : 'tömött'}` : ''}`;
  };

  const canalColor = base === 'root_canal' ? ROOT_CANAL_COLOR : base === 'necrotic' ? NECROTIC_COLOR : null;

  let body: React.ReactNode;
  if (base === 'missing') {
    // Hiányzó fog: szürke anatómiai sziluett (a sematikus alak fejjel lefelé fordítva,
    // hogy a gyökér felül legyen — az egész rajzot alul úgyis tükrözzük az alsó fogaknál).
    body = (
      <g transform="translate(0,40) scale(1,-1)">
        <path d={GEO[group].out} fill={MISSING_FILL} />
        <path d={GEO[group].out} fill="none" stroke={MISSING_STROKE} strokeWidth="1" />
      </g>
    );
  } else if (base === 'impacted') {
    body = (
      <>
        <g transform="translate(0,40) scale(1,-1)">
          <path d={GEO[group].out} fill={IVORY} opacity="0.5" />
          <path d={GEO[group].out} fill="none" stroke="#9b9991" strokeWidth="1" strokeDasharray="2 1.5" />
        </g>
        {/* íny-sáv az okkluzális oldalon (nem tört elő) */}
        <rect x="3" y="33.5" width="22" height="4" rx="1.5" fill="#F4C0D1" />
      </>
    );
  } else if (base === 'root_remnant') {
    body = (
      <>
        <path d={geo.root} fill={IVORY} />
        <path d={geo.root} fill="none" stroke={STROKE} strokeWidth="1" />
        <rect
          x={geo.box.x0}
          y={geo.box.y0}
          width={geo.box.x1 - geo.box.x0}
          height={geo.box.y1 - geo.box.y0}
          rx={2}
          fill="none"
          stroke="#b9b7ae"
          strokeWidth="0.9"
          strokeDasharray="2 1.5"
        />
      </>
    );
  } else {
    body = (
      <>
        {base === 'implant' ? (
          <ImplantScrew />
        ) : (
          !noRoot && (
            <>
              <path d={geo.root} fill={prosthetic ? PROSTH_FILL : IVORY} />
              <path d={geo.root} fill="none" stroke={stroke} strokeWidth="1" />
            </>
          )
        )}
        <SurfaceBox
          geo={geo}
          fills={fills}
          stroke={stroke}
          clipId={clipId}
          onRegionClick={
            onSurfaceClick ? (region) => onSurfaceClick(surfaceForRegion(fdi, region)) : undefined
          }
          regionTitle={regionTitle}
        />
        {canalColor && (
          <line
            x1={geo.rootCanalX}
            y1={18.8}
            x2={geo.rootCanalX}
            y2={5.2}
            stroke={canalColor}
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        )}
        {periapical && (
          <>
            <circle cx={geo.apex[0]} cy={geo.apex[1]} r={3.2} fill="#E24B4A" opacity="0.35" />
            <circle cx={geo.apex[0]} cy={geo.apex[1]} r={3.2} fill="none" stroke="#A32D2D" strokeWidth="0.8" />
          </>
        )}
        {/* híd-összekötő sáv a fognyaki vonalon — a szomszédos hídtagok szegmensei
            vizuálisan összeérnek az ívben */}
        {isBridge && <rect x="0" y="18.9" width="28" height="2.2" rx="1" fill={BRIDGE_BAR} />}
      </>
    );
  }

  return (
    <>
      {/* Alsó fogaknál függőleges tükrözés: felszín-doboz felül, gyökér alul. */}
      <g transform={upper ? undefined : 'translate(0,40) scale(1,-1)'}>{body}</g>
      {base !== 'missing' && mobility > 0 && (
        <text
          x="27.5"
          y={upper ? 7 : 37.5}
          textAnchor="end"
          fontSize="6"
          fill="#993C1D"
          fontWeight="500"
        >
          {ROMAN[Math.min(3, mobility)]}
        </text>
      )}
    </>
  );
}
