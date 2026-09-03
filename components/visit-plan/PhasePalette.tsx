'use client';

/**
 * Bal hasáb: generikus munkafázis-paletta. Kattintás → a fázis az aktív
 * alkalomba kerül (nincs alkalom → új alkalom); húzás → bármelyik alkalomba
 * vagy az „Új alkalom" zónába. Kereséssel a teljes katalógus elérhető
 * (sablon-specifikus kódok címke szerint egyszer), alul egyedi (szabad
 * szöveges) fázis és a beteg fogkezelési igényei.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Search, Plus, Layers, Loader2, GripVertical, MoreHorizontal, Star, StarOff, Clock3, Check } from 'lucide-react';
import { useDraggable } from '@dnd-kit/core';
import { Popover, MenuItem, MenuHeading } from './Popover';
import { searchCatalog, type LinkedToothTreatment, type PaletteItem } from './visit-plan-types';

export interface PhasePaletteProps {
  catalog: PaletteItem[];
  toothTreatments: LinkedToothTreatment[];
  onAddCatalog: (item: PaletteItem) => void;
  onAddFreeText: (label: string, opts?: { saveToPalette?: boolean }) => void;
  onAddTooth: (tt: LinkedToothTreatment) => void;
  /** Paletta-karbantartás („sablonok"): felvétel / levétel / időtartam. Nincs → nincs menü. */
  onUpdateCatalogItem?: (
    stepCode: string,
    patch: { paletteOrder?: number | null; defaultDurationMinutes?: number | null }
  ) => void;
  /** Következő szabad paletta-sorszám a felvételhez. */
  nextPaletteOrder?: number;
  /** undefined → a gomb nem jelenik meg (nincs sablon az epizódon). */
  onApplyTemplate?: () => void;
  templateBusy?: boolean;
  /** „→ 2. alkalom" — hova kerül a kattintással hozzáadott fázis. */
  targetHint: string;
  dragEnabled: boolean;
  disabled?: boolean;
}

function PaletteEntry({
  item, onAdd, dragEnabled, disabled, onUpdate, nextPaletteOrder,
}: {
  item: PaletteItem;
  onAdd: () => void;
  dragEnabled: boolean;
  disabled?: boolean;
  onUpdate?: (patch: { paletteOrder?: number | null; defaultDurationMinutes?: number | null }) => void;
  nextPaletteOrder: number;
}) {
  const [durationDraft, setDurationDraft] = useState<string>('');
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } =
    useDraggable({
      id: `palette:${item.stepCode}`,
      data: { type: 'palette', stepCode: item.stepCode },
      disabled: !dragEnabled || disabled,
    });
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
    position: 'relative',
  };
  const isGeneric = item.paletteOrder != null;
  return (
    <div ref={setNodeRef} style={style} className="group flex items-stretch rounded-md hover:bg-white dark:hover:bg-gray-800 hover:shadow-sm transition-all">
      {dragEnabled && (
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          tabIndex={-1}
          disabled={disabled}
          aria-label={`${item.labelHu} húzása alkalomba`}
          className="touch-none px-1 text-gray-300 dark:text-gray-600 group-hover:text-gray-400 cursor-grab active:cursor-grabbing shrink-0 rounded-l-md"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </button>
      )}
      <button
        type="button"
        onClick={onAdd}
        disabled={disabled}
        title={isGeneric ? 'Hozzáadás az aktív alkalomhoz' : `Sablon-fázis (${item.stepCode}) hozzáadása`}
        className="flex-1 min-w-0 text-left flex items-center gap-2 pr-2 py-1.5 text-sm disabled:opacity-50"
      >
        <Plus className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 group-hover:text-medical-primary shrink-0" />
        <span className={`truncate ${isGeneric ? 'font-medium text-gray-800 dark:text-gray-200' : 'text-gray-600 dark:text-gray-400'} group-hover:text-medical-primary`}>
          {item.labelHu}
        </span>
        {item.defaultDurationMinutes != null && (
          <span className="ml-auto text-[11px] text-gray-400 dark:text-gray-500 shrink-0 tabular-nums">
            {item.defaultDurationMinutes}′
          </span>
        )}
      </button>
      {onUpdate && (
        <Popover
          align="right"
          widthClass="w-60"
          disabled={disabled}
          triggerAriaLabel={`${item.labelHu} — sablon beállításai`}
          triggerTitle="Sablon beállításai (paletta)"
          triggerClassName="shrink-0 px-1 text-gray-300 dark:text-gray-600 group-hover:text-gray-500 hover:!text-medical-primary rounded-r-md"
          trigger={<MoreHorizontal className="w-3.5 h-3.5" />}
        >
          {(close) => (
            <div>
              <MenuHeading>{item.labelHu}</MenuHeading>
              {isGeneric ? (
                <>
                  <form
                    className="flex items-center gap-1 px-2 py-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const n = parseInt(durationDraft, 10);
                      if (Number.isInteger(n) && n >= 5) {
                        onUpdate({ defaultDurationMinutes: n });
                        setDurationDraft('');
                        close();
                      }
                    }}
                  >
                    <Clock3 className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    <input
                      type="number"
                      min={5}
                      step={5}
                      value={durationDraft}
                      onChange={(e) => setDurationDraft(e.target.value)}
                      placeholder={String(item.defaultDurationMinutes ?? 30)}
                      aria-label="Alap időtartam percben"
                      className="w-16 text-xs border border-gray-300 dark:border-gray-700 rounded px-1.5 py-1 text-center bg-white dark:bg-gray-900"
                    />
                    <span className="text-xs text-gray-500 dark:text-gray-400">perc</span>
                    <button type="submit" className="ml-auto inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-medical-primary hover:bg-medical-primary/10 rounded">
                      <Check className="w-3 h-3" /> OK
                    </button>
                  </form>
                  <MenuItem tone="danger" onClick={() => { onUpdate({ paletteOrder: null }); close(); }}>
                    <StarOff className="w-3.5 h-3.5" /> Levétel a palettáról
                  </MenuItem>
                </>
              ) : (
                <MenuItem tone="primary" onClick={() => { onUpdate({ paletteOrder: nextPaletteOrder }); close(); }}>
                  <Star className="w-3.5 h-3.5" /> Felvétel a palettára (sablon)
                </MenuItem>
              )}
            </div>
          )}
        </Popover>
      )}
    </div>
  );
}

function ToothEntry({
  tt, onAdd, dragEnabled, disabled,
}: {
  tt: LinkedToothTreatment;
  onAdd: () => void;
  dragEnabled: boolean;
  disabled?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `tooth:${tt.id}`,
    data: { type: 'tooth', toothTreatmentId: tt.id },
    disabled: !dragEnabled || disabled,
  });
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
    position: 'relative',
  };
  // Húzás után a felengedésre eső click ne adjon hozzá még egyet.
  const draggedRef = useRef(false);
  useEffect(() => {
    if (isDragging) draggedRef.current = true;
  }, [isDragging]);
  const { onKeyDown: _ignoredKeyDown, ...pointerListeners } = (listeners ?? {}) as Record<string, unknown>;
  return (
    <button
      ref={setNodeRef}
      style={style}
      type="button"
      onClick={() => {
        if (draggedRef.current) {
          draggedRef.current = false;
          return;
        }
        onAdd();
      }}
      disabled={disabled}
      {...attributes}
      {...pointerListeners}
      className="touch-none inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-900/40 transition-colors disabled:opacity-50"
      title="Fogkezelés hozzáadása az aktív alkalomhoz"
    >
      🦷 {tt.labelHu} · {tt.toothNumber}
    </button>
  );
}

export function PhasePalette({
  catalog, toothTreatments, onAddCatalog, onAddFreeText, onAddTooth,
  onUpdateCatalogItem, nextPaletteOrder,
  onApplyTemplate, templateBusy, targetHint, dragEnabled, disabled,
}: PhasePaletteProps) {
  const [query, setQuery] = useState('');
  const [freeLabel, setFreeLabel] = useState('');
  const [saveToPalette, setSaveToPalette] = useState(false);
  const computedNextOrder = useMemo(
    () => nextPaletteOrder ?? Math.max(0, ...catalog.map((c) => c.paletteOrder ?? 0)) + 10,
    [catalog, nextPaletteOrder]
  );
  const entries = useMemo(() => searchCatalog(catalog, query), [catalog, query]);
  const searching = query.trim().length > 0;

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && entries.length > 0) {
      e.preventDefault();
      onAddCatalog(entries[0]);
      setQuery('');
    }
  };

  return (
    <aside
      className="flex flex-col rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-800/40 md:sticky md:top-20 md:max-h-[calc(100vh-6rem)]"
      aria-label="Kezelések palettája"
      data-testid="phase-palette"
    >
      <div className="px-3 pt-3 pb-2">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Kezelések</h4>
          <span className="text-[11px] text-gray-500 dark:text-gray-400 truncate" title="Kattintás ide teszi a fázist">
            {targetHint}
          </span>
        </div>
        <div className="relative mt-2">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
            placeholder="Keresés… (Enter = első találat)"
            aria-label="Kezelés keresése"
            className="w-full pl-8 pr-2 py-1.5 text-sm border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900"
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 space-y-0.5">
        {entries.length === 0 ? (
          <p className="text-xs text-gray-500 dark:text-gray-400 py-3 text-center">
            Nincs találat — alább egyedi fázisként felvehető.
          </p>
        ) : (
          entries.map((item) => (
            <PaletteEntry
              key={item.stepCode}
              item={item}
              onAdd={() => {
                onAddCatalog(item);
                if (searching) setQuery('');
              }}
              dragEnabled={dragEnabled}
              disabled={disabled}
              onUpdate={onUpdateCatalogItem ? (patch) => onUpdateCatalogItem(item.stepCode, patch) : undefined}
              nextPaletteOrder={computedNextOrder}
            />
          ))
        )}
        {searching && entries.some((i) => i.paletteOrder == null) && (
          <p className="text-[11px] text-gray-400 dark:text-gray-500 px-2 pt-1">
            A halványabb tételek sablon-specifikus fázisok.
          </p>
        )}
      </div>

      <div className="border-t border-gray-200 dark:border-gray-800 px-3 py-2 space-y-2">
        <form
          className="space-y-1"
          onSubmit={(e) => {
            e.preventDefault();
            const label = freeLabel.trim();
            if (!label) return;
            onAddFreeText(label, { saveToPalette });
            setFreeLabel('');
          }}
        >
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={freeLabel}
              onChange={(e) => setFreeLabel(e.target.value)}
              placeholder="Egyedi fázis… (Enter)"
              aria-label="Egyedi munkafázis megnevezése"
              disabled={disabled}
              className="flex-1 min-w-0 text-sm border border-gray-300 dark:border-gray-700 rounded-md px-2 py-1.5 bg-white dark:bg-gray-900"
            />
            <button
              type="submit"
              disabled={disabled || !freeLabel.trim()}
              aria-label="Egyedi fázis hozzáadása"
              className="p-1.5 rounded-md text-medical-primary hover:bg-medical-primary/10 disabled:opacity-40"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
          {onUpdateCatalogItem && (
            <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={saveToPalette}
                onChange={(e) => setSaveToPalette(e.target.checked)}
                className="w-3.5 h-3.5 accent-medical-primary"
              />
              Mentés a palettára is (sablon minden beteghez)
            </label>
          )}
        </form>

        {toothTreatments.length > 0 && (
          <div>
            <p className="text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">
              Fogkezelési igények
            </p>
            <div className="flex flex-wrap gap-1">
              {toothTreatments.map((tt) => (
                <ToothEntry
                  key={tt.id}
                  tt={tt}
                  onAdd={() => onAddTooth(tt)}
                  dragEnabled={dragEnabled}
                  disabled={disabled}
                />
              ))}
            </div>
          </div>
        )}

        {onApplyTemplate && (
          <button
            type="button"
            onClick={onApplyTemplate}
            disabled={disabled || templateBusy}
            className="w-full inline-flex items-center justify-center gap-1.5 px-2 py-1.5 border border-dashed border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 rounded-md text-xs hover:border-medical-primary hover:text-medical-primary transition-colors disabled:opacity-50"
            title="A kiválasztott sablon munkafázisainak beszúrása — a terv utána szabadon alakítható"
          >
            {templateBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Layers className="w-3.5 h-3.5" />}
            Feltöltés sablonból
          </button>
        )}
      </div>
    </aside>
  );
}
