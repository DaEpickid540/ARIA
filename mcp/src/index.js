// index.js — the ARIA MCP server, a Cloudflare Worker.
//
// workers-oauth-provider is the OAuth 2.1 server Claude's custom connectors
// require (dynamic client registration, PKCE, refresh tokens); it guards
// /mcp and hands each request the connected account in ctx.props.
// The authorisation step itself is connect.js.
//
// Stateless: a fresh MCP server per request. ARIA keeps all the state, on
// Render; every tool call goes there as the connected owner.
//
// Same shape as openplan/mcp — see that for the longer story.

import OAuthProvider from '@cloudflare/workers-oauth-provider';
import { createMcpHandler } from 'agents/mcp';
import { buildServer } from './tools.js';
import { handleConnect } from './connect.js';

// Not exported: every named export of a Worker module must be a handler.
const ORIGIN = 'https://aria-mcp.openplan.workers.dev';

const mcpApi = {
  fetch(request, env, ctx) {
    const handler = createMcpHandler(() => buildServer(env, ctx.props), { route: '/mcp' });
    return handler(request, env, ctx);
  },
};

export default new OAuthProvider({
  apiRoute: '/mcp',
  apiHandler: mcpApi,
  defaultHandler: { fetch: handleConnect },
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
  clientIdMetadataDocumentEnabled: true,
  scopesSupported: ['aria'],
  // RFC 9728: what Claude reads first to find out who issues tokens for /mcp.
  resourceMetadata: {
    resource: `${ORIGIN}/mcp`,
    authorization_servers: [ORIGIN],
    resource_name: 'ARIA',
  },
  accessTokenTTL: 60 * 60,
  refreshTokenTTL: 60 * 60 * 24 * 180,
});
