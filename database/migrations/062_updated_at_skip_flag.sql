BEGIN;

-- Optimista zár (If-Match) token védelme a szerver-kezelte mellék-írásoktól.
--
-- A `patients` (és sok más tábla) `updated_at` oszlopát az
-- `update_updated_at_column()` BEFORE UPDATE trigger MINDEN UPDATE-nél NOW()-ra
-- állítja. A staff PatientForm ezt az `updated_at`-et használja optimista zár
-- tokenként (If-Match). Probléma: szerver-kezelte mellék-írások (kezelőorvos
-- recompute időpont/epizód hatására, kutatási hozzájárulás, intake FSM) szintén
-- írják a `patients` sort → a trigger bumpolja az `updated_at`-et → egy épp
-- nyitva tartott űrlap következő mentése 409 STALE_WRITE-ot kap, holott a
-- felhasználó által szerkesztett mezők nem változtak.
--
-- Megoldás: a trigger mostantól figyel egy TRANZAKCIÓ-LOKÁLIS GUC flagre
-- (`app.skip_updated_at = 'on'`). Ha be van állítva, NEM bumpol — így a
-- mellék-írás megőrzi a token-időbélyeget. A felhasználói mentés-folyam soha
-- nem állítja a flaget, így az normálisan bumpol. A flaget a mellék-írások a
-- saját UPDATE-jük WHERE-ágában állítják be `set_config(...,true)`-val, ami
-- garantáltan ugyanabban a statementben, a trigger lefutása előtt érvényesül.
--
-- A változás visszafelé kompatibilis: a flag hiányában (a hívások 99%-a) a
-- viselkedés változatlan (NOW()-ra bumpol). A függvény több tábla triggere is
-- — egyik másik tábla sem állítja a flaget, így azok érintetlenek.

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    -- Szerver-kezelte mellék-írás: őrizzük meg az optimista zár tokenjét.
    IF current_setting('app.skip_updated_at', true) = 'on' THEN
        RETURN NEW;
    END IF;
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';

COMMIT;
