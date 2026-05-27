// All environment variables in one place.
// Values are injected by the npm scripts via `source .env`.
//
// IMPORTANT: Custom vars use the BIVO_ prefix to avoid colliding with k6's own
// reserved env vars (K6_VUS, K6_ITERATIONS, etc.) which k6 reads from the
// shell environment and uses to override scenario config.

export const HOST        = __ENV.HOST;
export const TENANT      = __ENV.TENANT_IDENTIFIER;
export const PASSWORD    = __ENV.LOGIN_PASSWORD;
export const DEVICE_ID   = parseInt(__ENV.BIVO_DEVICE_ID,        10) || 0;
export const VUS         = parseInt(__ENV.BIVO_VUS,              10) || 1;
export const ITERATIONS  = parseInt(__ENV.BIVO_ITERATIONS,       10) || 1;
export const MAX_RETRIES = parseInt(__ENV.BIVO_PROBE_MAX_RETRIES, 10) || 3;

export const KC_HOST      = __ENV.KEYCLOAK_HOST;
export const KC_AUTH_URI  = __ENV.KEYCLOAK_AUTH_URI;
export const KC_ADMIN_URI = __ENV.KEYCLOAK_URI;
export const KC_REALM     = __ENV.KEYCLOAK_REALM;
export const KC_CLIENT_ID = __ENV.KEYCLOAK_CLIENT_ID;
export const KC_USERNAME  = __ENV.KEYCLOAK_USERNAME;
export const KC_PASSWORD  = __ENV.KEYCLOAK_PASSWORD;
