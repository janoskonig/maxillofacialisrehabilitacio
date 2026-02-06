import { NextRequest, NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { verifyAuth } from '@/lib/auth-server';
import { generateEquityRequestPDF } from '@/lib/pdf/equity-request';
import { Patient, patientSchema } from '@/lib/types';
import { uploadFile, isFtpConfigured, generateDocumentFilename } from '@/lib/ftp-client';
import { logActivity } from '@/lib/activity';

/**
 * Méltányossági kérelem PDF generálása beteg adataiból
 */
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Hitelesítés ellenőrzése
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Bejelentkezés szükséges' },
        { status: 401 }
      );
    }

    // Jogosultság ellenőrzése - csak admin, editor és sebészorvos
    if (auth.role !== 'admin' && auth.role !== 'editor' && auth.role !== 'sebészorvos') {
      return NextResponse.json(
        { error: 'Nincs jogosultsága PDF generáláshoz' },
        { status: 403 }
      );
    }

    const pool = getDbPool();
    const patientId = params.id;

    // Beteg adatainak lekérdezése
    const result = await pool.query(
      `SELECT 
        id, nev, taj, telefonszam, szuletesi_datum as "szuletesiDatum", nem,
        email, cim, varos, iranyitoszam, beutalo_orvos as "beutaloOrvos",
        beutalo_intezmeny as "beutaloIntezmeny", beutalo_indokolas as "beutaloIndokolas",
        primer_mutet_leirasa as "primerMutetLeirasa",
        mutet_ideje as "mutetIdeje", szovettani_diagnozis as "szovettaniDiagnozis",
        nyaki_blokkdisszekcio as "nyakiBlokkdisszekcio", alkoholfogyasztas,
        dohanyzas_szam as "dohanyzasSzam", kezelesre_erkezes_indoka as "kezelesreErkezesIndoka", 
        maxilladefektus_van as "maxilladefektusVan",
        brown_fuggoleges_osztaly as "brownFuggolegesOsztaly",
        brown_vizszintes_komponens as "brownVizszintesKomponens",
        mandibuladefektus_van as "mandibuladefektusVan",
        kovacs_dobak_osztaly as "kovacsDobakOsztaly",
        nyelvmozgasok_akadalyozottak as "nyelvmozgásokAkadályozottak",
        gombocos_beszed as "gombocosBeszed", nyalmirigy_allapot as "nyalmirigyAllapot",
        fabian_fejerdy_protetikai_osztaly_felso as "fabianFejerdyProtetikaiOsztalyFelso",
        fabian_fejerdy_protetikai_osztaly_also as "fabianFejerdyProtetikaiOsztalyAlso",
        radioterapia, radioterapia_dozis as "radioterapiaDozis",
        radioterapia_datum_intervallum as "radioterapiaDatumIntervallum",
        chemoterapia, chemoterapia_leiras as "chemoterapiaLeiras",
        fabian_fejerdy_protetikai_osztaly as "fabianFejerdyProtetikaiOsztaly",
        kezeleoorvos, kezeleoorvos_intezete as "kezeleoorvosIntezete",
        felvetel_datuma as "felvetelDatuma",
        felso_fogpotlas_van as "felsoFogpotlasVan",
        felso_fogpotlas_mikor as "felsoFogpotlasMikor",
        felso_fogpotlas_keszito as "felsoFogpotlasKeszito",
        felso_fogpotlas_elegedett as "felsoFogpotlasElegedett",
        felso_fogpotlas_problema as "felsoFogpotlasProblema",
        also_fogpotlas_van as "alsoFogpotlasVan",
        also_fogpotlas_mikor as "alsoFogpotlasMikor",
        also_fogpotlas_keszito as "alsoFogpotlasKeszito",
        also_fogpotlas_elegedett as "alsoFogpotlasElegedett",
        also_fogpotlas_problema as "alsoFogpotlasProblema",
        meglevo_fogak as "meglevoFogak",
        felso_fogpotlas_tipus as "felsoFogpotlasTipus",
        also_fogpotlas_tipus as "alsoFogpotlasTipus",
        meglevo_implantatumok as "meglevoImplantatumok",
        nem_ismert_poziciokban_implantatum as "nemIsmertPoziciokbanImplantatum",
        nem_ismert_poziciokban_implantatum_reszletek as "nemIsmertPoziciokbanImplantatumRészletek",
        tnm_staging as "tnmStaging",
        bno, diagnozis, primer_mutet_leirasa as "primerMutetLeirasa",
        baleset_idopont as "balesetIdopont",
        baleset_etiologiaja as "balesetEtiologiaja",
        baleset_egyeb as "balesetEgyeb",
        veleszuletett_rendellenessegek as "veleszuletettRendellenessegek",
        veleszuletett_mutetek_leirasa as "veleszuletettMutetekLeirasa",
        kezelesi_terv_felso as "kezelesiTervFelso",
        kezelesi_terv_also as "kezelesiTervAlso",
        kezelesi_terv_arcot_erinto as "kezelesiTervArcotErinto",
        kortorteneti_osszefoglalo as "kortortenetiOsszefoglalo",
        kezelesi_terv_melleklet as "kezelesiTervMelleklet",
        szakorvosi_velemeny as "szakorvosiVelemény"
      FROM patients
      WHERE id = $1`,
      [patientId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Beteg nem található' },
        { status: 404 }
      );
    }

    const patientData = result.rows[0];
    
    // Konvertáljuk a dátum mezőket string formátumba (PostgreSQL Date objektumokat ad vissza)
    const normalizedPatientData = {
      ...patientData,
      szuletesiDatum: patientData.szuletesiDatum 
        ? (patientData.szuletesiDatum instanceof Date 
            ? patientData.szuletesiDatum.toISOString().split('T')[0]
            : String(patientData.szuletesiDatum))
        : null,
      mutetIdeje: patientData.mutetIdeje 
        ? (patientData.mutetIdeje instanceof Date 
            ? patientData.mutetIdeje.toISOString().split('T')[0]
            : String(patientData.mutetIdeje))
        : null,
      felvetelDatuma: patientData.felvetelDatuma 
        ? (patientData.felvetelDatuma instanceof Date 
            ? patientData.felvetelDatuma.toISOString().split('T')[0]
            : String(patientData.felvetelDatuma))
        : null,
      balesetIdopont: patientData.balesetIdopont 
        ? (patientData.balesetIdopont instanceof Date 
            ? patientData.balesetIdopont.toISOString().split('T')[0]
            : String(patientData.balesetIdopont))
        : null,
    };
    
    // Validáljuk a beteg adatait a schema szerint
    const patient = patientSchema.parse(normalizedPatientData) as Patient;

    // PDF generálása
    const pdfBuffer = await generateEquityRequestPDF(patient);

    // Fájlnév generálása
    const patientName = patient.nev || 'Beteg';
    const sanitizedName = patientName.replace(/[^a-zA-Z0-9áéíóöőúüűÁÉÍÓÖŐÚÜŰ\s]/g, '').trim().replace(/\s+/g, '_');
    const filename = `Meltanyossagi_kerelm_${sanitizedName}_${Date.now()}.pdf`;

    // Feltöltés szerverre "méltányossági" tag-gel, ha FTP konfigurálva van
    if (isFtpConfigured()) {
      try {
        const tags = ['méltányossági'];
        const uploadFilename = generateDocumentFilename(
          filename,
          tags,
          patientId,
          new Date()
        );
        
        // Feltöltés FTP-re
        const filePath = await uploadFile(patientId, pdfBuffer, uploadFilename);
        
        // Mentés adatbázisba
        const tagsJsonb = JSON.stringify(tags);
        await pool.query(
          `INSERT INTO patient_documents (
            patient_id, filename, file_path, file_size, mime_type,
            description, tags, uploaded_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
          [
            patientId,
            uploadFilename,
            filePath,
            pdfBuffer.length,
            'application/pdf',
            'Méltányossági kérelem PDF',
            tagsJsonb,
            auth.email
          ]
        );

        // Activity logging
        await logActivity(
          request,
          auth.email,
          'patient_document_uploaded',
          `Patient ID: ${patientId}, Document: ${uploadFilename}, Type: Méltányossági kérelem, Size: ${pdfBuffer.length} bytes`
        );
      } catch (uploadError) {
        // Ha a feltöltés sikertelen, csak logoljuk, de ne akadályozzuk meg a PDF letöltését
        console.error('Hiba a PDF feltöltésekor:', uploadError);
        // Folytatjuk a PDF visszaadásával
      }
    }

    // PDF válasz visszaadása
    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': pdfBuffer.length.toString(),
      },
    });
  } catch (error) {
    console.error('Hiba a PDF generálása során:', error);
    const errorMessage = error instanceof Error ? error.message : 'Ismeretlen hiba';
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    // Részletesebb hibaüzenet a konzolban
    if (errorStack) {
      console.error('Hiba stack trace:', errorStack);
    }
    
    return NextResponse.json(
      { 
        error: 'Hiba történt a PDF generálása során',
        details: errorMessage,
        ...(process.env.NODE_ENV === 'development' && errorStack ? { stack: errorStack } : {})
      },
      { status: 500 }
    );
  }
}

