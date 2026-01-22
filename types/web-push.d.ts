declare module 'web-push' {
  export interface PushSubscription {
    endpoint: string;
    keys: {
      p256dh: string;
      auth: string;
    };
  }

  export interface SendResult {
    statusCode: number;
    body?: string;
    headers?: Record<string, string>;
  }

  export interface WebPushError extends Error {
    statusCode: number;
    body?: string;
    headers?: Record<string, string>;
    endpoint?: string;
  }

  export function setVapidDetails(
    subject: string,
    publicKey: string,
    privateKey: string
  ): void;

  export function sendNotification(
    subscription: PushSubscription,
    payload: string | Buffer,
    options?: {
      TTL?: number;
      headers?: Record<string, string>;
      vapidDetails?: {
        subject: string;
        publicKey: string;
        privateKey: string;
      };
      proxy?: string;
    }
  ): Promise<SendResult>;

  export function generateVAPIDKeys(): {
    publicKey: string;
    privateKey: string;
  };
}
