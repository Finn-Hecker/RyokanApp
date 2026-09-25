import * as m from '$lib/paraglide/messages';

export interface GenerationErrorInfo {
  title: string;
  message: string;
  status?: number;
  code?: string;
  provider?: string;
  model?: string;
}

interface ApiErrorPayload extends Omit<GenerationErrorInfo, 'title'> { kind?: string }

function parsePayload(error: unknown): ApiErrorPayload {
  const text = error instanceof Error ? error.message : String(error ?? '');
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : { message: text };
  } catch { return { message: text }; }
}

export function describeGenerationError(error: unknown): GenerationErrorInfo {
  const payload = parsePayload(error);
  const haystack = `${payload.code ?? ''} ${payload.message ?? ''}`.toLowerCase();
  let title = m.chat_generation_error_unknown();
  if (payload.kind === 'timeout' || /timed? ?out|timeout/.test(haystack)) title = m.chat_generation_error_timeout();
  else if (payload.kind === 'network' || /network|connect|dns|socket|unreachable/.test(haystack)) title = m.chat_generation_error_network();
  else if (/credit|quota|insufficient.*fund|billing|payment required/.test(haystack)) title = m.chat_generation_error_quota();
  else if (payload.status === 401 || /invalid.*(?:api )?key|unauthorized|authentication/.test(haystack)) title = m.chat_generation_error_api_key();
  else if (payload.status === 429 || /rate.?limit|too many requests/.test(haystack)) title = m.chat_generation_error_rate_limit();
  else if (/context|request|prompt/.test(haystack) && /too large|too long|maximum|limit|tokens/.test(haystack)) title = m.chat_generation_error_context_large();
  else if (/model.*(?:unavailable|not found|does not exist|unsupported)|no endpoints/.test(haystack)) title = m.chat_generation_error_model_unavailable();
  else if (payload.status === 502 || payload.status === 503 || payload.status === 504 || /upstream|provider.*unavailable|service unavailable/.test(haystack)) title = m.chat_generation_error_upstream();
  else if (/reject|refus|moderation|content policy|safety/.test(haystack)) title = m.chat_generation_error_rejected();
  else if (payload.status === 403) title = m.chat_generation_error_rejected();
  return { title, message: payload.message || 'The API returned an unknown error.', status: payload.status, code: payload.code, provider: payload.provider, model: payload.model };
}
