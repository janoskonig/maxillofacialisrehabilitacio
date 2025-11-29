# Adatbázis Integráció Beállítása

Ez az útmutató segít Önnek összekötni a Next.js alkalmazást PostgreSQL adatbázissal.

## 1. Előfeltételek

- PostgreSQL adatbázis (helyi vagy távoli szerver)
- Adatbázis létrehozva és séma telepítve (lásd `database/schema.sql`)

## 2. Telepítés

### 2.1. Függőségek telepítése

```bash
npm install pg
npm install --save-dev @types/pg
```

### 2.2. Környezeti változók beállítása

Hozza létre a `.env.local` fájlt a projekt gyökerében:

```env
DATABASE_URL=postgresql://felhasznalonev:jelszo@localhost:5432/maxillofacial_rehab
```

**Fontos**: 
- Ha cloud adatbázist használ (pl. AWS RDS, Heroku Postgres), adjon hozzá SSL beállítást:
  ```env
  DATABASE_URL=postgresql://user:password@host:5432/database?sslmode=require
  ```
- A `.env.local` fájl NEM kerül be a Git repóba (csak `.env.example`)

## 3. Adatbázis Séma Telepítése

### 3.1. Adatbázis létrehozása

```bash
createdb maxillofacial_rehab
```

### 3.2. Séma futtatása

```bash
psql -d maxillofacial_rehab -f database/schema.sql
```

Vagy PostgreSQL klienssel:
```sql
\i database/schema.sql
```

## 4. Alkalmazás Indítása

```bash
npm run dev
```

Az alkalmazás mostantól az adatbázist használja localStorage helyett.

## 5. Tesztelés

Nyissa meg a böngésző konzolt (F12) és ellenőrizze, hogy nincsenek-e hibák. Próbáljon ki egy új beteg hozzáadását vagy keresést.

## 6. Hibaelhárítás

### "DATABASE_URL környezeti változó nincs beállítva"

- Ellenőrizze, hogy a `.env.local` fájl a projekt gyökerében van
- Biztosítsa, hogy a fájl neve pontosan `.env.local` (nem `.env`)
- Indítsa újra a Next.js fejlesztői szervert (`npm run dev`)

### Kapcsolódási hiba

- Ellenőrizze az adatbázis címet, portot, felhasználónevet és jelszót
- Győződjön meg arról, hogy a PostgreSQL szerver fut
- Ha távoli szervert használ, ellenőrizze a tűzfal beállításokat

### Tábla nem található hiba

- Futtassa a `database/schema.sql` fájlt az adatbázisban
- Ellenőrizze, hogy a táblák léteznek-e: `\dt` psql-ben

## 7. API Endpoints

Az alkalmazás a következő API végpontokat használja:

- `GET /api/patients` - Összes beteg lekérdezése
- `GET /api/patients?q=keresési_kifejezés` - Keresés
- `GET /api/patients/[id]` - Egy beteg lekérdezése
- `POST /api/patients` - Új beteg létrehozása
- `PUT /api/patients/[id]` - Beteg frissítése
- `DELETE /api/patients/[id]` - Beteg törlése

## 8. Főszereplők

### lib/db.ts
Adatbázis kapcsolat kezelése PostgreSQL Pool használatával.

### lib/storage.ts
API hívások az adatbázis műveletekhez (beteg mentés, lekérdezés, törlés).

### app/api/patients/
Next.js API route-ok, amelyek közvetlenül kommunikálnak az adatbázissal.

## 9. Migráció localStorage-ból Adatbázisba

Ha már van localStorage-ban tárolt adat:

1. Exportálja az adatokat CSV formátumban (a jelenlegi funkció működik)
2. Használja a `database/migration_from_csv.sql` fájlt referenciaként
3. Vagy használjon egy import scriptet

## 10. Production Környezet

Production környezetben:

- Használjon connection pooling-ot (már be van építve)
- Állítson be megfelelő SSL beállításokat
- Használjon környezeti változókat (pl. Vercel, Railway, stb.)
- Készítsen rendszeres backupokat






