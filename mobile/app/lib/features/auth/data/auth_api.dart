import '../../../core/network/api_client.dart';

/// Result of a login attempt — either a token, or an MFA challenge to complete.
/// Mirrors the web `LoginResult` discriminated union.
sealed class LoginResult {
  const LoginResult();
}

class LoginOk extends LoginResult {
  const LoginOk(this.accessToken);
  final String accessToken;
}

class LoginMfaRequired extends LoginResult {
  const LoginMfaRequired({required this.challengeToken, required this.method});
  final String challengeToken;

  /// "totp" or "email".
  final String method;
}

/// Wraps the `/api/auth/*` endpoints. See docs/02_BACKEND_INTEGRATION.md §2.
class AuthApi {
  AuthApi(this._api);
  final ApiClient _api;

  Future<LoginResult> login(String email, String password) async {
    final res = await _api.postJson('/api/auth/login', body: {
      'email': email,
      'password': password,
    });
    if (res['mfa_required'] == true && res['challenge_token'] != null) {
      return LoginMfaRequired(
        challengeToken: res['challenge_token'].toString(),
        method: (res['method'] ?? 'totp').toString(),
      );
    }
    return LoginOk(res['access_token'].toString());
  }

  Future<String> verifyMfaChallenge(String challengeToken, String code) async {
    final res = await _api.postJson('/api/auth/mfa/challenge/verify', body: {
      'challenge_token': challengeToken,
      'code': code,
    });
    return res['access_token'].toString();
  }

  Future<void> resendMfaChallengeCode(String challengeToken) async {
    await _api.postJson('/api/auth/mfa/challenge/send', body: {
      'challenge_token': challengeToken,
    });
  }

  /// Silent refresh via the persisted refresh cookie. Returns the new access
  /// token, or null when there is no valid session.
  Future<String?> refresh() async {
    try {
      final res = await _api.postJson('/api/auth/refresh');
      final token = res['access_token'];
      return token is String && token.isNotEmpty ? token : null;
    } catch (_) {
      return null;
    }
  }

  Future<void> signup({
    required String email,
    required String password,
    String? fullName,
  }) async {
    await _api.postJson('/api/auth/signup', body: {
      'email': email,
      'password': password,
      if (fullName != null && fullName.isNotEmpty) 'full_name': fullName,
    });
  }

  Future<void> forgotPassword(String email) async {
    await _api.postJson('/api/auth/forgot-password', body: {'email': email});
  }

  Future<void> resendVerification(String email) async {
    await _api.postJson('/api/auth/resend-verification', body: {'email': email});
  }

  Future<void> logout() async {
    try {
      await _api.postJson('/api/auth/logout');
    } catch (_) {
      // best-effort
    }
  }
}
