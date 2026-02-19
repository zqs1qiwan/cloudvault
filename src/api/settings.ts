import { Env, SiteSettings, DEFAULT_SETTINGS, KV_PREFIX } from '../utils/types';
import { json, error } from '../utils/response';

const SETTINGS_KEY = KV_PREFIX.SETTINGS + 'site';

export async function getSettings(env: Env): Promise<SiteSettings> {
  const raw = await env.VAULT_KV.get(SETTINGS_KEY);
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function handleGetSettings(request: Request, env: Env): Promise<Response> {
  return json(await getSettings(env));
}

export async function handlePutSettings(request: Request, env: Env): Promise<Response> {
  const body = await request.json<Partial<SiteSettings>>();
  const current = await getSettings(env);

  if (typeof body.guestPageEnabled === 'boolean') {
    current.guestPageEnabled = body.guestPageEnabled;
  }
  if (typeof body.showLoginButton === 'boolean') {
    current.showLoginButton = body.showLoginButton;
  }
  if (typeof body.siteName === 'string') {
    current.siteName = body.siteName.trim().slice(0, 50) || 'CloudVault';
  }
  if (typeof body.siteIconUrl === 'string') {
    current.siteIconUrl = body.siteIconUrl.trim().slice(0, 500);
  }

  await env.VAULT_KV.put(SETTINGS_KEY, JSON.stringify(current));
  return json(current);
}
