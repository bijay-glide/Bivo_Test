/**
 * OTP Helper Module
 * Fetches OTP via identity API + Keycloak admin (no console output of secrets by default).
 */

function decodeOtp(encodedOtp) {
  return Buffer.from(encodedOtp, 'base64').toString('utf-8');
}

/** Set PLAYWRIGHT_DEBUG_OTP=1 to log non-secret milestones only (never logs the OTP value). */
function otpDebugLog(...args) {
  const on =
    process.env.PLAYWRIGHT_DEBUG_OTP === '1' ||
    process.env.PLAYWRIGHT_DEBUG_OTP === 'true';
  if (on) {
    console.log('[otp-helper]', ...args);
  }
}

async function getOtpForPhoneNumber(request, phoneNumber) {
  try {
    const otpUrl = `${process.env.HOST}/identity/v1/otp`;
    otpDebugLog('POST', otpUrl, '(phone redacted)');

    const otpResponse = await request.post(otpUrl, {
      headers: {
        'X-Tenant-Identifier': process.env.TENANT_IDENTIFIER,
        'Content-Type': 'application/json',
      },
      data: { phoneNumber },
    });

    const otpResponseText = await otpResponse.text();
    if (otpResponse.status() !== 200) {
      throw new Error(
        `OTP generation failed with status ${otpResponse.status()}: ${otpResponseText}`,
      );
    }
    otpDebugLog('OTP trigger OK, status', otpResponse.status());

    const authUrl = `${process.env.KEYCLOAK_HOST}/${process.env.KEYCLOAK_AUTH_URI}`;
    const formData = new URLSearchParams({
      client_id: process.env.KEYCLOAK_CLIENT_ID,
      username: process.env.KEYCLOAK_USERNAME,
      password: process.env.KEYCLOAK_PASSWORD,
      grant_type: process.env.KEYCLOAK_GRANT_TYPE,
    }).toString();

    const authResponse = await request.post(authUrl, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: formData,
    });

    const authResponseText = await authResponse.text();
    if (authResponse.status() !== 200) {
      throw new Error(
        `Keycloak authentication failed with status ${authResponse.status()}: ${authResponseText}`,
      );
    }

    const authData = JSON.parse(authResponseText);
    const bearerToken = authData.access_token;
    otpDebugLog('Keycloak token OK');

    const userUrl = `${process.env.KEYCLOAK_HOST}/${process.env.KEYCLOAK_URI}/realms/${process.env.KEYCLOAK_REALM}/users`;

    const userResponse = await request.get(userUrl, {
      headers: { Authorization: `Bearer ${bearerToken}` },
      params: { username: phoneNumber, exact: 'true' },
    });

    const userResponseText = await userResponse.text();
    if (userResponse.status() !== 200) {
      throw new Error(
        `User retrieval failed with status ${userResponse.status()}: ${userResponseText}`,
      );
    }

    const userData = JSON.parse(userResponseText);
    if (!userData || userData.length === 0) {
      throw new Error('No user found for the given phone number');
    }

    const user = userData[0];
    if (!user.attributes || !user.attributes.otp || !user.attributes.otp[0]) {
      throw new Error('OTP attribute not found on user');
    }

    const encodedOtp = user.attributes.otp[0];
    const decodedOtp = decodeOtp(encodedOtp);
    otpDebugLog('OTP retrieved (value not logged)');

    return decodedOtp;
  } catch (error) {
    console.error('[otp-helper] Failed:', error.message);
    throw error;
  }
}

/**
 * Retrieves the OTP for a BU web user identified by email.
 * The UI triggers the OTP on email submission — this function only reads it from Keycloak.
 */
async function getOtpForEmail(request, email) {
  try {
    const authUrl = `${process.env.KEYCLOAK_HOST}/${process.env.KEYCLOAK_AUTH_URI}`;
    const formData = new URLSearchParams({
      client_id: process.env.KEYCLOAK_CLIENT_ID,
      username: process.env.KEYCLOAK_USERNAME,
      password: process.env.KEYCLOAK_PASSWORD,
      grant_type: process.env.KEYCLOAK_GRANT_TYPE,
    }).toString();

    const authResponse = await request.post(authUrl, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: formData,
      timeout: 30000,
    });

    const authResponseText = await authResponse.text();
    if (authResponse.status() !== 200) {
      throw new Error(`Keycloak authentication failed (${authResponse.status()}): ${authResponseText}`);
    }

    const bearerToken = JSON.parse(authResponseText).access_token;
    otpDebugLog('Keycloak token OK (email lookup)');

    const userUrl = `${process.env.KEYCLOAK_HOST}/${process.env.KEYCLOAK_URI}/realms/${process.env.KEYCLOAK_REALM}/users`;

    // BU web creates the Keycloak user on email submission — retry a few times to allow propagation.
    let userData = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 3000));
      for (const params of [{ username: email, exact: 'true' }, { email, exact: 'true' }]) {
        const userResponse = await request.get(userUrl, {
          headers: { Authorization: `Bearer ${bearerToken}` },
          params,
          timeout: 30000,
        });
        const userResponseText = await userResponse.text();
        if (userResponse.status() !== 200) {
          throw new Error(`User retrieval failed (${userResponse.status()}): ${userResponseText}`);
        }
        userData = JSON.parse(userResponseText);
        if (userData && userData.length > 0) break;
      }
      if (userData && userData.length > 0) break;
      otpDebugLog(`User not found yet (attempt ${attempt + 1}/5), retrying...`);
    }

    if (!userData || userData.length === 0) {
      throw new Error(`No Keycloak user found for email: ${email}`);
    }

    const user = userData[0];
    if (!user.attributes?.otp?.[0]) {
      throw new Error('OTP attribute not found on Keycloak user');
    }

    otpDebugLog('OTP retrieved by email (value not logged)');
    return decodeOtp(user.attributes.otp[0]);
  } catch (error) {
    console.error('[otp-helper] getOtpForEmail failed:', error.message);
    throw error;
  }
}

module.exports = {
  getOtpForPhoneNumber,
  getOtpForEmail,
  decodeOtp,
};
