import '../../../core/supabase/supabase_data_client.dart';
import '../../../shared/models/models.dart';

class NotificationRepository {
  NotificationRepository(this._data);
  final SupabaseDataClient _data;

  Future<List<UserNotification>> list(String userId, {int limit = 50}) async {
    final rows = await _data
        .from('user_notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', ascending: false)
        .limit(limit);
    return (rows as List)
        .map((r) => UserNotification.fromJson(r as Map<String, dynamic>))
        .toList();
  }

  Future<int> unreadCount(String userId) async {
    final rows = await _data
        .from('user_notifications')
        .select('id')
        .eq('user_id', userId)
        .eq('is_read', false);
    return (rows as List).length;
  }

  Future<void> markRead(String id) async {
    await _data.from('user_notifications').update({
      'is_read': true,
      'read_at': DateTime.now().toIso8601String(),
    }).eq('id', id);
  }

  Future<void> markAllRead(String userId) async {
    await _data.from('user_notifications').update({
      'is_read': true,
      'read_at': DateTime.now().toIso8601String(),
    }).eq('user_id', userId).eq('is_read', false);
  }
}
