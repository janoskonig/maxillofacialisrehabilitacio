import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '../api-error-handler';
import { requireAuth, requireRole, verifyAuth, type AuthPayload } from '../auth-server';

function generateCorrelationId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ---------------------------------------------------------------------------
// Context types
// ---------------------------------------------------------------------------

export type RouteContext = {
  correlationId: string;
  params: Record<string, string>;
};

export type AuthedRouteContext = RouteContext & {
  auth: AuthPayload;
};

export type OptionalAuthRouteContext = RouteContext & {
  auth: AuthPayload | null;
};

type RouteHandler<Ctx> = (req: NextRequest, ctx: Ctx) => Promise<NextResponse>;

// ---------------------------------------------------------------------------
// Core wrapper: correlation ID + error handling + params forwarding
// ---------------------------------------------------------------------------

function wrapRoute<Ctx extends RouteContext>(
  setup: (req: NextRequest, base: RouteContext) => Promise<Ctx>,
  handler: RouteHandler<Ctx>,
) {
  return async (
    req: NextRequest,
    routeCtx?: { params: Record<string, string> | Promise<Record<string, string>> },
  ): Promise<NextResponse> => {
    const correlationId =
      req.headers.get('x-correlation-id')?.toLowerCase() || generateCorrelationId();

    const rawParams = routeCtx?.params;
    const params = rawParams instanceof Promise ? await rawParams : (rawParams ?? {});

    try {
      const ctx = await setup(req, { correlationId, params });
      const res = await handler(req, ctx);
      res.headers.set('x-correlation-id', correlationId);
      return res;
    } catch (error) {
      return handleApiError(error, 'Hiba történt', correlationId);
    }
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Route handler with correlation ID + automatic error handling.
 * No auth requirement -- use for public endpoints.
 */
export function apiHandler(handler: RouteHandler<RouteContext>) {
  return wrapRoute(async (_req, base) => base, handler);
}

/**
 * Route handler that requires a valid session (throws 401 otherwise).
 */
export function authedHandler(handler: RouteHandler<AuthedRouteContext>) {
  return wrapRoute(async (req, base) => {
    const auth = await requireAuth(req);
    return { ...base, auth };
  }, handler);
}

/**
 * Route handler that requires one of the specified roles (throws 401/403).
 */
export function roleHandler(
  allowedRoles: AuthPayload['role'][],
  handler: RouteHandler<AuthedRouteContext>,
) {
  return wrapRoute(async (req, base) => {
    const auth = await requireRole(req, allowedRoles);
    return { ...base, auth };
  }, handler);
}

/**
 * Route handler that optionally resolves auth (null if not logged in).
 * Useful for routes that behave differently for logged-in vs anonymous users.
 */
export function optionalAuthHandler(handler: RouteHandler<OptionalAuthRouteContext>) {
  return wrapRoute(async (req, base) => {
    const auth = await verifyAuth(req);
    return { ...base, auth };
  }, handler);
}
