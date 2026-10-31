import { isAxiosError, isCancel } from 'axios';

/** Why a request failed: what to say, and what to decide on — the HTTP
    status (`null` when no answer came: offline, CORS, cancelled) and
    axios' code (`ERR_NETWORK`, `ERR_CANCELED`). */
export interface SafeError {
  message: string;
  status: number | null;
  code: string | null;
  cancelled: boolean;
  cause: unknown;
}

/**
 * A call's outcome that never throws — zod's `safeParse` shape. `success`
 * is the discriminant: checked, TypeScript knows which side is null.
 *
 * ```ts
 * const result = await http.get<Row[]>(url);
 * if (!result.success) return show(result.error.message);
 * result.data; // Row[]
 * ```
 */
export type SafeResponse<T, E = SafeError> =
  { success: true; data: T; error: null } | { success: false; data: null; error: E };

export function succeeded<T>(data: T): SafeResponse<T, never> {
  return { success: true, data, error: null };
}

export function failed<E = SafeError>(error: E): SafeResponse<never, E> {
  return { success: false, data: null, error };
}

/** Runs `call` and hands back its outcome — a rejection becomes a
    {@link SafeError}, never a throw. */
export async function safely<T>(call: () => Promise<T>): Promise<SafeResponse<T>> {
  try {
    return succeeded(await call());
  } catch (cause) {
    return failed(safeError(cause));
  }
}

/** Anything thrown, as a {@link SafeError}: an axios error keeps its
    status and code; an abort reads as cancelled. */
export function safeError(cause: unknown): SafeError {
  const cancelled =
    isCancel(cause) || (cause instanceof DOMException && cause.name === 'AbortError');
  if (isAxiosError(cause)) {
    return {
      message: cause.message,
      status: cause.response?.status ?? null,
      code: cause.code ?? null,
      cancelled,
      cause,
    };
  }
  return {
    message: cause instanceof Error ? cause.message : String(cause),
    status: null,
    code: null,
    cancelled,
    cause,
  };
}
