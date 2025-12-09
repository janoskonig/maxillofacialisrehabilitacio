const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const svgPath = path.join(__dirname, '..', 'public', 'logo.svg');
const pngPath = path.join(__dirname, '..', 'public', 'logo.png');

async function convertSvgToPng() {
  try {
    if (!fs.existsSync(svgPath)) {
      console.error(`SVG fájl nem található: ${svgPath}`);
      process.exit(1);
    }

    console.log(`SVG konvertálása PNG-re: ${svgPath} -> ${pngPath}`);
    
    await sharp(svgPath)
      .resize(200, null, { // 200px szélesség, magasság automatikus (arány megtartása)
        withoutEnlargement: true,
        background: { r: 255, g: 255, b: 255, alpha: 0 } // Átlátszó háttér
      })
      .png()
      .toFile(pngPath);

    console.log(`✓ Sikeresen konvertálva: ${pngPath}`);
    
    // Fájl méret ellenőrzése
    const stats = fs.statSync(pngPath);
    console.log(`✓ PNG fájl mérete: ${(stats.size / 1024).toFixed(2)} KB`);
  } catch (error) {
    console.error('Hiba a konverzió során:', error);
    process.exit(1);
  }
}

convertSvgToPng();



