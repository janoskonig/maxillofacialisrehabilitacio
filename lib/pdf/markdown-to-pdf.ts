/**
 * Markdown → HTML → PDF konverzió modul
 * Sokkal jobb minőségű PDF-eket generál, mint a pdf-lib
 */

import { marked } from 'marked';
import puppeteer from 'puppeteer';

// Markdown → HTML konverzió
async function markdownToHTML(markdown: string, title?: string): Promise<string> {
  // Configure marked options
  let html: string;
  try {
    // marked v12+ API - marked.parse() vagy marked() használata
    if (typeof marked.parse === 'function') {
      // marked v12+ has parse method
      html = await marked.parse(markdown, { breaks: true, gfm: true });
    } else if (typeof marked === 'function') {
      // marked v4+ direct function call
      html = await marked(markdown, { breaks: true, gfm: true });
    } else {
      // Fallback: use default export
      const { marked: markedDefault } = await import('marked');
      html = await markedDefault(markdown, { breaks: true, gfm: true });
    }
  } catch (error) {
    console.error('[markdown-to-pdf] Error parsing markdown:', error);
    // Fallback: escape HTML and wrap in <pre>
    html = `<pre>${markdown.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`;
  }

  return `<!DOCTYPE html>
<html lang="hu">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title || 'Export'}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', Arial, sans-serif;
      font-size: 11pt;
      line-height: 1.6;
      color: #333;
      padding: 40px;
      max-width: 800px;
      margin: 0 auto;
      background: white;
    }
    
    h1 {
      font-size: 24pt;
      font-weight: bold;
      margin-bottom: 20px;
      color: #1a1a1a;
      border-bottom: 2px solid #333;
      padding-bottom: 10px;
    }
    
    h2 {
      font-size: 18pt;
      font-weight: bold;
      margin-top: 24px;
      margin-bottom: 12px;
      color: #2a2a2a;
      border-bottom: 1px solid #ddd;
      padding-bottom: 6px;
    }
    
    h3 {
      font-size: 14pt;
      font-weight: bold;
      margin-top: 18px;
      margin-bottom: 10px;
      color: #3a3a3a;
    }
    
    p {
      margin-bottom: 12px;
      text-align: justify;
    }
    
    ul, ol {
      margin-left: 24px;
      margin-bottom: 12px;
    }
    
    li {
      margin-bottom: 6px;
    }
    
    strong {
      font-weight: bold;
      color: #1a1a1a;
    }
    
    em {
      font-style: italic;
    }
    
    code {
      font-family: 'Courier New', monospace;
      background-color: #f5f5f5;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 10pt;
    }
    
    blockquote {
      border-left: 4px solid #ddd;
      padding-left: 16px;
      margin-left: 0;
      margin-bottom: 12px;
      color: #666;
      font-style: italic;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
    }
    
    th, td {
      border: 1px solid #ddd;
      padding: 8px;
      text-align: left;
    }
    
    th {
      background-color: #f5f5f5;
      font-weight: bold;
    }
    
    hr {
      border: none;
      border-top: 1px solid #ddd;
      margin: 24px 0;
    }
    
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #ddd;
      font-size: 9pt;
      color: #666;
      text-align: center;
    }
    
    @media print {
      body {
        padding: 20px;
      }
      
      @page {
        margin: 1cm;
      }
    }
  </style>
</head>
<body>
  ${html}
  <div class="footer">
    <p>Export dátuma: ${new Date().toLocaleString('hu-HU')}</p>
  </div>
</body>
</html>`;
}

/**
 * Markdown → PDF konverzió Puppeteer-rel
 */
export async function markdownToPDF(
  markdown: string,
  title?: string,
  options?: {
    format?: 'A4' | 'Letter';
    margin?: {
      top?: string;
      right?: string;
      bottom?: string;
      left?: string;
    };
  }
): Promise<Buffer> {
  let browser;
  try {
    const html = await markdownToHTML(markdown, title);
    
    // Puppeteer browser indítása
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
      ],
    });
    
    const page = await browser.newPage();
    
    // HTML betöltése
    await page.setContent(html, { 
      waitUntil: 'networkidle0',
      timeout: 30000, // 30s timeout
    });
    
    // PDF generálása
    const pdfBuffer = await page.pdf({
      format: options?.format || 'A4',
      margin: options?.margin || {
        top: '20mm',
        right: '15mm',
        bottom: '20mm',
        left: '15mm',
      },
      printBackground: true,
      preferCSSPageSize: true,
      timeout: 30000, // 30s timeout
    });
    
    return Buffer.from(pdfBuffer);
  } catch (error) {
    console.error('[markdown-to-pdf] Error generating PDF:', error);
    throw new Error(
      `PDF generálás sikertelen: ${error instanceof Error ? error.message : 'Ismeretlen hiba'}`
    );
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (closeError) {
        console.error('[markdown-to-pdf] Error closing browser:', closeError);
      }
    }
  }
}

/**
 * Beteg összefoglaló markdown generálása
 */
export function generatePatientSummaryMarkdown(
  patient: {
    nev?: string | null;
    taj?: string | null;
    diagnozis?: string | null;
    mutetIdeje?: string | null;
  },
  documents: any[],
  checklistStatus: {
    missingFields: any[];
    missingDocs: any[];
  },
  requiredDocRules?: Array<{ label: string; tag: string; minCount: number }>
): string {
  const lines: string[] = [];
  
  lines.push('# NEAK Export - Beteg Összefoglaló\n');
  
  lines.push('## Beteg Azonosítók\n');
  if (patient.nev) lines.push(`**Név:** ${patient.nev}`);
  if (patient.taj) lines.push(`**TAJ:** ${patient.taj}`);
  lines.push('');
  
  if (patient.diagnozis) {
    lines.push(`**Diagnózis:** ${patient.diagnozis}`);
  }
  if (patient.mutetIdeje) {
    lines.push(`**Műtét ideje:** ${patient.mutetIdeje}`);
  }
  lines.push('');
  
  lines.push('## Checklist Összefoglaló\n');
  
  const fieldsStatus = checklistStatus.missingFields.length === 0 
    ? '✓ Minden megvan' 
    : `✗ ${checklistStatus.missingFields.length} hiányzik`;
  lines.push(`**Kötelező mezők:** ${fieldsStatus}`);
  lines.push('');
  
  const docsStatus = checklistStatus.missingDocs.length === 0 
    ? '✓ Minden megvan' 
    : `✗ ${checklistStatus.missingDocs.length} hiányzik`;
  lines.push(`**Kötelező dokumentumok:** ${docsStatus}`);
  lines.push('');
  
  // Részletes dokumentum lista
  if (requiredDocRules && requiredDocRules.length > 0) {
    lines.push('### Kötelező dokumentumok részletei\n');
    requiredDocRules.forEach((rule) => {
      const docCount = documents.filter((doc) =>
        (doc.tags || []).some((t: string) => t.toLowerCase() === rule.tag.toLowerCase())
      ).length;
      const isComplete = docCount >= rule.minCount;
      const status = isComplete ? '✓' : '✗';
      lines.push(`- ${status} **${rule.label}:** ${docCount} / ${rule.minCount} db`);
    });
    lines.push('');
  }
  
  return lines.join('\n');
}

/**
 * Anamnézis összefoglaló markdown generálása
 */
export function generateMedicalHistoryMarkdown(
  patient: {
    nev?: string | null;
    taj?: string | null;
  },
  anamnesisSummary: string
): string {
  const lines: string[] = [];
  
  lines.push('# NEAK Export - Kórtörténet\n');
  
  lines.push('## Beteg Azonosítók\n');
  if (patient.nev) lines.push(`**Név:** ${patient.nev}`);
  if (patient.taj) lines.push(`**TAJ:** ${patient.taj}`);
  lines.push('');
  
  lines.push('## Anamnézis Összefoglaló\n');
  lines.push(anamnesisSummary);
  lines.push('');
  
  return lines.join('\n');
}
