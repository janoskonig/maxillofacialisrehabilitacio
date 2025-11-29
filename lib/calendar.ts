import { createEvent, EventAttributes } from 'ics';

export interface AppointmentData {
  patientName: string | null;
  patientTaj: string | null;
  startTime: Date;
  surgeonName: string;
  dentistName?: string;
}

/**
 * Generate .ics file content for an appointment
 */
export async function generateIcsFile(data: AppointmentData): Promise<Buffer> {
  const startDate = new Date(data.startTime);
  const endDate = new Date(startDate);
  endDate.setMinutes(endDate.getMinutes() + 30); // Default 30 minute duration

  const event: EventAttributes = {
    start: [
      startDate.getFullYear(),
      startDate.getMonth() + 1,
      startDate.getDate(),
      startDate.getHours(),
      startDate.getMinutes(),
    ],
    end: [
      endDate.getFullYear(),
      endDate.getMonth() + 1,
      endDate.getDate(),
      endDate.getHours(),
      endDate.getMinutes(),
    ],
    title: `Betegfogadás - ${data.patientName || 'Név nélküli beteg'}`,
    description: `Beteg: ${data.patientName || 'Név nélküli'}\nTAJ: ${data.patientTaj || 'Nincs megadva'}\nBeutaló orvos: ${data.surgeonName}`,
    location: 'Maxillofaciális Rehabilitáció',
    status: 'CONFIRMED',
    busyStatus: 'BUSY',
    organizer: {
      name: data.dentistName || 'Fogpótlástanász',
    },
  };

  return new Promise((resolve, reject) => {
    createEvent(event, (error, value) => {
      if (error) {
        reject(error);
        return;
      }
      if (!value) {
        reject(new Error('Failed to generate ICS file'));
        return;
      }
      resolve(Buffer.from(value, 'utf-8'));
    });
  });
}

