import { createEvent, EventAttributes } from 'ics';

export interface AppointmentData {
  patientName: string | null;
  patientTaj: string | null;
  startTime: Date;
  surgeonName: string;
  dentistName?: string;
  dayOnly?: string;
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
    title: `${data.patientName || 'Név nélküli beteg'} - Betegfogadás`,
    description: `Beteg: ${data.patientName || 'Név nélküli'}\nTAJ: ${data.patientTaj || 'Nincs megadva'}\nBeutaló orvos: ${data.surgeonName}`,
    location: 'Maxillofaciális Rehabilitáció',
    status: 'CONFIRMED',
    busyStatus: 'BUSY',
    organizer: {
      name: data.dentistName || 'Fogpótlástanász',
    },
  };
  if(data.dayOnly){
    const [year,month,day]=data.dayOnly.split('-').map(Number),next=new Date(Date.UTC(year,month-1,day+1));
    event.start=[year,month,day];event.end=[next.getUTCFullYear(),next.getUTCMonth()+1,next.getUTCDate()];
    event.description+='\nA pontos idő nem ismert; utólag dokumentált ellátás.';
  }

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

