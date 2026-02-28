import { google } from 'googleapis';
import {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  getOAuth2Client,
  callGoogleCalendar,
  refreshAccessTokenIfNeeded,
  GoogleReconnectRequiredError,
} from './auth';

async function getCalendarClient(userId: string) {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return null;
  }

  const accessToken = await refreshAccessTokenIfNeeded(userId);
  if (!accessToken) {
    return null;
  }

  const oauth2Client = getOAuth2Client();
  if (!oauth2Client) {
    return null;
  }

  oauth2Client.setCredentials({
    access_token: accessToken,
  });

  return google.calendar({ version: 'v3', auth: oauth2Client });
}

export interface GoogleCalendarEventData {
  summary: string;
  description: string;
  startTime: Date;
  endTime: Date;
  location?: string;
  calendarId?: string;
}

interface CalendarCacheEntry {
  calendars: Array<{ id: string; summary: string }>;
  expiresAt: number;
}

const calendarCache = new Map<string, CalendarCacheEntry>();
const CALENDAR_CACHE_TTL_MS = 5 * 60 * 1000;

export async function listGoogleCalendars(userId: string): Promise<Array<{ id: string; summary: string }>> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    console.warn('[listGoogleCalendars] Google Calendar credentials not configured');
    return [];
  }

  const cached = calendarCache.get(userId);
  const now = Date.now();

  if (cached && cached.expiresAt > now) {
    return cached.calendars;
  }

  try {
    const result = await callGoogleCalendar(userId, async (accessToken) => {
      const oauth2Client = getOAuth2Client();
      if (!oauth2Client) {
        throw new Error('OAuth2 client not configured');
      }

      oauth2Client.setCredentials({
        access_token: accessToken,
      });

      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
      const response = await calendar.calendarList.list();
      const calendars = response.data.items || [];

      return calendars.map((cal) => ({
        id: cal.id || '',
        summary: cal.summary || '',
      }));
    });

    calendarCache.set(userId, {
      calendars: result,
      expiresAt: now + CALENDAR_CACHE_TTL_MS,
    });

    console.log(`[listGoogleCalendars] Found ${result.length} calendars for user ${userId}`);
    return result;
  } catch (error) {
    if (error instanceof GoogleReconnectRequiredError) {
      throw error;
    }

    console.error(`[listGoogleCalendars] Error listing Google Calendars for user ${userId}:`, error);
    if (error instanceof Error) {
      console.error(`[listGoogleCalendars] Error message: ${error.message}`);
    }
    return [];
  }
}

async function getCalendarIdByName(userId: string, calendarName: string): Promise<string | null> {
  if (!calendarName || calendarName === 'primary') {
    return 'primary';
  }
  
  try {
    const calendars = await listGoogleCalendars(userId);
    const found = calendars.find((cal) => 
      cal.summary.toLowerCase() === calendarName.toLowerCase() || 
      cal.id === calendarName
    );
    
    return found ? found.id : null;
  } catch (error) {
    console.error('Error getting calendar ID by name:', error);
    return null;
  }
}

export async function createGoogleCalendarEvent(
  userId: string,
  eventData: GoogleCalendarEventData
): Promise<string | null> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    console.warn('[createGoogleCalendarEvent] Google Calendar credentials not configured');
    return null;
  }

  try {
    let calendarId = eventData.calendarId || process.env.GOOGLE_CALENDAR_ID || 'primary';

    if (calendarId !== 'primary' && !calendarId.includes('@')) {
      const foundCalendarId = await getCalendarIdByName(userId, calendarId);
      if (foundCalendarId) {
        calendarId = foundCalendarId;
      } else {
        console.warn(`Calendar "${calendarId}" not found, using primary`);
        calendarId = 'primary';
      }
    }

    const eventId = await callGoogleCalendar(userId, async (accessToken) => {
      const oauth2Client = getOAuth2Client();
      if (!oauth2Client) {
        throw new Error('OAuth2 client not configured');
      }

      oauth2Client.setCredentials({
        access_token: accessToken,
      });

      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

      const event = {
        summary: eventData.summary,
        description: eventData.description,
        location: eventData.location || 'Maxillofaciális Rehabilitáció',
        start: {
          dateTime: eventData.startTime.toISOString(),
          timeZone: 'UTC',
        },
        end: {
          dateTime: eventData.endTime.toISOString(),
          timeZone: 'UTC',
        },
        status: 'confirmed' as const,
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'email', minutes: 24 * 60 },
            { method: 'popup', minutes: 60 },
          ],
        },
      };

      const response = await calendar.events.insert({
        calendarId: calendarId,
        requestBody: event,
      });

      return response.data.id || null;
    });

    return eventId;
  } catch (error) {
    if (error instanceof GoogleReconnectRequiredError) {
      throw error;
    }

    const reason = error instanceof Error ? error.message : 'Unknown error';
    console.error(
      `[createGoogleCalendarEvent] Failed for user ${userId}: ${reason}`,
      { userId, error }
    );
    return null;
  }
}

export async function deleteGoogleCalendarEvent(
  userId: string,
  eventId: string,
  calendarId?: string
): Promise<boolean> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return false;
  }

  try {
    let targetCalendarId = calendarId || 'primary';

    if (targetCalendarId !== 'primary' && !targetCalendarId.includes('@')) {
      const foundCalendarId = await getCalendarIdByName(userId, targetCalendarId);
      if (foundCalendarId) {
        targetCalendarId = foundCalendarId;
      } else {
        console.warn(`Calendar "${targetCalendarId}" not found, using primary`);
        targetCalendarId = 'primary';
      }
    }

    await callGoogleCalendar(userId, async (accessToken) => {
      const oauth2Client = getOAuth2Client();
      if (!oauth2Client) {
        throw new Error('OAuth2 client not configured');
      }

      oauth2Client.setCredentials({
        access_token: accessToken,
      });

      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

      await calendar.events.delete({
        calendarId: targetCalendarId,
        eventId: eventId,
      });
    });

    return true;
  } catch (error) {
    if (error instanceof GoogleReconnectRequiredError) {
      throw error;
    }

    console.error('Error deleting Google Calendar event:', error);
    return false;
  }
}

export async function updateGoogleCalendarEvent(
  userId: string,
  eventId: string,
  eventData: GoogleCalendarEventData,
  originalCalendarId?: string
): Promise<boolean> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return false;
  }

  try {
    let calendarId = originalCalendarId || eventData.calendarId || process.env.GOOGLE_CALENDAR_ID || 'primary';

    if (calendarId !== 'primary' && !calendarId.includes('@')) {
      const foundCalendarId = await getCalendarIdByName(userId, calendarId);
      if (foundCalendarId) {
        calendarId = foundCalendarId;
      } else {
        console.warn(`Calendar "${calendarId}" not found, using primary`);
        calendarId = 'primary';
      }
    }

    await callGoogleCalendar(userId, async (accessToken) => {
      const oauth2Client = getOAuth2Client();
      if (!oauth2Client) {
        throw new Error('OAuth2 client not configured');
      }

      oauth2Client.setCredentials({
        access_token: accessToken,
      });

      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

      const existingEvent = await calendar.events.get({
        calendarId: calendarId,
        eventId: eventId,
      });

      if (!existingEvent.data) {
        throw new Error('Event not found');
      }

      const updatedEvent = {
        ...existingEvent.data,
        summary: eventData.summary,
        description: eventData.description,
        location: eventData.location || 'Maxillofaciális Rehabilitáció',
        start: {
          dateTime: eventData.startTime.toISOString(),
          timeZone: 'UTC',
        },
        end: {
          dateTime: eventData.endTime.toISOString(),
          timeZone: 'UTC',
        },
      };

      await calendar.events.update({
        calendarId: calendarId,
        eventId: eventId,
        requestBody: updatedEvent,
      });
    });

    return true;
  } catch (error) {
    if (error instanceof GoogleReconnectRequiredError) {
      throw error;
    }

    console.error('Error updating Google Calendar event:', error);
    return false;
  }
}

export interface GoogleCalendarEvent {
  id: string;
  summary: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
}

export async function fetchGoogleCalendarEvents(
  userId: string,
  timeMin: Date,
  timeMax: Date,
  calendarId?: string
): Promise<GoogleCalendarEvent[]> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return [];
  }

  try {
    let sourceCalendarId = calendarId || 'primary';

    if (sourceCalendarId !== 'primary' && !sourceCalendarId.includes('@')) {
      const foundCalendarId = await getCalendarIdByName(userId, sourceCalendarId);
      if (foundCalendarId) {
        sourceCalendarId = foundCalendarId;
      } else {
        console.warn(`Source calendar "${sourceCalendarId}" not found, using primary`);
        sourceCalendarId = 'primary';
      }
    }

    let allEvents: any[] = [];
    let pageToken: string | undefined = undefined;

    do {
      const pageEvents = await callGoogleCalendar(userId, async (accessToken) => {
        const oauth2Client = getOAuth2Client();
        if (!oauth2Client) {
          throw new Error('OAuth2 client not configured');
        }

        oauth2Client.setCredentials({
          access_token: accessToken,
        });

        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

        const response: any = await calendar.events.list({
          calendarId: sourceCalendarId,
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          singleEvents: true,
          orderBy: 'startTime',
          maxResults: 2500,
          pageToken: pageToken,
        });

        return {
          items: response.data.items || [],
          nextPageToken: response.data.nextPageToken || undefined,
        };
      });

      allEvents = allEvents.concat(pageEvents.items);
      pageToken = pageEvents.nextPageToken;

      if (pageToken) {
        console.log(`[fetchGoogleCalendarEvents] Fetched ${allEvents.length} events so far, more pages available...`);
      }
    } while (pageToken);

    console.log(`[fetchGoogleCalendarEvents] Total events fetched: ${allEvents.length}`);

    return allEvents.map((event) => ({
      id: event.id || '',
      summary: event.summary || '',
      start: event.start || { dateTime: '', date: '' },
      end: event.end || { dateTime: '', date: '' },
    }));
  } catch (error) {
    if (error instanceof GoogleReconnectRequiredError) {
      throw error;
    }

    console.error('Error fetching Google Calendar events:', error);
    return [];
  }
}
