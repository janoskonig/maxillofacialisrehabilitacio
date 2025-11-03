// Dátum helper függvények
export const formatDateForDisplay = (dateString: string | null | undefined): string => {
  if (!dateString) return '';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch {
    return dateString;
  }
};

export const formatDateForInput = (dateString: string | null | undefined): string => {
  if (!dateString) return '';
  // Ha már YYYY-MM-DD formátumban van, visszaadjuk
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return dateString;
  // Ha YYYY/MM/DD formátumban van, konvertáljuk
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(dateString)) {
    return dateString.replace(/\//g, '-');
  }
  // Egyéb esetekben próbáljuk meg parse-olni
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch {
    return '';
  }
};

