import { Env, Session, KV_PREFIX } from './utils/types';
import { json, error, redirect } from './utils/response';

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyPassword(input: string, storedHash: string): Promise<boolean> {
  const inputHash = await hashPassword(input);
  const encoder = new TextEncoder();
  const a = encoder.encode(inputHash);
  const b = encoder.encode(storedHash);
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

export async function createSession(env: Env): Promise<{ sessionId: string; cookie: string }> {
  const sessionId = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);

  const session: Session = {
    id: sessionId,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  await env.VAULT_KV.put(
    KV_PREFIX.SESSION + sessionId,
    JSON.stringify(session),
    { expirationTtl: Math.floor(SESSION_DURATION_MS / 1000) }
  );

  const cookie = `session=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(SESSION_DURATION_MS / 1000)}`;
  return { sessionId, cookie };
}

export async function validateSession(request: Request, env: Env): Promise<boolean> {
  const cookieHeader = request.headers.get('Cookie') || '';
  const match = cookieHeader.match(/session=([^;]+)/);
  if (!match) return false;

  const sessionId = match[1];
  const raw = await env.VAULT_KV.get(KV_PREFIX.SESSION + sessionId);
  if (!raw) return false;

  const session: Session = JSON.parse(raw);
  if (new Date(session.expiresAt) < new Date()) {
    await env.VAULT_KV.delete(KV_PREFIX.SESSION + sessionId);
    return false;
  }
  return true;
}

function getSessionId(request: Request): string | null {
  const cookieHeader = request.headers.get('Cookie') || '';
  const match = cookieHeader.match(/session=([^;]+)/);
  return match ? match[1] : null;
}

export async function handleLogin(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return error('Method not allowed', 405);

  const contentType = request.headers.get('Content-Type') || '';
  let password: string;

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const formData = await request.formData();
    password = formData.get('password') as string || '';
  } else if (contentType.includes('application/json')) {
    const body = await request.json<{ password: string }>();
    password = body.password || '';
  } else {
    return error('Unsupported content type', 415);
  }

  if (!password) return error('Password required', 400);

  const storedHash = await hashPassword(env.ADMIN_PASSWORD);
  const valid = await verifyPassword(password, storedHash);

  if (!valid) return error('Invalid password', 401);

  const { cookie } = await createSession(env);

  return new Response(JSON.stringify({ message: 'ok' }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': cookie,
      'Location': '/admin',
    },
  });
}

export async function handleLogout(request: Request, env: Env): Promise<Response> {
  const sessionId = getSessionId(request);
  if (sessionId) {
    await env.VAULT_KV.delete(KV_PREFIX.SESSION + sessionId);
  }
  return new Response(null, {
    status: 302,
    headers: {
      'Location': '/login',
      'Set-Cookie': 'session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
    },
  });
}

const PUBLIC_PREFIXES = ['/s/', '/auth/', '/login'];

export async function authMiddleware(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  for (const prefix of PUBLIC_PREFIXES) {
    if (url.pathname.startsWith(prefix)) return null;
  }
  if (url.pathname === '/login') return null;

  const valid = await validateSession(request, env);
  if (!valid) return redirect('/login');
  return null;
}
