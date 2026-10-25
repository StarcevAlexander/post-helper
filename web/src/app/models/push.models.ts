export interface PushSubscriptionPayload {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  timeZone?: string;
}

export interface PushKeyResponse {
  publicKey: string;
}
