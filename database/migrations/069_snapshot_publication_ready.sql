BEGIN;

-- Publikációs készültség a napi adat-teljességi pillanatképben.
--
-- A „research-ready" (elemzésre kész) mellé bevezetjük a szigorúbb
-- „publication-ready" szintet: elemzésre kész ÉS plauzibilitási
-- figyelmeztetés-mentes betegek száma. A korábbi napok soraiban 0 marad
-- (visszamenőleg nem számolható a pillanatnyi állapotból).

ALTER TABLE data_completeness_snapshot
  ADD COLUMN IF NOT EXISTS publication_ready INT NOT NULL DEFAULT 0;

COMMIT;
