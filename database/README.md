# Adatbázis Dokumentáció

Ez a mappa tartalmazza az SQL adatbázis sémáját a maxillofacialis rehabilitációs betegadat kezelő rendszerhez.

## Fájlok

- `schema.sql` - Fő adatbázis séma (egyszerűsített, egy táblás struktúra)
- `schema_normalized.sql` - Normalizált séma (külön táblák az implantátumokhoz)

## Adatbázis Telepítés

### PostgreSQL használata

1. **Hozza létre az adatbázist:**
   ```bash
   createdb maxillofacial_rehab
   ```

2. **Futtassa a sémát:**
   ```bash
   psql -d maxillofacial_rehab -f database/schema.sql
   ```

   Vagy interaktívan:
   ```bash
   psql -d maxillofacial_rehab
   \i database/schema.sql
   ```

### Kapcsolati String Példa

```env
DATABASE_URL=postgresql://felhasznalonev:jelszo@localhost:5432/maxillofacial_rehab
```

## Táblák Struktúrája

### `patients` tábla

A fő tábla, ami tartalmazza az összes betegadatot:

- **Alapadatok**: név, TAJ, telefonszám
- **Személyes adatok**: születési dátum, nem, email, cím
- **Beutaló információk**: beutaló orvos, intézmény, műtét részletek
- **Adjuváns terápiák**: radioterápia, kemoterápia
- **Rehabilitációs adatok**: anamnézis, betegvizsgálat eredmények
- **Implantátumok**: JSON formátumban tárolva (`meglevo_implantatumok`)

### Indexek

A következő mezőkön vannak indexek a gyors kereséshez:
- `nev` - név szerinti keresés
- `taj` - TAJ szám szerinti keresés
- `email` - email szerinti keresés
- `telefonszam` - telefonszám szerinti keresés
- `beutalo_orvos` - beutaló orvos szerinti keresés
- `kezeleoorvos` - kezelőorvos szerinti keresés
- `created_at` - dátum szerinti szűréshez
- `meglevo_implantatumok` - JSON mező (GIN index)

## Implantátumok Tárolása

Az implantátumokat JSON formátumban tároljuk a `meglevo_implantatumok` mezőben:

```json
{
  "18": "Straumann BLT 4.1x10mm, Gyári szám: 028.015, Dátum: 2023.05.15",
  "17": "Nobel Biocare 4.0x10mm, Gyári szám: 12345, Dátum: 2023.06.20"
}
```

A kulcs a fog száma (Zsigmondy-kereszt), az érték pedig a részletes információk szövege.

## Automatikus Frissítések

A táblához trigger tartozik, ami automatikusan frissíti az `updated_at` mezőt, amikor egy rekord módosul.

## Keresési Példák

### Név szerinti keresés
```sql
SELECT * FROM patients WHERE nev ILIKE '%Kovács%';
```

### TAJ szám szerinti keresés
```sql
SELECT * FROM patients WHERE taj = '123456789';
```

### Kezelőorvos szerinti szűrés
```sql
SELECT * FROM patients WHERE kezeleoorvos = 'Dr. König';
```

### Implantátumok keresése JSON mezőben
```sql
-- Keressünk betegeket, akiknek van implantátuma az 18-as fogban
SELECT * FROM patients 
WHERE meglevo_implantatumok ? '18';
```

### Dátum szerinti szűrés
```sql
-- Betegek, akiket 2024-ben vettek fel
SELECT * FROM patients 
WHERE EXTRACT(YEAR FROM felvetel_datuma) = 2024;
```

## Next.js Integráció

Az adatbázis használatához telepíteni kell a PostgreSQL klienset:

```bash
npm install pg
npm install --save-dev @types/pg
```

Vagy Prisma ORM használata esetén:

```bash
npm install prisma @prisma/client
npx prisma init
```

## Jövőbeli Fejlesztések

- [ ] Normalizált séma bevezetése (külön táblák implantátumokhoz)
- [ ] Audit log tábla hozzáadása
- [ ] Felhasználói autentikáció táblák
- [ ] Biztonsági mentés automatizálása
- [ ] Adatbázis migrációs scriptek



