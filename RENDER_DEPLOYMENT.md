# Render Deployment Guide

Ez az útmutató segít Önnek telepíteni a Maxillofacialis Rehabilitáció alkalmazást a Render platformon.

## Előfeltételek

1. **GitHub Repository**: Az alkalmazás forráskódjának egy GitHub repository-ban kell lennie
2. **Render Account**: Hozzon létre egy ingyenes Render account-ot a [render.com](https://render.com)-n
3. **GitHub Connection**: Csatlakoztassa a GitHub fiókját a Render-hez

## Telepítési Lépések

### 1. Git Repository Előkészítése

Mielőtt elkezdené, győződjön meg arról, hogy minden változás commitolva van és push-olva a GitHub repository-ba:

```bash
git add .
git commit -m "Prepare for Render deployment"
git push origin main
```

### 2. Adatbázis Létrehozása a Render-en

#### Opció A: Automatikus Létrehozás (render.yaml használatával)

Ha a `render.yaml` fájlt használja, akkor a Render automatikusan létrehozza az adatbázist a web service-szel együtt.

#### Opció B: Manuális Létrehozás

1. Lépjen be a [Render Dashboard](https://dashboard.render.com)-ba
2. Kattintson a **"New +"** gombra
3. Válassza a **"PostgreSQL"** opciót
4. Adja meg a következő információkat:
   - **Name**: `maxillofacial-rehab-db`
   - **Database**: `maxillofacial_rehab`
   - **User**: `maxillofacial_rehab_user`
   - **Region**: Válasszon egy közeli régiót
   - **PostgreSQL Version**: `15` vagy újabb (ajánlott)
   - **Plan**: Ingyenes vagy fizetős (ajánlott Production esetén)
5. Kattintson a **"Create Database"** gombra
6. Várjon, amíg az adatbázis létrejön (1-2 perc)
7. Az adatbázis létrejöttét követően:
   - Lépjen az adatbázis részleteihez
   - Másolja ki a **"Internal Database URL"** vagy **"External Database URL"** értékét
   - Ez lesz a `DATABASE_URL` környezeti változó értéke

### 3. Adatbázis Séma Telepítése

Az adatbázis létrejöttét követően telepítenie kell a sémát.

#### Válasszon egyet az alábbi módszerek közül:

#### Módszer 1: Render Dashboard SQL Editor (Egyszerű)

1. Lépjen az adatbázis részleteihez a Render Dashboard-ban
2. Kattintson a **"Connect"** fülre
3. Válassza a **"psql"** vagy **"SQL Editor"** opciót
4. Nyissa meg a `database/schema.sql` fájlt lokálisan
5. Másolja ki a teljes tartalmat
6. Illessze be a SQL Editor-ba
7. Kattintson a **"Run"** gombra

#### Módszer 2: psql Parancssor (Speciális)

1. Használja az adatbázis **External Connection String** értékét
2. Futtassa lokálisan:
   ```bash
   psql "<EXTERNAL_DATABASE_URL>" -f database/schema.sql
   ```
   Vagy:
   ```bash
   cat database/schema.sql | psql "<EXTERNAL_DATABASE_URL>"
   ```

#### Módszer 3: Render Shell (Ha elérhető)

1. Lépjen az adatbázis részleteihez
2. Nyissa meg a Shell opciót
3. Futtassa:
   ```bash
   psql -d maxillofacial_rehab -f database/schema.sql
   ```

### 4. Web Service Létrehozása

#### Opció A: Automatikus (render.yaml használatával)

1. Lépjen a [Render Dashboard](https://dashboard.render.com)-ba
2. Kattintson a **"New +"** gombra
3. Válassza a **"Blueprint"** opciót
4. Csatlakoztassa a GitHub repository-t
5. Render automatikusan felismeri a `render.yaml` fájlt
6. Kattintson a **"Apply"** gombra
7. Render automatikusan létrehozza mindkét szolgáltatást (web és database)

#### Opció B: Manuális Létrehozás

1. Lépjen a [Render Dashboard](https://dashboard.render.com)-ba
2. Kattintson a **"New +"** gombra
3. Válassza a **"Web Service"** opciót
4. Csatlakoztassa a GitHub repository-t
5. Adja meg a következő információkat:
   - **Name**: `maxillofacial-rehab`
   - **Region**: Ugyanazt, mint az adatbázisnál
   - **Branch**: `main` (vagy az alapértelmezett branch)
   - **Root Directory**: (hagyja üresen, ha a root-ban van)
   - **Runtime**: `Node`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Plan**: Ingyenes vagy fizetős

6. **Environment Variables** beállítása:
   - Kattintson az **"Environment"** fülre
   - Adja hozzá a következő változókat:
     - **Key**: `NODE_ENV` → **Value**: `production`
     - **Key**: `DATABASE_URL` → **Value**: (az adatbázis Internal Database URL-je)

     **Fontos**: Használja az adatbázis **Internal Database URL**-jét, mert a web service és az adatbázis ugyanazon a hálózaton van, és ingyenes belső forgalommal kommunikál.

7. Kattintson a **"Create Web Service"** gombra

### 5. Várakozás és Ellenőrzés

1. Várjon, amíg a Render telepíti az alkalmazást (5-10 perc az első alkalommal)
2. Figyelje a build logokat:
   - Kattintson a web service-re
   - Lépjen a **"Logs"** fülre
   - Ellenőrizze, hogy nincsenek-e build hibák
3. Az alkalmazás sikeres telepítése után:
   - Az URL formátuma: `https://maxillofacial-rehab.onrender.com`
   - Nyissa meg az URL-t a böngészőben

### 6. Alkalmazás Tesztelése

1. Nyissa meg a Render által biztosított URL-t
2. Tesztelje a bejelentkezést:
   - **Email**: (A `NEXT_PUBLIC_ADMIN_EMAIL` környezeti változóból, vagy alapértelmezett)
   - **Password**: (A `NEXT_PUBLIC_ADMIN_PASSWORD` környezeti változóból, vagy alapértelmezett)
   
   **Fontos**: Állítsa be a `NEXT_PUBLIC_ADMIN_EMAIL` és `NEXT_PUBLIC_ADMIN_PASSWORD` környezeti változókat a Render Dashboard-on a biztonság érdekében!
3. Próbáljon ki:
   - Új beteg hozzáadását
   - Keresést
   - Beteg módosítását
   - Beteg törlését

## Környezeti Változók

A következő környezeti változókat kell beállítani a Render-en:

### Kötelező

- **NODE_ENV**: `production`
- **DATABASE_URL**: PostgreSQL connection string (Render automatikusan generálja)

### Ajánlott (Biztonság)

- **NEXT_PUBLIC_ADMIN_EMAIL**: Admin felhasználó email címe a bejelentkezéshez
- **NEXT_PUBLIC_ADMIN_PASSWORD**: Admin felhasználó jelszava a bejelentkezéshez

**Fontos**: Ha ezeket nem állítja be, az alapértelmezett értékek lesznek (`admin@example.com` / `changeme`), ami **nem biztonságos production környezetben!**

### Email Konfiguráció (Spam Szűrés Optimalizálás)

Az email küldéshez és a spam mappába kerülés elkerüléséhez az alábbi környezeti változókat kell beállítani:

- **SMTP_HOST**: SMTP szerver címe (pl. `smtp.gmail.com`, `smtp.sendgrid.net`)
- **SMTP_PORT**: SMTP port (általában `587` TLS-hez vagy `465` SSL-hez)
- **SMTP_USER**: SMTP felhasználónév (email cím vagy API kulcs)
- **SMTP_PASS**: SMTP jelszó vagy API kulcs
- **SMTP_FROM**: Küldő email cím (pl. `noreply@example.com`)
- **SMTP_FROM_NAME**: Küldő neve (opcionális, alapértelmezett: "Maxillofaciális Rehabilitáció Rendszer")
- **SMTP_REPLY_TO**: Reply-To cím (opcionális, alapértelmezett: ugyanaz, mint SMTP_FROM)

**Spam szűrés optimalizálás javaslatok:**
1. **SPF/DKIM/DMARC beállítása**: Állítsa be a domain DNS rekordjait (SPF, DKIM, DMARC) az email szolgáltatónál
2. **Reply-To cím**: Mindig legyen beállítva egy valós, válaszolható email cím
3. **From cím formátum**: Használjon "Név <email@domain.com>" formátumot
4. **Text verzió**: Az alkalmazás automatikusan generál plain text verziót minden emailhez
5. **Megbízható SMTP szolgáltató**: Használjon megbízható email szolgáltatót (Gmail, SendGrid, Mailgun, stb.)

**Példa Gmail SMTP konfigurációhoz:**
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=your-email@gmail.com
SMTP_FROM_NAME=Maxillofaciális Rehabilitáció Rendszer
SMTP_REPLY_TO=support@yourdomain.com
```

**Megjegyzés**: Gmail esetén App Password-ot kell használni, nem a normál jelszót. További információ: [Google App Passwords](https://support.google.com/accounts/answer/185833)

### Opcionális

- Bármilyen egyéb környezeti változó, amit az alkalmazás használ

## Render Dashboard Hozzáférés

A telepítés után a következő helyeken érheti el az alkalmazást:

- **Dashboard**: [dashboard.render.com](https://dashboard.render.com)
- **Web Service**: Automatikusan generált URL (pl. `https://maxillofacial-rehab.onrender.com`)
- **Database**: Render Dashboard → PostgreSQL → Maxillofacial-rehab-db

## Frissítés és Újratelepítés

### Új Verzió Deploy-olása

1. Commitolja és push-olja a változásokat a GitHub-ra:
   ```bash
   git add .
   git commit -m "Deploy updates"
   git push origin main
   ```

2. A Render automatikusan újra buildel és deployol (ha az Auto-Deploy engedélyezve van)

### Manuális Újratelepítés

1. Lépjen a web service részleteihez a Render Dashboard-ban
2. Kattintson a **"Manual Deploy"** gombra
3. Válassza a **"Deploy latest commit"** opciót

## Troubleshooting (Hibaelhárítás)

### Build Hiba

- **Hiba**: `npm install` sikertelen
- **Megoldás**: Ellenőrizze, hogy az összes függőség a `package.json`-ban szerepel-e

### Database Connection Hiba

- **Hiba**: `DATABASE_URL környezeti változó nincs beállítva`
- **Megoldás**: 
  - Ellenőrizze a Render Dashboard-ban, hogy a `DATABASE_URL` be van-e állítva
  - Használja az adatbázis **Internal Database URL**-jét

- **Hiba**: `Connection timeout` vagy `SSL error`
- **Megoldás**: 
  - Használja az **Internal Database URL**-t (nem az External-t)
  - Az Internal URL ingyenes és gyorsabb
  - Az External URL fizetős adatforgalmat használ

### Schema Hiba

- **Hiba**: `relation "patients" does not exist`
- **Megoldás**: Futtassa a `database/schema.sql` fájlt az adatbázisban

### SSL Hiba

- **Hiba**: `SSL connection required`
- **Megoldás**: A `lib/db.ts` már automatikusan kezeli az SSL-t Render PostgreSQL adatbázisokhoz

### Slow Performance (Lassú Teljesítmény)

- **Megoldás**: 
  - Az ingyenes Render csomagnál az alkalmazás "sleep mode"-ba megy, ha nincs használatban
  - Az első kérés után 30-60 másodperc szükséges a felkeléshez
  - Fizetős csomagnál ez a probléma nem jelentkezik

## Render Free Tier Korlátok

Az ingyenes Render csomag korlátai:
- **Sleep Mode**: Az alkalmazás 15 perc inaktivitás után leáll
- **Build Time**: 500 build perc/hó
- **Bandwidth**: 100 GB/hó
- **Database**: 1 PostgreSQL adatbázis (256 MB RAM, 1 GB storage)

## Production Ajánlások

Éles környezetben érdemes:
1. **Fizetős Plan**: Stable performance és nincs sleep mode
2. **Custom Domain**: Saját domain használata
3. **SSL Certificate**: Render automatikusan biztosít SSL-t
4. **Database Backups**: Render automatikus backup-okat készít (fizetős csomagoknál)
5. **Monitoring**: Használjon monitoring eszközöket
6. **Environment Variables Security**: Ne commitoljon bizalmas adatokat a kódba

## További Segítség

- **Render Dokumentáció**: [render.com/docs](https://render.com/docs)
- **Next.js Deploy Guide**: [nextjs.org/docs/deployment](https://nextjs.org/docs/deployment)
- **Render Support**: [community.render.com](https://community.render.com)

## Gyors Ellenőrzőlista

- [ ] GitHub repository létrehozva és push-olva
- [ ] Render account létrehozva
- [ ] PostgreSQL adatbázis létrehozva a Render-en
- [ ] Adatbázis séma telepítve (`database/schema.sql`)
- [ ] Web service létrehozva
- [ ] Környezeti változók beállítva (`NODE_ENV`, `DATABASE_URL`)
- [ ] Build sikeres
- [ ] Alkalmazás elérhető és működik
- [ ] Bejelentkezés működik
- [ ] Betegadatok mentése működik

---

**Készítve**: Render Deployment Helper  
**Dátum**: 2024  
**Verzió**: 1.0

