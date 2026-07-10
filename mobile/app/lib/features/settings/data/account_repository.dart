import '../../../core/network/api_client.dart';
import '../../../core/supabase/supabase_data_client.dart';
import '../../../shared/models/models.dart';

/// Profile, active sessions, and password change.
class AccountRepository {
  AccountRepository(this._data, this._api);
  final SupabaseDataClient _data;
  final ApiClient _api;

  Future<Profile?> profile(String userId) async {
    final row =
        await _data.from('profiles').select('*').eq('id', userId).maybeSingle();
    return row == null ? null : Profile.fromJson(row);
  }

  Future<void> updateProfile(
    String userId, {
    String? firstName,
    String? lastName,
    String? phone,
    String? country,
  }) async {
    await _data.from('profiles').update({
      'first_name': ?firstName,
      'last_name': ?lastName,
      'phone': ?phone,
      'country': ?country,
    }).eq('id', userId);
  }

  Future<List<UserSession>> activeSessions(String userId) async {
    final rows = await _data
        .from('user_sessions')
        .select('*')
        .eq('user_id', userId)
        .isFilter('revoked_at', null)
        .order('last_seen_at', ascending: false);
    return (rows as List)
        .map((r) => UserSession.fromJson(r as Map<String, dynamic>))
        .toList();
  }

  Future<void> revokeSession(String sessionId) async {
    await _data
        .from('user_sessions')
        .update({'revoked_at': DateTime.now().toIso8601String()}).eq('id', sessionId);
  }

  Future<void> changePassword(String current, String next) async {
    await _api.postJson('/api/auth/change-password', body: {
      'current': current,
      'next': next,
    });
  }
}
