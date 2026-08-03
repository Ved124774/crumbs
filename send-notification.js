const fs = require('fs');
const { GoogleAuth } = require('google-auth-library');

async function main() {
  const factData = JSON.parse(fs.readFileSync('fact.json', 'utf8'));
  const notificationText = factData.notification;

  if (!notificationText) {
    throw new Error('No notification field found in fact.json');
  }

  const serviceAccountJson = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  const projectId = serviceAccountJson.project_id;

  const auth = new GoogleAuth({
    credentials: serviceAccountJson,
    scopes: ['https://www.googleapis.com/auth/firebase.messaging']
  });
  const client = await auth.getClient();
  const accessTokenResponse = await client.getAccessToken();
  const accessToken = accessTokenResponse.token;

  const message = {
    message: {
      topic: 'daily_fact',
      notification: {
        title: 'Crumbs',
        body: notificationText
      }
    }
  };

  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(message)
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`FCM send failed (status ${res.status}): ${JSON.stringify(data)}`);
  }
  console.log('Notification sent successfully:', JSON.stringify(data));
}

main().catch(err => {
  console.error('Failed to send notification:', err.message);
  process.exit(1);
});
