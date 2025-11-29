# 🗄️ Adatbázis Összekötés - Rövid Útmutató

## Gyors beállítás

### 1️⃣ Függőségek telepítése
```bash
npm install
```

### 2️⃣ .env.local fájl létrehozása
Hozza létre a `.env.local` fájlt a projekt gyökerében:

```env
DATABASE_URL=postgresql://felhasznalonev:jelszo@localhost:5432/maxillofacial_rehab
```

**Példák:**
- Helyi adatbázis: `postgresql://postgres:jelszo123@localhost:5432/maxillofacial_rehab`
- Cloud (SSL-lel): `postgresql://user:pass@host:5432/db?sslmode=require`

### 3️⃣ Adatbázis séma telepítése
```bash
# Adatbázis létrehozása
createdb maxillofacial_rehab

# Séma telepítése
psql -d maxillofacial_rehab -f database/schema.sql
```

### 4️⃣ Alkalmazás indítása
```bash
npm run dev
```

## ✅ Hogyan működik?

### Architektúra

```
Frontend (React)
    ↓ HTTP kérések
API Routes (/app/api/patients)
    ↓ PostgreSQL Pool
PostgreSQL Adatbázis
```

### Fő fájlok

1. **`lib/db.ts`** - Adatbázis kapcsolat kezelése
2. **`lib/storage.ts`** - API hívások (régen localStorage)
3. **`app/api/patients/route.ts`** - Beteg műveletek API végpontjai
4. **`app/api/patients/[id]/route.ts`** - Egy beteg műveletei

### API Endpoints

- `GET /api/patients` - Összes beteg
- `GET /api/patients?q=keresés` - Keresés
- `POST /api/patients` - Új beteg
- `PUT /api/patients/[id]` - Beteg frissítése
- `DELETE /api/patients/[id]` - Beteg törlése

## 🔍 Hibakeresés

### Hiba: "DATABASE_URL környezeti változó nincs beállítva"

**Megoldás:**
1. Ellenőrizze, hogy `.env.local` fájl létezik-e a projekt gyökerében
2. Indítsa újra a fejlesztői szervert (`npm run dev`)

### Hiba: Kapcsolódási hiba

**Megoldás:**
1. Ellenőrizze, hogy fut-e a PostgreSQL:
   ```bash
   psql -U postgres -c "SELECT version();"
   ```
2. Ellenőrizze a kapcsolati stringet (felhasználónév, jelszó, host, port, adatbázis név)
3. Ha távoli szerver, ellenőrizze a tűzfal beállításokat

### Hiba: "tábla nem található"

**Megoldás:**
```bash
psql -d maxillofacial_rehab -f database/schema.sql
```

## 📚 További információk

- Részletes dokumentáció: `DATABASE_SETUP.md`
- SQL példák: `database/examples.sql`
- Adatbázis séma: `database/schema.sql`






