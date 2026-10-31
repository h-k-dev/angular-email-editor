import { TestBed } from '@angular/core/testing';
import { AxiosAdapter, AxiosError, AxiosHeaders, InternalAxiosRequestConfig } from 'axios';

import { AxiosSingleton } from './axios.singleton';

/** An adapter answering `status` with `data` — no network. */
function answer(status: number, data: unknown): AxiosAdapter {
  return async (config: InternalAxiosRequestConfig) => {
    const response = {
      data,
      status,
      statusText: '',
      headers: new AxiosHeaders(),
      config,
    };
    if (status >= 400) {
      throw new AxiosError(
        `Request failed with status code ${status}`,
        'ERR_BAD_RESPONSE',
        config,
        null,
        response,
      );
    }
    return response;
  };
}

describe('AxiosSingleton', () => {
  let http: AxiosSingleton;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    http = TestBed.inject(AxiosSingleton);
  });

  it('is one instance app-wide', () => {
    expect(TestBed.inject(AxiosSingleton)).toBe(http);
  });

  it('answers the body as data on success', async () => {
    http.instance.defaults.adapter = answer(200, [{ id: 1 }]);
    const result = await http.get<{ id: number }[]>('/rows');
    expect(result).toEqual({ success: true, data: [{ id: 1 }], error: null });
  });

  it('answers a status error without throwing', async () => {
    http.instance.defaults.adapter = answer(401, { error: 'expired' });
    const result = await http.post('/rows', { id: 2 });
    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
    if (!result.success) {
      expect(result.error.status).toBe(401);
      expect(result.error.cancelled).toBe(false);
    }
  });

  it('answers an abort as cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await http.delete('/rows/1', { signal: controller.signal });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.cancelled).toBe(true);
      expect(result.error.status).toBeNull();
    }
  });
});
