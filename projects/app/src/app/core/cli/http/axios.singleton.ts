import { Service } from '@angular/core';
import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

import { SafeResponse, safely } from './safe-response';

/**
 * The app's one axios instance, and its CRUD behind {@link SafeResponse}:
 * every call answers `{ success, data, error }` and none throws — a failed
 * request, a non-2xx status, an abort are all `success: false`.
 *
 * `data` is the response's body. Per-call settings (headers, params, an
 * `AbortSignal` as `signal`) go in `config`.
 */
@Service()
export class AxiosSingleton {
  readonly instance: AxiosInstance = axios.create();

  get<T>(url: string, config?: AxiosRequestConfig): Promise<SafeResponse<T>> {
    return safely(async () => (await this.instance.get<T>(url, config)).data);
  }

  post<T, B = unknown>(
    url: string,
    body?: B,
    config?: AxiosRequestConfig,
  ): Promise<SafeResponse<T>> {
    return safely(async () => (await this.instance.post<T>(url, body, config)).data);
  }

  put<T, B = unknown>(
    url: string,
    body?: B,
    config?: AxiosRequestConfig,
  ): Promise<SafeResponse<T>> {
    return safely(async () => (await this.instance.put<T>(url, body, config)).data);
  }

  patch<T, B = unknown>(
    url: string,
    body?: B,
    config?: AxiosRequestConfig,
  ): Promise<SafeResponse<T>> {
    return safely(async () => (await this.instance.patch<T>(url, body, config)).data);
  }

  delete<T = void>(url: string, config?: AxiosRequestConfig): Promise<SafeResponse<T>> {
    return safely(async () => (await this.instance.delete<T>(url, config)).data);
  }
}
