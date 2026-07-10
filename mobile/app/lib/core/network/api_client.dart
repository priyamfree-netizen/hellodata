import 'package:cookie_jar/cookie_jar.dart';
import 'package:dio/dio.dart';
import 'package:dio_cookie_manager/dio_cookie_manager.dart';
import 'package:flutter/foundation.dart' show kIsWeb;

import '../auth/token_store.dart';
import '../env/env.dart';
import 'api_exception.dart';

/// HTTP client for the Cloudflare Worker `/api/*` endpoints.
///
/// - Injects `Authorization: Bearer <access token>` when present.
/// - Persists cookies (incl. the `billsos-refresh` HttpOnly refresh cookie) via
///   a [CookieJar], which is how silent refresh works on mobile without a
///   backend change (see docs/02_BACKEND_INTEGRATION.md, Option A).
class ApiClient {
  ApiClient({required TokenStore tokenStore, required CookieJar cookieJar})
      : _tokenStore = tokenStore,
        _dio = Dio(
          BaseOptions(
            baseUrl: Env.apiBaseUrl,
            connectTimeout: const Duration(seconds: 15),
            receiveTimeout: const Duration(seconds: 90), // extraction is slow
            sendTimeout: const Duration(seconds: 60),
            headers: {'Content-Type': 'application/json'},
            // We handle non-2xx ourselves to build typed exceptions.
            validateStatus: (s) => s != null && s < 500,
          ),
        ) {
    // On web the browser owns cookies (the HttpOnly refresh cookie can't be
    // touched by JS); a manual CookieManager/jar is a no-op there. On native we
    // persist cookies ourselves so silent refresh works.
    if (!kIsWeb) {
      _dio.interceptors.add(CookieManager(cookieJar));
    }
    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          final token = _tokenStore.accessToken;
          if (token != null && token.isNotEmpty) {
            options.headers['Authorization'] = 'Bearer $token';
          }
          handler.next(options);
        },
      ),
    );
  }

  final Dio _dio;
  final TokenStore _tokenStore;

  Future<Map<String, dynamic>> postJson(
    String path, {
    Map<String, dynamic>? body,
  }) async {
    try {
      final res = await _dio.post(path, data: body);
      return _asMap(res);
    } on DioException catch (e) {
      throw _mapDioError(e);
    }
  }

  Future<Map<String, dynamic>> getJson(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    try {
      final res = await _dio.get(path, queryParameters: query);
      return _asMap(res);
    } on DioException catch (e) {
      throw _mapDioError(e);
    }
  }

  Map<String, dynamic> _asMap(Response res) {
    final status = res.statusCode ?? 0;
    final data = res.data;
    final map = data is Map<String, dynamic>
        ? data
        : <String, dynamic>{'data': data};

    if (status >= 200 && status < 300) return map;

    final message = (map['error'] ?? map['message'] ?? 'Request failed').toString();
    throw ApiException(_kindForStatus(status), message, statusCode: status);
  }

  ApiException _mapDioError(DioException e) {
    if (e.response != null) {
      final status = e.response!.statusCode ?? 0;
      final data = e.response!.data;
      final message = data is Map && data['error'] != null
          ? data['error'].toString()
          : (e.message ?? 'Server error');
      return ApiException(_kindForStatus(status), message, statusCode: status);
    }
    switch (e.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.receiveTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.connectionError:
        return ApiException(
          ApiErrorKind.network,
          "Can't reach the server at ${Env.apiBaseUrl}. "
          'Make sure the backend is running and API_BASE_URL is reachable from this device.',
        );
      default:
        return ApiException(ApiErrorKind.unknown, e.message ?? 'Unexpected error');
    }
  }

  ApiErrorKind _kindForStatus(int status) {
    switch (status) {
      case 401:
        return ApiErrorKind.unauthorized;
      case 403:
        return ApiErrorKind.forbidden;
      case 404:
        return ApiErrorKind.notFound;
      case 429:
        return ApiErrorKind.rateLimited;
      default:
        return status >= 500 ? ApiErrorKind.server : ApiErrorKind.unknown;
    }
  }
}
