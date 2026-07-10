import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Persists the in-memory access token's lifecycle helpers and (via the cookie
/// jar) the refresh cookie. The access token itself lives in memory only —
/// mirroring the web client (`src/lib/auth/client.ts`).
class TokenStore {
  TokenStore(this._storage);

  final FlutterSecureStorage _storage;

  static const _sessionMarkerKey = 'billsos.session_marker';

  String? _accessToken;

  String? get accessToken => _accessToken;

  bool get hasAccessToken => _accessToken != null && _accessToken!.isNotEmpty;

  void setAccessToken(String? token) => _accessToken = token;

  void clearAccessToken() => _accessToken = null;

  /// Decoded JWT payload of the current access token, or null.
  Map<String, dynamic>? get claims => decodeJwt(_accessToken);

  /// Seconds-since-epoch expiry from the access token, or null.
  int? get expiresAt {
    final exp = claims?['exp'];
    return exp is int ? exp : (exp is num ? exp.toInt() : null);
  }

  /// A lightweight persisted hint that a session likely exists, so we can decide
  /// whether to attempt a silent refresh on cold start.
  Future<void> setSessionMarker(bool value) async {
    if (value) {
      await _storage.write(key: _sessionMarkerKey, value: '1');
    } else {
      await _storage.delete(key: _sessionMarkerKey);
    }
  }

  Future<bool> hasSessionMarker() async =>
      (await _storage.read(key: _sessionMarkerKey)) == '1';

  Future<void> clearAll() async {
    clearAccessToken();
    await _storage.delete(key: _sessionMarkerKey);
  }
}

/// Decodes the payload segment of a JWT without verifying the signature
/// (verification happens server-side). Returns null on malformed input.
Map<String, dynamic>? decodeJwt(String? token) {
  if (token == null) return null;
  final parts = token.split('.');
  if (parts.length != 3) return null;
  try {
    var payload = parts[1].replaceAll('-', '+').replaceAll('_', '/');
    switch (payload.length % 4) {
      case 2:
        payload += '==';
        break;
      case 3:
        payload += '=';
        break;
    }
    final decoded = utf8.decode(base64.decode(payload));
    final json = jsonDecode(decoded);
    return json is Map<String, dynamic> ? json : null;
  } catch (_) {
    return null;
  }
}
