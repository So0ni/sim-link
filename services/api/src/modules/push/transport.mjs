import https from 'node:https';
import webpush from 'web-push';

// A socket inactivity timeout alone does not bound DNS/connect/slow response time.
export function sendNotification(subscription, payload, options, deadlineMs = 10000) {
  const details = webpush.generateRequestDetails(subscription, payload, options);
  return new Promise((resolve, reject) => {
    const request = https.request(details.endpoint, {
      method: details.method, headers: details.headers,
      signal: AbortSignal.timeout(deadlineMs),
    }, response => {
      response.resume();
      response.on('error', reject);
      response.on('end', () => {
        if (response.statusCode >= 200 && response.statusCode < 300) resolve();
        else reject(Object.assign(new Error('Push rejected'), { statusCode: response.statusCode }));
      });
    });
    request.on('error', reject);
    request.end(details.body);
  });
}
