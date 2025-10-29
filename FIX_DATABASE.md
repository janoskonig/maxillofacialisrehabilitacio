# Adatbázis Létrehozása

A hiba oka: az adatbázis `maxfac_main` nem létezik.

## Megoldás 1: Adatbázis létrehozása psql-lel

Kapcsolódj a PostgreSQL szerverre és hozd létre az adatbázist:

```bash
# ⚠️ FIGYELEM: Cseréld ki HOST és USERNAME értékeket!
psql -h HOST -p 5432 -U USERNAME -d postgres
```

A psql-ben futtasd:

```sql
CREATE DATABASE maxfac_main;
\c maxfac_main
\i database/schema.sql
\q
```

## Megoldás 2: Egyetlen parancsban

```bash
# ⚠️ FIGYELEM: Használd a saját adatbázis hitelesítő adataidat!
psql "postgresql://USERNAME:PASSWORD@HOST:5432/postgres" -c "CREATE DATABASE maxfac_main;"
```

Ezután telepítsd a sémát:

```bash
# ⚠️ FIGYELEM: Cseréld ki USERNAME, PASSWORD, HOST értékeket!
psql "postgresql://USERNAME:PASSWORD@HOST:5432/maxfac_main" -f database/schema.sql
```

## Ellenőrzés

Ellenőrizd, hogy létrejött-e:

```bash
# ⚠️ FIGYELEM: Cseréld ki USERNAME, PASSWORD, HOST értékeket!
psql "postgresql://USERNAME:PASSWORD@HOST:5432/maxfac_main" -c "\dt"
```

Ez ki kellene listázza a `patients` táblát.

## Ha nincs jogosultság

Ha nincs jogosultságod adatbázist létrehozni, kérj segítséget a rendszergazdától, vagy használj egy már létező adatbázist.

